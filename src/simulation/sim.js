import { PARAMS, FIELD, HALF, GOAL_W, GOAL_H, PENALTY_AREA } from './params.js';
import { vlen, clamp } from './math.js';
import { Rng, seededRandom, seededRandomPlayerId, ACTION_ID } from './rng.js';
import { Player, Ball } from './entities.js';
import { assignmentSlot, INSTRUCTION_FALLBACK } from './coordinates.js';
import { arrive, pursuit, separation, closest } from './steering.js';
import { chooseAction, effectivePressing, nearestOpponentDistance, staminaMult, teamTacticsOf } from './decision.js';

const SIM_TACTIC_FALLBACK = { lineHeight: 0.5, pressing: 0.5, tempo: 0.5, width: 0.5 };
const TACTIC_KEYS = Object.keys(SIM_TACTIC_FALLBACK);
const INSTRUCTION_KEYS = Object.keys(INSTRUCTION_FALLBACK);
const SETUP_VERSION = 1;
const SQUAD_SIZE = 11;
const COORD_LIMIT = 0.5;
// 침투 지시가 공격 방향으로 자리를 미는 폭(m). 감독이 짠 대형이 무너지지 않을 만큼만 움직인다.
const RUN_PUSH = 14;
// 스냅샷 1인당 저장 항목 수: x, z, vx, vz, heading, energy, kc
const SNAP_STRIDE = 7;
// 실점 이벤트로부터 몇 초(clockSeconds 단위) 전을 되감기 목표로 삼을지는
// PARAMS.rewindLookbackSeconds가 정한다 — 밸런스 상수는 params.js 한 곳에 모은다.

const inCoordRange = (n) => Number.isFinite(n) && n >= -COORD_LIMIT && n <= COORD_LIMIT;

/**
 * MatchSetup을 simulation 입장에서 검증한다.
 * roster/lineup/tactics를 import하지 않으므로 누락된 정보를 조회해 채우지 않고,
 * 경기를 시작할 수 없으면 명시적으로 오류를 낸다.
 *
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateMatchSetupForSim(matchSetup) {
  const errors = [];
  if (!matchSetup || typeof matchSetup !== 'object') return { ok: false, errors: ['MatchSetup이 없습니다.'] };
  if (matchSetup.version !== SETUP_VERSION) errors.push(`지원하지 않는 MatchSetup 버전: ${matchSetup.version}`);

  for (const side of ['homeTeam', 'awayTeam']) {
    const team = matchSetup[side];
    if (!team) {
      errors.push(`${side}가 없습니다.`);
      continue;
    }
    const assignments = team.lineup?.assignments ?? [];
    if (assignments.length !== SQUAD_SIZE) {
      errors.push(`${side} 배치가 ${SQUAD_SIZE}명이 아닙니다: ${assignments.length}명`);
    }
    const meta = new Map((team.players ?? []).map((p) => [p.id, p]));
    for (const a of assignments) {
      if (!inCoordRange(a?.x) || !inCoordRange(a?.z)) {
        errors.push(`${side} 좌표가 범위를 벗어났습니다: ${a?.playerId}`);
      }
      if (!a?.playerId || !meta.has(a.playerId)) {
        errors.push(`${side} 배치 선수의 메타가 없습니다: ${a?.playerId}`);
      }
      // 선수별 지시는 선택 항목이다 (없으면 0.5). 실려 왔다면 계약대로 0..1이어야 한다.
      if (a?.instruction != null) {
        for (const key of INSTRUCTION_KEYS) {
          const v = a.instruction[key];
          if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 1)) {
            errors.push(`${side} 선수별 지시 ${key}가 0..1이 아닙니다: ${a.playerId}`);
          }
        }
      }
    }
    for (const key of TACTIC_KEYS) {
      const v = team.tactics?.[key];
      if (!Number.isFinite(v) || v < 0 || v > 1) errors.push(`${side} 전술 ${key}가 0..1이 아닙니다.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 경기 시뮬레이션. Three.js를 전혀 import 하지 않는 순수 모듈이다.
 * - 렌더러는 sim.homeP / sim.awayP / sim.ball 을 읽기만 한다
 * - 모든 상태가 평범한 숫자라서 snapshot()/restore() 로 되감기가 가능하다
 *
 * 입력은 plain JSON `MatchSetup` 하나뿐이다. 포메이션 정의를 해석하지 않고
 * assignment에 실려 온 정규화 좌표만 월드 좌표로 바꿔 쓴다.
 */
export class Sim {
  /** @param {object} matchSetup MatchSetup version 1 */
  constructor(matchSetup) {
    const check = validateMatchSetupForSim(matchSetup);
    if (!check.ok) throw new Error(`잘못된 MatchSetup: ${check.errors.join(' / ')}`);

    this.setup = matchSetup;
    this.matchId = matchSetup.matchId;
    this.seed = Number.isFinite(matchSetup.seed) ? matchSetup.seed : 2026;
    // formationId는 표시·기록용으로만 보관한다. 좌표 조회에는 쓰지 않는다.
    this.formation = matchSetup.homeTeam.lineup.formationId;
    this.oppFormation = matchSetup.awayTeam.lineup.formationId;
    this.tactics = { ...SIM_TACTIC_FALLBACK, ...matchSetup.homeTeam.tactics };
    this.oppTactics = { ...SIM_TACTIC_FALLBACK, ...matchSetup.awayTeam.tactics };
    this.homeLineup = matchSetup.homeTeam.lineup;
    this.awayLineup = matchSetup.awayTeam.lineup;
    this.build();
  }

  build() {
    this.rng = new Rng(this.seed);
    this.tick = 0;
    this.score = { home: 0, away: 0 };
    this.events = []; // {tick, type, team, text}
    this.half = 1;
    this.phase = 'playing'; // 'playing' | 'halftime' | 'fulltime'
    this.kickoffLock = null; // { team, active } — 킥오프 제한 구역 규칙
    this.lastRewindTick = null; // 되감기를 실제로 사용한 시점(쿨다운 판정용) — restore()가 아니라 markRewindUsed()가 갱신한다

    this.homeP = this.buildSide('home', this.homeLineup, this.setup.homeTeam.players, this.tactics.width);
    this.awayP = this.buildSide('away', this.awayLineup, this.setup.awayTeam.players, this.oppTactics.width);
    this.all = [...this.homeP, ...this.awayP];
    this.ball = new Ball();
  }

  buildSide(team, lineup, players, width) {
    const meta = new Map(players.map((p) => [p.id, p]));
    return lineup.assignments.map(
      (a, i) =>
        new Player({
          team,
          idx: i,
          meta: meta.get(a.playerId),
          slot: assignmentSlot(a, team, width),
          isCaptain: a.playerId === lineup.captainId,
        })
    );
  }

  /**
   * 선수 한 명에게 좌표 경로를 지시한다(되감기 후 드래그로 그린 길).
   * @param {string} playerKey `${team}:${idx}` — playerByKey()와 같은 형식
   * @param {{x:number,z:number}[]} waypoints 월드 좌표 경유점(현재 위치 제외)
   * @returns {boolean} 실제로 지시했는지
   */
  setCommand(playerKey, waypoints) {
    const p = this.playerByKey(playerKey);
    if (!p || !Array.isArray(waypoints) || waypoints.length === 0) return false;
    p.command = { waypoints: waypoints.map((w) => ({ x: w.x, z: w.z })), index: 0 };
    return true;
  }

  /** 진행 중인 경로 지시를 취소하고 기본 AI로 되돌린다. */
  clearCommand(playerKey) {
    const p = this.playerByKey(playerKey);
    if (p) p.command = null;
  }

  /** 전술만 갈아끼운다 (경기 중 실시간 지시). 배치는 현재 assignment를 그대로 쓴다. */
  applyTactics(tactics) {
    this.tactics = { ...this.tactics, ...tactics };
    this.refreshHomeSlots();
  }

  /**
   * 경기 중 라인업·전술 교체.
   * 포메이션 변경도 새 assignments 전체를 받아서 처리한다 — 여기서 포메이션을 해석하지 않는다.
   * @param {{lineup?: object, tactics?: object}} plan
   */
  applyMatchPlan({ lineup, tactics } = {}) {
    if (tactics) this.tactics = { ...this.tactics, ...tactics };
    if (lineup?.assignments?.length === SQUAD_SIZE) {
      this.homeLineup = lineup;
      this.formation = lineup.formationId ?? this.formation;
    }
    this.refreshHomeSlots();
  }

  refreshHomeSlots() {
    this.homeP.forEach((p, i) => {
      const a = this.homeLineup.assignments[i];
      if (!a) return;
      const s = assignmentSlot(a, 'home', this.tactics.width);
      const halfTurn = this.half === 2 ? -1 : 1;
      p.home.x = s.x * halfTurn;
      p.home.z = s.z * halfTurn;
      p.attackDirection = halfTurn;
      p.role = s.role;
      // 경기 중 지시 변경도 여기로 들어온다. 다음 스텝부터 바로 반영된다.
      p.ins = s.instruction;
    });
  }

  /**
   * 한 팀의 대형이 이번 스텝에 앞뒤로 얼마나 밀릴지(m).
   *
   * 볼 위치를 따라가는 몫과 라인 높이가 통째로 미는 몫을 더한 값이지만, 그대로 쓰면
   * 라인을 끝까지 내렸을 때 뒷줄이 골라인 밖으로 밀려난다. 그래서 **팀 전체에 같은 비율**을
   * 곱해, 가장 여유 없는 선수가 경기장 안에 머물 수 있는 만큼만 움직인다 —
   * 대형의 간격은 그대로 유지되고(비율 이동), 한 줄에 쌓이거나 라인을 넘는 일이 없다.
   */
  blockShift(team) {
    const tactics = team === 'home' ? this.tactics : this.oppTactics;
    const dir = (team === 'home' ? this.homeP : this.awayP)[0]?.attackDirection ?? (team === 'home' ? 1 : -1);
    const line = tactics.lineHeight;
    const raw =
      (this.ball.x / FIELD.L) * (14 + line * 22) + (line - 0.5) * PARAMS.lineHeightBasePush * dir;
    if (!raw) return 0;

    const limit = HALF.L - PARAMS.formationTargetGoalMargin;
    let scale = 1;
    for (const p of team === 'home' ? this.homeP : this.awayP) {
      if (p.role === 'GK') continue; // 골키퍼는 대형이 아니라 자기 골문을 따른다
      const room = raw > 0 ? limit - p.home.x : p.home.x + limit;
      scale = Math.min(scale, clamp(room / Math.abs(raw), 0, 1));
    }
    return raw * scale;
  }

  get clockSeconds() {
    return this.tick * PARAMS.dt;
  }

  /** 표시용 경기 시간 — 1초 = 게임 1분 스케일 */
  get matchMinute() {
    return Math.floor(this.clockSeconds);
  }

  kickoff({ kickoffTeam = 'home' } = {}) {
    this.ball.reset();
    for (const p of this.all) {
      p.x = p.home.x;
      p.z = p.home.z;
      p.vx = 0;
      p.vz = 0;
      p.kc = 0;
    }
    const team = kickoffTeam === 'home' ? this.homeP : this.awayP;
    const taker = closest(team, this.ball); // GK 제외, 센터(볼)에 가장 가까운 선수
    const partner = taker
      ? closest(
          team.filter((p) => p !== taker),
          this.ball
        )
      : null;
    if (taker) {
      // 실제 킥오프처럼 선수를 공 위치(센터)에 정확히 세운다 — 걸어가서 잡는 게 아니라 바로 서있게 한다
      taker.x = 0;
      taker.z = 0;
    }
    if (partner) {
      // 짧은 첫 패스를 받을 파트너를 자기 진영 쪽으로 살짝 물러선 위치(minPass 이상 거리)에 세운다
      partner.x = -taker.attackDirection * (PARAMS.minPass + 1);
      partner.z = 0;
    }
    if (taker && partner) {
      // tryKick()의 일반 패스 점수(전진 편향)에 맡기면 파트너가 아닌 다른 선수에게 갈 수 있어
      // 킥오프 첫 패스만은 taker -> partner로 직접 지정한다 (실제 킥오프는 항상 옆·뒤로 짧게 시작한다)
      taker.kc = PARAMS.kickCooldownTicks;
      this.ball.kick(partner.x - taker.x, partner.z - taker.z, PARAMS.passForce, `${taker.team}:${taker.idx}`);
    } else if (taker) {
      this.ball.ownerKey = `${taker.team}:${taker.idx}`;
      this.ball.carrierKey = `${taker.team}:${taker.idx}`;
      this.ball.lastTouchKey = `${taker.team}:${taker.idx}`;
    }
    this.kickoffLock = { team: kickoffTeam, active: true };
  }

  /** 후반 시작 — 관례상 원정팀 킥오프 */
  startSecondHalf({ swapEnds = false } = {}) {
    if (this.half === 2) return;
    this.half = 2;
    this.phase = 'playing';
    if (swapEnds) {
      // 진영 교체는 포메이션을 센터 기준으로 180도 돌리고 공격 골대도 반대로 바꾼다.
      for (const p of this.all) {
        p.home.x *= -1;
        p.home.z *= -1;
        p.attackDirection *= -1;
        p.heading = (p.heading + Math.PI) % (Math.PI * 2);
        p.command = null;
      }
    }
    this.kickoff({ kickoffTeam: 'away' });
  }

  /**
   * 전/후반 종료를 판단한다. matchMinute(표시용, Math.floor)가 아니라 clockSeconds로 비교한다 —
   * halfMinutes가 1보다 작아지면 floor 때문에 halftime·fulltime 임계값이 같은 정수로 뭉개질 수 있다.
   */
  updatePhase() {
    if (this.half === 1 && this.phase === 'playing' && this.clockSeconds >= PARAMS.halfMinutes) {
      this.phase = 'halftime';
    } else if (this.half === 2 && this.phase === 'playing' && this.clockSeconds >= PARAMS.halfMinutes * 2) {
      this.phase = 'fulltime';
    }
  }

  playerByKey(key) {
    if (!key) return null;
    const [team, idx] = key.split(':');
    return (team === 'home' ? this.homeP : this.awayP)[Number(idx)] ?? null;
  }

  step() {
    if (this.phase === 'fulltime') return; // 종료 후에는 위치를 더 갱신하지 않는다 (호출은 무해하게 무시)

    // 매 스텝 시작 시 이전 스텝에서 남은 볼 속도로 킥오프 제한 해제 여부를 판정한다
    if (this.kickoffLock?.active && vlen(this.ball.vx, this.ball.vz) > PARAMS.kickoffUnlockSpeed) {
      this.kickoffLock = null;
    }

    const dt = PARAMS.dt;
    const t = this.tactics;
    const lock = this.kickoffLock?.active ? this.kickoffLock : null;
    // 킥오프 팀이 아닌 쪽은 이번 스텝에서 chaser 후보에서 제외된다
    const hc = lock && lock.team !== 'home' ? null : closest(this.homeP, this.ball);
    const ac = lock && lock.team !== 'away' ? null : closest(this.awayP, this.ball);
    // 압박이 센 팀은 볼에 가장 가까운 한 명만 나가지 않는다 — 두 번째 선수가 함께 달려들어
    // 협위(挾圍)를 만든다. 압박 0.5 이하에서는 반경이 0이라 예전 동작 그대로다.
    const hs = hc ? closest(this.homeP.filter((p) => p !== hc), this.ball) : null;
    const as = ac ? closest(this.awayP.filter((p) => p !== ac), this.ball) : null;
    // 대형 이동은 팀 단위 값이라 선수마다 다시 계산하지 않는다.
    const homeShift = this.blockShift('home');
    const awayShift = this.blockShift('away');

    for (const p of this.all) {
      const mates = p.team === 'home' ? this.homeP : this.awayP;
      const chaser = p.team === 'home' ? hc : ac;
      const mine = p.team === 'home';
      const restricted = !!lock && p.team !== lock.team;
      // 양 팀 모두 자기 전술로 뛴다 — 감독이 만지는 건 홈뿐이지만, 경기는 두 전술의 대결이다.
      // 개인 지시는 팀 값을 덮어쓰지 않고 ±0.3까지 밀거나 당긴다 — 팀 전술이 여전히 뼈대다.
      const tt = mine ? t : this.oppTactics;
      const press = clamp(tt.pressing + (p.ins.pressing - 0.5) * 0.6, 0, 1);
      // 마지막으로 공을 찬 쪽을 그 팀의 소유로 본다. 침투는 이때만 의미가 있다.
      const holding = this.ball.ownerKey ? this.ball.ownerKey.startsWith(p.team) : false;

      // 체력 → 최고 속도는 스티어링보다 먼저 확정한다.
      // 뒤에서 갱신하면 한 스텝 늦은 값이 힘 계산에 섞여 되감기 재현성이 깨진다.
      p.maxSpeed = p.maxSpeedBase * (0.72 + p.energy * 0.28);

      let fx = 0;
      let fz = 0;

      const isCarrier = this.ball.carrierKey === `${p.team}:${p.idx}`;

      if (p.command) {
        // 감독이 되감기 후 드래그로 내린 경로 지시 — 기본 AI보다 우선한다.
        const wp = p.command.waypoints[p.command.index];
        [fx, fz] = arrive(p, wp.x, wp.z);
        if (vlen(wp.x - p.x, wp.z - p.z) < PARAMS.comfortZone) {
          p.command.index++;
          if (p.command.index >= p.command.waypoints.length) p.command = null; // 다 왔으면 기본 AI로 복귀
        }
      } else if (p.role === 'GK') {
        const [gx, gz] = this.goalkeeperTarget(p);
        [fx, fz] = arrive(p, gx, gz);
      } else if (isCarrier && p.dribbleMode === 'hold') {
        // 키핑 — 판단(decision.js scoreHoldCandidate)이 "제자리에서 볼을 지킨다"를 골랐을 때.
        // 목표를 자기 자신으로 두면 arrive()가 [0,0]을 돌려줘 정지 상태가 된다.
        [fx, fz] = arrive(p, p.x, p.z);
      } else if (isCarrier) {
        // 드리블 중 — 공을 몰고 상대 골 쪽으로 전진한다(목표를 매 틱 앞으로 다시 잡아 계속
        // 전진하게 만든다). 개인 지시(roaming)로 살짝 좌우 흔들림을 준다.
        const dir = p.attackDirection;
        const tx = clamp(p.x + dir * PARAMS.dribbleLookahead, -HALF.L, HALF.L);
        const tz = clamp(p.z + (p.ins.roaming - 0.5) * PARAMS.dribbleLookahead, -HALF.W, HALF.W);
        [fx, fz] = arrive(p, tx, tz);
      } else if (p === chaser) {
        [fx, fz] = pursuit(p, this.ball);
      } else if (
        // 협위 압박 — 우리가 볼을 갖고 있지 않을 때, 압박 지시가 센 팀의 두 번째 선수가
        // 볼로 함께 달려든다. 반경은 압박 0.5에서 0, 1.0에서 pressSupportRadius다.
        p === (mine ? hs : as) &&
        !holding &&
        !restricted &&
        vlen(this.ball.x - p.x, this.ball.z - p.z) < clamp((press - 0.5) * 2, 0, 1) * PARAMS.pressSupportRadius
      ) {
        [fx, fz] = pursuit(p, this.ball);
      } else {
        // 대형 전체가 같은 폭으로 밀린다(blockShift가 이미 경기장 안에 들어오도록 비율을
        // 맞춰 둔 값이다). 우리팀이 공을 갖고 있을 때만 개인차 있는 침투런을 얹는다.
        const shift = mine ? homeShift : awayShift;
        const run = holding ? (p.ins.runs - 0.5) * RUN_PUSH * p.attackDirection : 0;
        // 침투런까지 더한 뒤 마지막으로 한 번 더 라인 안쪽으로 자른다 — 어떤 지시를 줘도
        // 목표 지점은 경기장 안이어야 한다.
        const margin = PARAMS.formationTargetGoalMargin;
        let tx = clamp(p.home.x + shift + run, -HALF.L + margin, HALF.L - margin);
        let tz = clamp(
          p.home.z + (this.ball.z - p.home.z) * (0.08 + press * 0.14) * (0.5 + p.ins.roaming),
          -HALF.W + margin,
          HALF.W - margin
        );
        if (restricted) {
          // 킥오프 규정: 상대팀 선수는 볼이 움직이기 전까지 센터서클 밖에 있어야 한다
          const d = vlen(tx, tz);
          if (d < PARAMS.centerCircleRadius) {
            if (d < 1e-6) {
              tx = -p.attackDirection * PARAMS.centerCircleRadius;
              tz = 0;
            } else {
              const scale = PARAMS.centerCircleRadius / d;
              tx *= scale;
              tz *= scale;
            }
          }
        }
        const comfort = PARAMS.comfortZone * (0.6 + p.ins.coverage * 0.8);
        if (vlen(tx - p.x, tz - p.z) > comfort) [fx, fz] = arrive(p, tx, tz);
      }

      const [sxx, szz] = separation(p, mates);
      fx += sxx * PARAMS.sepWeight;
      fz += szz * PARAMS.sepWeight;

      const fl = vlen(fx, fz);
      if (fl > PARAMS.maxForce) {
        fx = (fx / fl) * PARAMS.maxForce;
        fz = (fz / fl) * PARAMS.maxForce;
      }

      p.vx += fx * dt;
      p.vz += fz * dt;
      const sp = vlen(p.vx, p.vz);
      if (sp > p.maxSpeed) {
        p.vx = (p.vx / sp) * p.maxSpeed;
        p.vz = (p.vz / sp) * p.maxSpeed;
      }
      // 선수는 어떤 전술·지시로도 경기장 밖에 서지 않는다. 라인을 밟고 서는 것도 막아
      // 시각적으로 "밖으로 나간" 것처럼 보이지 않게 살짝 안쪽까지만 허용한다.
      p.x = clamp(p.x + p.vx * dt, -HALF.L + PARAMS.playerLineInset, HALF.L - PARAMS.playerLineInset);
      p.z = clamp(p.z + p.vz * dt, -HALF.W + PARAMS.playerLineInset, HALF.W - PARAMS.playerLineInset);
      if (isCarrier) {
        // 드리블로는 골라인을 절대 못 넘는다(골은 슛으로만) — mandatoryShotDistance가 미리
        // 슛을 강제하지만, 그 전에라도 몸으로 넘어가 버리는 걸 여기서 한 번 더 확실히 막는다.
        // dribbleCarryOffset(볼을 몸 앞에 붙이는 거리)만큼 더 여유를 둬야, 붙어있는 볼까지
        // 골라인에 안 닿는다 — 안 그러면 슛으로 놓는 순간 볼이 이미 골라인 위에 있어서
        // 슛이 날아가기도 전에 골로 잡히는 버그가 난다(실제로 겪었다).
        const goalLimit = HALF.L - PARAMS.dribbleCarryOffset - 0.5;
        p.x = p.attackDirection > 0 ? Math.min(p.x, goalLimit) : Math.max(p.x, -goalLimit);
      }
      if (sp > 0.5) p.heading = Math.atan2(p.vx, p.vz);
      if (p.kc > 0) p.kc--;

      if (isCarrier) {
        // 볼을 발밑 앞쪽에 붙여둔다 — 따로 물리 갱신하지 않고 매 틱 캐리어 위치로 스냅한다.
        // 여기도 골라인 바로 앞(-0.5m 여유)까지만 허용해 위 클램프와 이중으로 막는다.
        this.ball.x = clamp(p.x + Math.sin(p.heading) * PARAMS.dribbleCarryOffset, -HALF.L + 0.5, HALF.L - 0.5);
        this.ball.z = clamp(p.z + Math.cos(p.heading) * PARAMS.dribbleCarryOffset, -HALF.W, HALF.W);
        this.ball.vx = p.vx;
        this.ball.vz = p.vz;
        // 발밑에 붙은 볼은 항상 땅에 있다 — 공중볼을 잡은 직후에도 높이를 여기서 확실히 죽인다.
        this.ball.y = PARAMS.ballRadius;
        this.ball.vy = 0;
      }

      const drain = (sp / PARAMS.maxSpeed) * (0.6 + press * 0.8) * (110 - p.stamina) / 100;
      p.energy = clamp(p.energy - drain * dt * 0.004, 0.35, 1);
    }

    for (const p of this.all) this.tryKick(p);
    // 드리블 중엔 이미 위(캐리어 처리)에서 매 틱 위치를 붙여놨다 — 마찰/관성 물리를 또 적용하면 안 된다.
    if (!this.ball.carrierKey) {
      this.ball.update(dt);
      // 골은 슛(킥)으로만 넣는다 — 드리블로 공을 몰고 골라인을 그냥 지나가는 건 골이 아니다.
      // 캐리어가 있는 동안은 골 판정을 아예 안 한다(위 carrierDecide의 골문 근처 슛 강제와 짝).
      // 골이 아니면(빗나간 슛/걷어낸 공 등) 필드 밖으로 나갔는지도 같이 본다 — 골 판정이
      // 이미 kickoff()로 볼을 리셋했다면 아웃오브바운즈 판정은 의미가 없어 건너뛴다.
      if (!this.checkGoal()) this.checkOutOfBounds();
    } else {
      // 캐리어가 드리블 중에 터치라인/골라인 밖으로 그대로 뛰쳐나가는 경우 — 골은 슛으로만
      // 나므로 checkGoal()은 여전히 안 부르지만, 아웃오브바운즈는 "볼이 캐리어 상태냐"와
      // 무관하게 실제로 선을 넘으면 즉시 잡아야 한다. 이걸 안 하면 킥으로 공을 놓을 때까지는
      // 절대 아웃 판정이 안 나서, 드리블로 계속 터치라인 밖까지 몰고 가도 경기가 안 멈추고
      // 그대로 진행되는 버그가 났다(실전에서 확인).
      this.checkOutOfBounds();
    }
    this.tick++;
    this.updatePhase();
  }

  /**
   * 골키퍼가 이번 스텝에 서 있고 싶은 자리.
   * 기본은 골문 앞 2m에서 볼의 z를 반만 따라가는 예전 동작 그대로다. 볼이 떠서 우리 페널티
   * 에어리어로 떨어지는 중이면(크로스·롱볼·클리어) 낙하 지점까지 마중 나간다 — 다만 골라인에서
   * gkComeOutRange 밖으로는 절대 안 나간다. 나갔다가 골문이 비면 그게 더 큰 실점이다.
   */
  goalkeeperTarget(gk) {
    const b = this.ball;
    let gx = -gk.attackDirection * (HALF.L - 2);
    let gz = clamp(b.z * 0.5, -GOAL_W / 2, GOAL_W / 2);
    if (b.airborne) {
      const land = b.predictLanding();
      const ownGoalX = -gk.attackDirection * HALF.L;
      const landsInOwnBox =
        Math.abs(land.x - ownGoalX) <= PENALTY_AREA.depth && Math.abs(land.z) <= PENALTY_AREA.halfWidth;
      if (landsInOwnBox) {
        const outLimit = -gk.attackDirection * (HALF.L - PARAMS.gkComeOutRange);
        gx = gk.attackDirection > 0 ? Math.min(land.x, outLimit) : Math.max(land.x, outLimit);
        gz = clamp(land.z, -PENALTY_AREA.halfWidth, PENALTY_AREA.halfWidth);
      }
    }
    return [gx, gz];
  }

  /** p를 압박 중인 가장 가까운 상대와의 거리를 오차 배수로 바꾼다. 상대가 없거나 멀면 1(가산 없음). */
  pressureFactor(p) {
    const opps = p.team === 'home' ? this.awayP : this.homeP;
    let nearest = Infinity;
    for (const o of opps) {
      const d = vlen(o.x - p.x, o.z - p.z);
      if (d < nearest) nearest = d;
    }
    return clamp(1 + (PARAMS.pressureRadius - nearest) / PARAMS.pressureRadius, 1, PARAMS.pressureMax);
  }

  /**
   * 실수를 성공/실패 판정이 아니라 "방향 오차(도)"로 만든다.
   * 오차 = 기본값 × (스탯 낮을수록↑) × (압박받을수록↑) × (체력 없을수록↑) × (거리 멀수록↑).
   * 삼각분포(두 난수의 합)로 뽑아서 작은 오차는 흔하고 큰 오차는 드물게 나오게 한다 —
   * 그래서 2도 정도는 그냥 정상 패스로, 8도는 삑사리로, 20도는 터치라인 아웃으로 저절로 이어진다.
   */
  errorDegrees(p, { statValue, distance, baseDeg }) {
    const statFactor = clamp((100 - statValue) / 50, 0.2, 1.6);
    const staminaFactor = clamp(1 + (0.75 - p.energy) * 2, 1, PARAMS.staminaErrorMax);
    const distanceFactor = clamp(distance / PARAMS.distanceErrorRef, 0.5, 2.5);
    const magnitude = Math.min(
      baseDeg * statFactor * this.pressureFactor(p) * staminaFactor * distanceFactor,
      PARAMS.maxErrorDeg
    );
    return (this.rng.next() + this.rng.next() - 1) * magnitude;
  }

  /** (dx, dz)를 deg도만큼 돌린다 — 오차각을 실제 킥 방향에 반영할 때 쓴다. */
  rotateXZ(dx, dz, deg) {
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [dx * c - dz * s, dx * s + dz * c];
  }

  /**
   * 수비(defender) vs 공격(attacker) 다툼의 승패만 판정한다(부수효과 없음).
   * §6.7: 탈취확률 = (수비력×체력승수)/(수비력+드리블력) × (1+압박강도/200) × 거리감쇠
   * - 압박강도: defender의 압박 지시(0..1, effectivePressing)를 다른 항(수비력/드리블력,
   *   0..100 스탯 스케일)과 맞추려고 ×tacklePressingScale(100)로 정규화한다 — 단위를
   *   안 맞추면 이 항이 사실상 무시되거나(0..1 그대로면 /200이 거의 1) 반대로 스탯 항을
   *   압도해버린다.
   * - 거리감쇠: 실제 몸싸움 거리(둘 사이 실측 거리, kickDist 기준)가 멀수록 승률을 깎는다.
   * - 확률 판정은 이번 리팩터링에서 지정한 seededRandom(tick, playerId, actionId) —
   *   defender가 태클을 "시도하는" 쪽이라 defender를 playerId로 쓴다.
   */
  resolveTackle(defender, attacker, actionId = ACTION_ID.TACKLE_LOOSE_BALL) {
    const staminaMult = 0.55 + 0.45 * defender.energy;
    const def = defender.defenseSkill * staminaMult;
    const base = def / (def + attacker.dribbleSkill);
    const pressingPct = effectivePressing(this, defender) * PARAMS.tacklePressingScale;
    const pressureBonus = 1 + pressingPct / PARAMS.tacklePressingDivisor;
    const dist = vlen(defender.x - attacker.x, defender.z - attacker.z);
    const distanceDecay = clamp(1 - dist / PARAMS.kickDist, PARAMS.tackleDistanceDecayMin, 1);
    const winProb = clamp(base * pressureBonus * distanceDecay, PARAMS.tackleWinMin, PARAMS.tackleWinMax);
    const roll = seededRandom(this.tick, seededRandomPlayerId(defender.team, defender.idx), actionId);
    return roll < winProb;
  }

  /** 태클 성공 시 수비가 그 자리에서 걷어낸다 — 클리어링도 킥이라 같은 오차 모델을 그대로 쓴다. */
  clearBall(defender) {
    this.ball.ownerKey = `${defender.team}:${defender.idx}`;
    const cdx = defender.atkX - defender.x;
    const cdz = 0 - defender.z;
    const errDeg = this.errorDegrees(defender, {
      statValue: defender.passSkill,
      distance: PARAMS.distanceErrorRef,
      baseDeg: PARAMS.passBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(cdx, cdz, errDeg);
    // 걷어내기는 높이 띄운다 — 태클로 빼앗은 볼을 땅으로 굴리면 압박 안에서 바로 다시 뺏긴다.
    this.ball.kick(edx, edz, PARAMS.clearForce, `${defender.team}:${defender.idx}`, PARAMS.clearLoftDeg); // kick()이 carrierKey도 같이 지운다
    this.pushEvent('tackle', defender.team, `${defender.name} 볼 탈취`);
  }

  /** 캐리어를 드리블 중에 노리는 상대. 사거리 안에 실제로 붙어야 다툰다. */
  tryTackleCarrier(defender) {
    const carrier = this.playerByKey(this.ball.carrierKey);
    if (!carrier) return;
    // 자기 페널티 에어리어 안에서 볼을 잡고 있는 골키퍼에게는 도전할 수 없다 —
    // 손에 든 공을 발로 뺏는 장면이 나오면 안 된다.
    if (carrier.role === 'GK') {
      const ownGoalX = -carrier.attackDirection * HALF.L;
      if (Math.abs(carrier.x - ownGoalX) <= PENALTY_AREA.depth && Math.abs(carrier.z) <= PENALTY_AREA.halfWidth) {
        return;
      }
    }
    if (vlen(defender.x - carrier.x, defender.z - carrier.z) > PARAMS.kickDist) return;
    defender.kc = PARAMS.kickCooldownTicks;
    // 캐리어의 kc(재판단 주기)는 여기서 건드리지 않는다 — 건드리면 수비가 계속 붙어서
    // (수비 쿨다운 8틱 < 캐리어 판단주기 24틱) 매번 재시도할 때마다 캐리어 재판단이 밀려서,
    // 이기든 지든 캐리어가 영원히 패스/슛을 못 하고 드리블만 하게 되는 버그가 났었다.
    // (이 버그는 test_carrier_kc_regression.mjs로 명시적으로 재현·재확인한다.)
    if (this.resolveTackle(defender, carrier, ACTION_ID.TACKLE_CARRIER)) this.clearBall(defender);
  }

  /**
   * 캐리어가 판단 주기(dribbleDecisionTicks)마다 무엇을 할지 정한다.
   * 판단(어떤 행동을 고를지 — chooseAction, 확률 없음)과 실행(고른 행동이 성공하는지 —
   * execute*, 확률 판정 1회)을 분리한다. 새 행동은 decision.js의 후보 목록에 추가하고
   * 여기 execute* 하나만 늘리면 되고, 기존 execute*는 서로 건드리지 않는다 — 이게
   * "새 행동을 추가하면 기존 행동이 안 나오는" 폭포수 if-else 버그의 재발 방지책이다.
   */
  carrierDecide(p) {
    const action = chooseAction(this, p);
    switch (action.type) {
      case 'pass':
        return this.executePass(p, action);
      case 'shoot':
        return this.executeShoot(p, action);
      case 'dribble':
        return this.executeDribble(p);
      case 'hold':
        return this.executeHold(p);
      case 'clear':
        return this.executeClear(p);
      default:
        return this.executeDribble(p); // 이론상 도달하지 않는다 — hold가 항상 후보라 chooseAction은 null을 안 낸다
    }
  }

  /**
   * 팀 템포가 판단 주기를 바꾼다. 빠른 팀은 볼을 빨리 놓고(주기 짧게), 점유 팀은 오래 들고 있다.
   * 템포 0.5에서 정확히 dribbleDecisionTicks라서 전술을 안 만진 경기는 예전 그대로 흐른다.
   */
  decisionTicksFor(p) {
    const tempo = teamTacticsOf(this, p).tempo;
    const scale = 1 + PARAMS.tempoDecisionScale / 2 - tempo * PARAMS.tempoDecisionScale;
    return Math.max(6, Math.round(PARAMS.dribbleDecisionTicks * scale));
  }

  /** 패스 실행 — 성공확률(§6.7)을 seededRandom으로 한 번만 굴린다. 실패해도 소멸 대신 큰 오차로 표현. */
  executePass(p, action) {
    const target = action.target;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const roll = seededRandom(this.tick, seededRandomPlayerId(p.team, p.idx), ACTION_ID.PASS_SUCCESS);
    const succeeded = roll < action.meta.successProb;
    const baseDeg = succeeded ? PARAMS.passBaseErrorDeg : PARAMS.passBaseErrorDeg * PARAMS.passFailErrorMultiplier;
    const errDeg = this.errorDegrees(p, { statValue: p.passSkill, distance: action.meta.distance, baseDeg });
    const [edx, edz] = this.rotateXZ(dx, dz, errDeg);
    // 직선적인 팀은 패스를 더 세게 찬다 — 빨리 도착하는 대신 받기 어렵고 흐르기도 쉽다.
    const tempo = teamTacticsOf(this, p).tempo;
    const force = PARAMS.passForce * (1 - PARAMS.tempoPassForceScale / 2 + tempo * PARAMS.tempoPassForceScale);
    // 짧은 패스는 땅볼, 긴 패스는 띄워 보낸다 — 롱볼이 수비 사이를 굴러 지나가지 않고
    // 넘어가야 "긴 패스"가 짧은 패스와 다른 선택이 된다.
    const loft = action.meta.distance > PARAMS.longPassDistance ? PARAMS.longPassLoftDeg : PARAMS.passLoftDeg;
    this.ball.kick(edx, edz, force, `${p.team}:${p.idx}`, loft);
    // 찬 직후에도 kc가 0으로 남아 있으면, 공이 발밑에서 채 1틱도 안 떨어진 사이에 본인이
    // 다시 "가장 가까운 선수"로 잡혀서 즉시 자기 패스를 자기가 재줍는 버그가 났다(실전에서
    // 확인함 — 패스가 나간 것처럼 보이지만 실제로는 계속 같은 선수가 캐리어로 남아 있었다).
    // 다른 킥/태클 경로는 전부 kc를 세팅하는데 여기만 빠져 있었다.
    p.kc = PARAMS.kickCooldownTicks;
  }

  /** 슛 실행 — 마찬가지로 성공확률을 한 번만 굴려서 오차 폭을 정한다. */
  executeShoot(p, action) {
    const gdx = p.atkX - p.x;
    const gdz = 0 - p.z;
    const roll = seededRandom(this.tick, seededRandomPlayerId(p.team, p.idx), ACTION_ID.SHOOT_SUCCESS);
    const succeeded = roll < action.meta.successProb;
    const baseDeg = succeeded ? PARAMS.shotBaseErrorDeg : PARAMS.shotBaseErrorDeg * PARAMS.shotFailErrorMultiplier;
    const errDeg = this.errorDegrees(p, { statValue: p.shootSkill, distance: action.meta.distance, baseDeg });
    const [edx, edz] = this.rotateXZ(gdx, gdz, errDeg);
    // 오차는 좌우로만이 아니라 위아래로도 난다 — 같은 오차각을 상하로도 나눠 써서, 크게
    // 빗나간 슛은 옆으로 흐르는 대신 크로스바를 넘어간다(errDeg가 음수면 낮게 깔린 슛).
    const loft = Math.max(0, PARAMS.shootLoftDeg + errDeg * PARAMS.shotVerticalErrorScale);
    this.ball.kick(edx, edz, PARAMS.shootForce, `${p.team}:${p.idx}`, loft);
    p.kc = PARAMS.kickCooldownTicks; // 패스와 같은 이유 — 슛한 직후 본인이 바로 재줍는 걸 막는다
  }

  /** 드리블 유지 — "계속 갈지"는 이미 판단(점수 비교)에서 끝났다. 확률 판정 없음. */
  executeDribble(p) {
    p.dribbleMode = 'advance';
    p.kc = this.decisionTicksFor(p);
  }

  /** 키핑 — 다음 판단 주기까지 제자리에서 볼을 지킨다. 확률 판정 없음. */
  executeHold(p) {
    p.dribbleMode = 'hold';
    p.kc = this.decisionTicksFor(p);
  }

  /** 클리어 — 압박에 밀린 캐리어가 무조건 앞으로 걷어낸다. 클리어링이라 오차를 크게 잡는다. */
  executeClear(p) {
    const cdx = p.atkX - p.x;
    const cdz = 0 - p.z;
    const errDeg = this.errorDegrees(p, { statValue: p.passSkill, distance: PARAMS.distanceErrorRef, baseDeg: PARAMS.clearBaseErrorDeg });
    const [edx, edz] = this.rotateXZ(cdx, cdz, errDeg);
    this.ball.kick(edx, edz, PARAMS.clearForce, `${p.team}:${p.idx}`, PARAMS.clearLoftDeg);
    p.kc = PARAMS.kickCooldownTicks; // 마찬가지로 자기 클리어를 자기가 바로 재줍는 걸 막는다
    this.pushEvent('tackle', p.team, `${p.name} 압박에 클리어`);
  }

  /**
   * 헤딩 — 발이 안 닿는 높이의 볼을 머리로 쳐낸다. 컨트롤이 아니라 "쳐내기"라서 캐리어가
   * 되지 않고, 방향 오차도 발보다 훨씬 크다. 항상 자기 공격 방향으로 보내므로 수비의
   * 걷어내기와 공격의 문전 헤딩이 같은 코드에서 자연스럽게 갈린다(골문 앞에서 때리면
   * 그대로 골문으로 간다).
   */
  executeHeader(p) {
    const hdx = p.atkX - p.x;
    const hdz = 0 - p.z;
    const errDeg = this.errorDegrees(p, {
      statValue: p.shootSkill,
      distance: PARAMS.distanceErrorRef,
      baseDeg: PARAMS.headerBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(hdx, hdz, errDeg);
    this.ball.kick(edx, edz, PARAMS.headerForce, `${p.team}:${p.idx}`, PARAMS.headerLoftDeg);
    p.kc = PARAMS.kickCooldownTicks;
  }

  /**
   * 골키퍼의 볼 처리. 손을 쓰기 때문에 필드 플레이어의 발 사거리(kickDist)·발 높이
   * (footControlHeight)가 아니라 gkReachRadius·gkReachHeight를 쓰고, 대신 자기 페널티
   * 에어리어 안에서만 가능하다(밖에서는 이 경로를 안 타고 발로만 다룬다).
   *
   * 결과는 셋 중 하나다 — 잡거나(캐치), 손끝에 걸려 쳐내거나(펀칭), 완전히 지나치거나.
   * 세 번째가 반드시 있어야 골이 들어간다. 확률 한 번만 굴려서 세 구간으로 나눈다.
   *
   * @returns {boolean} 이번 틱에 골키퍼가 볼을 실제로 건드렸는지
   */
  tryGoalkeeperClaim(gk) {
    if (gk.kc > 0) return false;
    const b = this.ball;
    if (b.carrierKey) return false; // 누가 발밑에 두고 있으면 그건 태클 문제다
    const ownGoalX = -gk.attackDirection * HALF.L;
    if (Math.abs(b.x - ownGoalX) > PENALTY_AREA.depth || Math.abs(b.z) > PENALTY_AREA.halfWidth) return false;
    if (b.y > PARAMS.gkReachHeight) return false;
    const dist = vlen(gk.x - b.x, gk.z - b.z);
    if (dist > PARAMS.gkReachRadius) return false;

    // 성공하든 실패하든 이번 접촉은 여기서 끝난다 — 쿨다운을 안 걸면 볼이 사거리를 지나는
    // 동안 매 틱 다시 굴려서, 아무리 확률이 낮아도 결국 한 번은 잡아 버린다.
    gk.kc = PARAMS.kickCooldownTicks;

    const speed = vlen(b.vx, b.vz);
    // 조건별 배수를 곱한다 — 각 항은 "이만큼 어려워진다"를 뜻하고, 어느 하나가 혼자
    // 확률을 0으로 끌어내리지 않는다(뺄셈이었을 때 속도 항 하나가 그렇게 만들었다).
    const handling = clamp(
      (gk.defenseSkill * staminaMult(gk.energy)) / PARAMS.gkHandlingRefStat,
      0.6,
      1.25
    );
    const speedFactor = 1 - clamp(speed / PARAMS.gkCatchSpeedRef, 0, 1) * PARAMS.gkCatchSpeedPenalty;
    const reachFactor = 1 - clamp(dist / PARAMS.gkReachRadius, 0, 1) * PARAMS.gkCatchReachPenalty;
    const heightFactor =
      1 -
      clamp(
        (b.y - PARAMS.footControlHeight) / Math.max(0.01, PARAMS.gkReachHeight - PARAMS.footControlHeight),
        0,
        1
      ) * PARAMS.gkCatchHeightPenalty;
    const catchProb = clamp(
      PARAMS.gkCatchBaseProb * handling * speedFactor * reachFactor * heightFactor,
      PARAMS.gkCatchMin,
      PARAMS.gkCatchMax
    );
    const parryProb = (1 - catchProb) * PARAMS.gkParryShare;
    const roll = seededRandom(this.tick, seededRandomPlayerId(gk.team, gk.idx), ACTION_ID.GK_CLAIM);
    const gkKey = `${gk.team}:${gk.idx}`;
    // 세게 날아온 볼을 막아냈을 때만 "선방"으로 남긴다 — 굴러온 볼까지 기록하면 이벤트 창이 도배된다.
    const worthLogging = speed >= PARAMS.gkSaveEventSpeed;

    if (roll < catchProb) {
      // 캐치 — 손에 넣었다. 볼을 죽여 발밑에 붙이고 다음 판단(골킥/패스)까지 들고 있는다.
      b.vx = 0;
      b.vz = 0;
      b.vy = 0;
      b.y = PARAMS.ballRadius;
      b.ownerKey = gkKey;
      b.carrierKey = gkKey;
      b.lastTouchKey = gkKey;
      gk.kc = PARAMS.gkHoldTicks;
      if (worthLogging) this.pushEvent('save', gk.team, `${gk.name} 선방`);
      return true;
    }

    if (roll < catchProb + parryProb) {
      // 펀칭 — 잡지는 못하고 옆으로 쳐냈다. 방향을 고를 여유가 없어 오차가 크다.
      const side = b.z >= 0 ? 1 : -1;
      const errDeg = this.errorDegrees(gk, {
        statValue: gk.defenseSkill,
        distance: PARAMS.distanceErrorRef,
        baseDeg: PARAMS.gkPunchBaseErrorDeg,
      });
      const [edx, edz] = this.rotateXZ(gk.attackDirection, side, errDeg);
      b.kick(edx, edz, PARAMS.gkPunchForce, gkKey, PARAMS.gkPunchLoftDeg);
      if (worthLogging) this.pushEvent('save', gk.team, `${gk.name} 펀칭`);
      return true;
    }

    return false; // 못 막았다 — 볼은 그대로 흐른다(골이 될 수도 있다)
  }

  /**
   * 골킥 — 골문 앞에서 크게 띄워 전방으로 걷어찬다.
   * 힘과 각도가 고정이라 "얼마나 멀리 가는지"는 정해져 있고, 고르는 건 방향뿐이다.
   * 그래서 그 사거리쯤에 서 있는 동료 중 가장 열려 있는 쪽을 겨냥한다 — 아무도 없으면
   * 그냥 정면으로 걷어찬다(경합볼이 된다).
   */
  executeGoalKick(gk) {
    // 무항력 포물선 사거리 R = v²·sin(2θ)/g. 공기저항 때문에 실제로는 조금 못 미치므로
    // 상수 하나를 더 두는 대신 여기서 깎아 쓴다 — 힘·각도를 바꾸면 조준도 같이 따라온다.
    const rad = (PARAMS.goalKickLoftDeg * Math.PI) / 180;
    const range = ((PARAMS.goalKickForce ** 2 * Math.sin(2 * rad)) / PARAMS.gravity) * 0.8;

    const mates = gk.team === 'home' ? this.homeP : this.awayP;
    let target = null;
    let bestScore = -Infinity;
    for (const m of mates) {
      if (m === gk || m.role === 'GK') continue;
      if ((m.x - gk.x) * gk.attackDirection <= 0) continue; // 앞으로 차는 킥이다 — 뒤에 있는 동료는 후보가 아니다
      const d = vlen(m.x - gk.x, m.z - gk.z);
      // 사거리에 가까울수록, 상대와 떨어져 있을수록 좋다.
      const score =
        -Math.abs(d - range) / FIELD.L + clamp(nearestOpponentDistance(this, m) / PARAMS.openPassRadius, 0, 1);
      if (score > bestScore) {
        bestScore = score;
        target = m;
      }
    }

    const gdx = target ? target.x - gk.x : gk.attackDirection;
    const gdz = target ? target.z - gk.z : 0;
    const errDeg = this.errorDegrees(gk, {
      statValue: gk.passSkill,
      distance: PARAMS.distanceErrorRef,
      baseDeg: PARAMS.goalKickBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(gdx, gdz, errDeg);
    this.ball.kick(edx, edz, PARAMS.goalKickForce, `${gk.team}:${gk.idx}`, PARAMS.goalKickLoftDeg);
    gk.kc = PARAMS.kickCooldownTicks;
  }

  tryKick(p) {
    const pKey = `${p.team}:${p.idx}`;

    if (this.ball.carrierKey) {
      // 볼이 이미 누군가의 발밑에 있다 — 그 사람이면 계속 갈지/풀지 재판단하고,
      // 상대편이면(같은 편은 아무 것도 안 함) 사거리 안일 때만 태클을 시도한다.
      if (this.ball.carrierKey === pKey) {
        if (p.kc <= 0) {
          // 손에 넣은 볼을 가진 골키퍼는 패스/드리블을 저울질하지 않는다 — 그냥 배급한다.
          // 일반 판단에 맡기면 '키핑'이 계속 이겨서 키퍼가 볼을 안고 경기를 세워 버린다.
          if (p.role === 'GK') this.executeGoalKick(p);
          else this.carrierDecide(p);
        }
      } else if (p.team !== this.ball.carrierKey.split(':')[0] && p.kc <= 0) {
        this.tryTackleCarrier(p);
      }
      return;
    }

    // 골키퍼는 손을 쓴다 — 발보다 사거리가 넓고 크로스바 높이까지 닿는다. 자기 페널티
    // 에어리어 안에서만이고, 발로 처리하는 일반 경로보다 먼저 본다(자기 골문 앞 공중볼은
    // 키퍼가 우선권을 갖는다).
    if (p.role === 'GK' && this.tryGoalkeeperClaim(p)) return;

    // 볼이 자유 상태(아무도 안 갖고 있음) — 이 틱에 실제로 주울 수 있는 사람만 처리한다.
    if (p.kc > 0 || vlen(p.x - this.ball.x, p.z - this.ball.z) > PARAMS.kickDist) return;

    // 머리보다 높이 뜬 볼은 이번 틱에 아무도 다루지 못한다. 이 게이트가 없으면 머리 위로
    // 날아가는 공을 땅에서 그대로 낚아채서 로프트가 아무 의미도 갖지 못한다.
    if (this.ball.y > PARAMS.headControlHeight) return;

    // 이 틱에 실제로 볼을 다루는 건 볼에 가장 가까운 딱 한 명이다. p가 그 사람이 아니면(더
    // 가까운 다른 선수가 있으면) 아무 것도 하지 않는다 — this.all이 항상 홈을 먼저 훑기 때문에,
    // 이 체크가 없으면 볼 근처에 둘 다 있을 때 홈이 항상 먼저 "내가 다룬다"고 우겨버린다.
    let closer = null;
    let bd = vlen(p.x - this.ball.x, p.z - this.ball.z);
    for (const other of this.all) {
      if (other === p || other.kc > 0) continue;
      const d = vlen(other.x - this.ball.x, other.z - this.ball.z);
      if (d < bd) {
        bd = d;
        closer = other;
      }
    }
    if (closer) return; // 더 가까운 선수의 차례에 처리된다

    // 발이 안 닿고 머리로만 닿는 높이 — 컨트롤(캐리어 등록)은 못 하고 헤딩으로 걷어내기만
    // 된다. 그래서 띄운 공은 발밑 공처럼 그 자리에서 소유로 이어지지 않는다.
    if (this.ball.y > PARAMS.footControlHeight) {
      this.executeHeader(p);
      return;
    }

    // 상대가 같은 순간 볼에 붙어 있으면 줍기 전에 다툼부터 — 이겨야 잡는다.
    const opps = p.team === 'home' ? this.awayP : this.homeP;
    let challenger = null;
    let cbd = PARAMS.kickDist;
    for (const o of opps) {
      if (o.kc > 0) continue;
      const d = vlen(o.x - this.ball.x, o.z - this.ball.z);
      if (d <= cbd) {
        cbd = d;
        challenger = o;
      }
    }
    if (challenger) {
      p.kc = PARAMS.kickCooldownTicks;
      challenger.kc = PARAMS.kickCooldownTicks; // 승패 무관 — 이번 틱엔 둘 다 다시 못 다툰다
      if (this.resolveTackle(challenger, p)) {
        this.clearBall(challenger);
        return;
      }
      // 수비가 졌으면 공격이 그대로 잡는다 — 아래로 이어져 캐리어가 된다.
    }

    // 첫 터치 — 곧바로 패스/슛을 정하지 않고 일단 발밑에 붙인다(캐리어 등록). 실제 판단은
    // carrierDecide()가 판단 주기마다 한다 — 그래서 "잡자마자 반사적으로 패스"가 안 생긴다.
    this.ball.ownerKey = pKey;
    this.ball.carrierKey = pKey;
    // lastTouchKey도 여기서 갱신해야 한다 — 안 그러면 "킥 없이 주워서 그대로 드리블만 하다
    // 터치라인 밖으로 나간" 경우, 아웃오브바운즈 판정이 예전 킥의 lastTouchKey(심하면 상대
    // 팀 것)를 그대로 써서 스로인/코너킥/골킥을 엉뚱한 팀에게 줘버린다.
    this.ball.lastTouchKey = pKey;
    p.kc = this.decisionTicksFor(p);
  }

  /** @returns {boolean} 이번 틱에 골이 들어갔는지 — 아웃오브바운즈 판정을 건너뛸지 결정하는 데 쓴다. */
  checkGoal() {
    const b = this.ball;
    // 크로스바를 넘어간 볼은 골이 아니다. 여기서 false를 돌려주면 checkOutOfBounds()가
    // 이어받아 골킥으로 처리한다(마지막 터치가 공격 쪽이므로 규칙이 이미 맞다).
    if (b.y >= GOAL_H) return false;
    if (b.x <= -HALF.L && Math.abs(b.z) < GOAL_W / 2) {
      const scoringTeam = this.homeP[0]?.attackDirection === -1 ? 'home' : 'away';
      const concedingTeam = scoringTeam === 'home' ? 'away' : 'home';
      this.score[scoringTeam]++;
      const scorer = this.playerByKey(b.lastTouchKey);
      this.pushEvent('goal', scoringTeam, scoringTeam === 'home' && scorer ? `${scorer.name} 득점` : scoringTeam === 'home' ? '득점' : '실점');
      this.kickoff({ kickoffTeam: concedingTeam });
      return true;
    } else if (b.x >= HALF.L && Math.abs(b.z) < GOAL_W / 2) {
      const scoringTeam = this.homeP[0]?.attackDirection === 1 ? 'home' : 'away';
      const concedingTeam = scoringTeam === 'home' ? 'away' : 'home';
      this.score[scoringTeam]++;
      const scorer = this.playerByKey(b.lastTouchKey);
      this.pushEvent('goal', scoringTeam, scoringTeam === 'home' && scorer ? `${scorer.name} 득점` : scoringTeam === 'home' ? '득점' : '실점');
      this.kickoff({ kickoffTeam: concedingTeam });
      return true;
    }
    return false;
  }

  /**
   * 필드 밖으로 나간 볼을 처리한다 — 스로인(터치라인)/코너킥·골킥(골라인, 골은 아닌 쪽).
   * 마지막으로 볼을 건드린 팀(ball.lastTouchKey)으로 어느 팀에 주는지 정한다.
   */
  checkOutOfBounds() {
    const b = this.ball;
    const lastTeam = b.lastTouchKey ? b.lastTouchKey.split(':')[0] : null;

    if (Math.abs(b.z) >= HALF.W) {
      // 터치라인 아웃 — 마지막으로 안 건드린 팀이 스로인
      const throwInTeam = lastTeam === 'home' ? 'away' : 'home';
      const side = b.z > 0 ? 1 : -1;
      this.restart(throwInTeam, b.x, side * (HALF.W - PARAMS.restartInset), 'throw-in', '스로인');
      return true;
    }

    if (Math.abs(b.x) >= HALF.L) {
      const end = b.x > 0 ? 1 : -1;
      const defendingTeam = end === -(this.homeP[0]?.attackDirection ?? 1) ? 'home' : 'away';
      const attackingTeam = defendingTeam === 'home' ? 'away' : 'home';
      if (lastTeam === defendingTeam) {
        // 수비 쪽이 마지막으로 건드리고 나갔다 — 공격 팀 코너킥
        const cornerZ = (b.z > 0 ? 1 : -1) * (HALF.W - PARAMS.restartInset);
        const cornerX = end * (HALF.L - PARAMS.restartInset);
        this.restart(attackingTeam, cornerX, cornerZ, 'corner', '코너킥');
      } else {
        // 공격 쪽이 마지막으로 건드리고 나갔다(빗나간 슛 등) — 수비 팀 골킥
        const goalKickX = end * (HALF.L - PARAMS.goalKickDepth);
        this.restart(defendingTeam, goalKickX, 0, 'goal-kick', '골킥');
      }
      return true;
    }
    return false;
  }

  /**
   * 스로인/코너킥/골킥 공통 재개 처리 — 볼을 정지시켜 지정 위치에 놓고, 그 팀에서 가장
   * 가까운 선수(골킥은 골키퍼 우선)를 새 캐리어로 세운다. 이후 판단은 기존 carrierDecide
   * 파이프라인이 그대로 처리하므로 재개 전용 킥 로직을 따로 만들지 않는다.
   */
  restart(team, x, z, type, text) {
    this.ball.reset();
    this.ball.x = clamp(x, -HALF.L, HALF.L);
    this.ball.z = clamp(z, -HALF.W, HALF.W);
    const side = team === 'home' ? this.homeP : this.awayP;
    const taker = type === 'goal-kick' ? side.find((p) => p.role === 'GK') ?? closest(side, this.ball) : closest(side, this.ball);
    if (taker) {
      taker.x = this.ball.x;
      taker.z = this.ball.z;
      if (type === 'goal-kick') {
        // 골킥은 발밑에 붙여 드리블로 시작하지 않는다 — 그 자리에서 길게 걷어찬다.
        // lastTouchKey는 executeGoalKick()이 부르는 ball.kick()이 알아서 채운다.
        this.executeGoalKick(taker);
      } else {
        this.ball.ownerKey = `${taker.team}:${taker.idx}`;
        this.ball.carrierKey = `${taker.team}:${taker.idx}`;
        this.ball.lastTouchKey = `${taker.team}:${taker.idx}`;
        taker.kc = PARAMS.kickCooldownTicks;
      }
    }
    this.pushEvent(type, team, text);
  }

  pushEvent(type, team, text) {
    this.events.push({ tick: this.tick, minute: this.matchMinute, type, team, text });
    if (this.events.length > 50) this.events.shift();
  }

  /** 우리 팀(home)이 가장 최근 실점한 골 이벤트. 없으면 null. */
  getLastConcedeEvent() {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const ev = this.events[i];
      if (ev.type === 'goal' && ev.team === 'away') return ev;
    }
    return null;
  }

  /**
   * 되감기 버튼은 "그 실점이 일어난 순간"에만 그 골을 겨냥한다 — 감독이 그 자리에서
   * 안 쓰고 넘어가면 기회가 지나간 것이지, 경기 끝까지 계속 그 골을 되감을 수 있는 게
   * 아니다. PARAMS.concedeRewindWindowSeconds가 지나면 더는 이 이벤트를 겨냥하지 않는다.
   */
  getActiveConcedeEvent() {
    const concede = this.getLastConcedeEvent();
    if (!concede) return null;
    const elapsed = (this.tick - concede.tick) * PARAMS.dt;
    return elapsed <= PARAMS.concedeRewindWindowSeconds ? concede : null;
  }

  /**
   * 되감기 목표 tick. 실점 이벤트가 아직 기회(concedeRewindWindowSeconds) 안에 있을 때만
   * 그 직전(rewindLookbackSeconds만큼 앞)을 계산한다. 되감기는 그 순간에만 쓸 수
   * 있는 것이라 그 외에는 폴백 없이 null — 호출 전에 반드시 canRewind()로 확인해야 한다.
   *
   * 전반에 난 실점을 후반에서 되감지 않도록 그 하프의 시작보다 앞으로는 가지 않는다.
   */
  getRewindTargetTick() {
    const concede = this.getActiveConcedeEvent();
    if (!concede) return null;
    const halfStartTick = this.half === 2 ? PARAMS.halfMinutes / PARAMS.dt : 0;
    const target = concede.tick - PARAMS.rewindLookbackSeconds / PARAMS.dt;
    // 하프 시작보다 앞으로는 가지 않되, 실점 시점보다 뒤로도 가지 않는다
    // (하프 시작 직후에 실점하면 두 한계가 서로 엇갈릴 수 있다).
    return Math.min(concede.tick, Math.max(halfStartTick, target));
  }

  /**
   * 되감기를 지금 실행해도 되는지 — 실점 이벤트가 기회 안에 있어야 하고(그 순간에만
   * 되감기가 의미를 가진다), 후반 막판이 아니어야 하고, 쿨다운도 지나 있어야 한다.
   */
  canRewind() {
    if (!this.getActiveConcedeEvent()) return false; // 되감기는 실점 순간에만 쓸 수 있다
    if (this.half === 2 && this.matchMinute >= 85) return false; // 마지막 5분은 확정 — 되감기 불가
    if (
      this.lastRewindTick !== null &&
      (this.tick - this.lastRewindTick) * PARAMS.dt < PARAMS.rewindCooldownSeconds
    ) {
      return false; // 쿨다운 중
    }
    return true;
  }

  /**
   * 되감기가 "지금 일어났다"는 기록. restore()가 과거로 시계를 돌리는 것과 별개로,
   * 이 시점(=restore 이후의 this.tick)을 쿨다운 기준으로 남긴다.
   */
  markRewindUsed() {
    this.lastRewindTick = this.tick;
  }

  /** 되감기용 스냅샷. 숫자만 담아 GC 압박과 복사 비용을 낮춘다. */
  snapshot() {
    // Float32면 반올림 오차 때문에 되감은 뒤 경기가 미세하게 갈라진다.
    // 되감기가 이 서비스의 핵심이므로 정밀도를 택한다 (900스냅샷 ≈ 1.1MB).
    const players = new Float64Array(this.all.length * SNAP_STRIDE);
    this.all.forEach((p, i) => {
      const o = i * SNAP_STRIDE;
      players[o] = p.x;
      players[o + 1] = p.z;
      players[o + 2] = p.vx;
      players[o + 3] = p.vz;
      players[o + 4] = p.heading;
      players[o + 5] = p.energy;
      players[o + 6] = p.kc; // 킥 쿨다운까지 담아야 되감기가 무손실이 된다
    });
    return {
      tick: this.tick,
      players,
      // 높이(y, vy)는 뒤에 덧붙인다 — 4개짜리 옛 스냅샷도 그대로 복원되게 하려는 것이다.
      ball: [this.ball.x, this.ball.z, this.ball.vx, this.ball.vz, this.ball.y, this.ball.vy],
      ownerKey: this.ball.ownerKey,
      carrierKey: this.ball.carrierKey,
      lastTouchKey: this.ball.lastTouchKey,
      score: { ...this.score },
      rng: this.rng.s,
      eventCount: this.events.length,
      tactics: { ...this.tactics },
      half: this.half,
      phase: this.phase,
      kickoffLock: this.kickoffLock ? { ...this.kickoffLock } : null,
      lastRewindTick: this.lastRewindTick,
      // 경로 지시는 좌표 배열이라 SNAP_STRIDE 숫자 배열에 안 들어간다 — 선수 순서(this.all)와
      // 나란한 별도 배열로 얕은 구조 복제한다. 되감기 후 안 바꾸면 그대로 재현돼야 하므로
      // 진행 중인 지시도 반드시 여기 담는다(안 담으면 되감기 넘어서 지시가 사라지는 버그가 난다).
      commands: this.all.map((p) =>
        p.command ? { waypoints: p.command.waypoints.map((w) => ({ x: w.x, z: w.z })), index: p.command.index } : null
      ),
      // 키핑(hold) vs 전진 드리블(advance) — 다음 판단 주기까지 유지되는 캐리어 상태라
      // 되감기 후에도 그대로 재현돼야 한다. 1/0 숫자 배열로 담아 SNAP_STRIDE 구조를 안 건드린다.
      dribbleModes: this.all.map((p) => (p.dribbleMode === 'hold' ? 1 : 0)),
    };
  }

  restore(s) {
    this.all.forEach((p, i) => {
      const o = i * SNAP_STRIDE;
      p.x = s.players[o];
      p.z = s.players[o + 1];
      p.vx = s.players[o + 2];
      p.vz = s.players[o + 3];
      p.heading = s.players[o + 4];
      p.energy = s.players[o + 5];
      p.kc = s.players[o + 6];
    });
    const [bx, bz, bvx, bvz, by, bvy] = s.ball;
    this.ball.x = bx;
    this.ball.z = bz;
    this.ball.vx = bvx;
    this.ball.vz = bvz;
    // 옛 스냅샷 호환: 높이가 없으면 땅에 있던 것으로 취급한다.
    this.ball.y = by ?? PARAMS.ballRadius;
    this.ball.vy = bvy ?? 0;
    this.ball.ownerKey = s.ownerKey;
    this.ball.carrierKey = 'carrierKey' in s ? s.carrierKey : null; // 옛 스냅샷 호환: 없으면 자유 상태로 취급
    this.ball.lastTouchKey = 'lastTouchKey' in s ? s.lastTouchKey : null; // 옛 스냅샷 호환: 없으면 알 수 없음 취급
    this.score = { ...s.score };
    this.tick = s.tick;
    this.rng.s = s.rng;
    this.events.length = s.eventCount; // 되감은 시점 이후의 사건은 없던 일이 된다
    if (s.tactics) {
      this.tactics = { ...s.tactics }; // 옛 스냅샷 호환: 필드가 없으면 현재 값 유지
      // width는 p.home(정렬 목표 좌표)에서 파생된다. 재계산하지 않으면
      // 되감은 뒤에도 변경 후 width가 스티어링 목표에 남아 재현성이 깨진다.
      this.refreshHomeSlots();
    }
    // 옛 스냅샷 호환: half/phase/kickoffLock/lastRewindTick이 없으면 현재 값 유지
    if (s.half !== undefined) this.half = s.half;
    if (s.phase !== undefined) this.phase = s.phase;
    if ('kickoffLock' in s) this.kickoffLock = s.kickoffLock ? { ...s.kickoffLock } : null;
    if ('lastRewindTick' in s) this.lastRewindTick = s.lastRewindTick;
    // 옛 스냅샷 호환: commands가 없으면 현재 지시 상태를 그대로 둔다(건드리지 않음).
    if (s.commands) {
      this.all.forEach((p, i) => {
        const c = s.commands[i];
        p.command = c ? { waypoints: c.waypoints.map((w) => ({ ...w })), index: c.index } : null;
      });
    }
    // 옛 스냅샷 호환: dribbleModes가 없으면 기본값('advance')을 그대로 둔다.
    if (s.dribbleModes) {
      this.all.forEach((p, i) => {
        p.dribbleMode = s.dribbleModes[i] ? 'hold' : 'advance';
      });
    }
  }
}
