import { PARAMS, FIELD, HALF, GOAL_W } from './params.js';
import { vlen, clamp } from './math.js';
import { Rng, seededRandom, seededRandomPlayerId, ACTION_ID } from './rng.js';
import { Player, Ball } from './entities.js';
import { assignmentSlot, INSTRUCTION_FALLBACK } from './coordinates.js';
import { arrive, pursuit, separation, closest } from './steering.js';
import { chooseAction, effectivePressing } from './decision.js';

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
// 실점 이벤트로부터 몇 초(clockSeconds 단위) 전을 되감기 목표로 삼을지
const EVENT_REWIND_LOOKBACK_SECONDS = 3;

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
      p.home.x = s.x;
      p.home.z = s.z;
      p.role = s.role;
      // 경기 중 지시 변경도 여기로 들어온다. 다음 스텝부터 바로 반영된다.
      p.ins = s.instruction;
    });
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
      partner.x = (kickoffTeam === 'home' ? -1 : 1) * (PARAMS.minPass + 1);
      partner.z = 0;
    }
    if (taker && partner) {
      // tryKick()의 일반 패스 점수(전진 편향)에 맡기면 파트너가 아닌 다른 선수에게 갈 수 있어
      // 킥오프 첫 패스만은 taker -> partner로 직접 지정한다 (실제 킥오프는 항상 옆·뒤로 짧게 시작한다)
      taker.kc = PARAMS.kickCooldownTicks;
      this.ball.kick(partner.x - taker.x, partner.z - taker.z, PARAMS.passForce);
    } else if (taker) {
      this.ball.ownerKey = `${taker.team}:${taker.idx}`;
      this.ball.carrierKey = `${taker.team}:${taker.idx}`;
    }
    this.kickoffLock = { team: kickoffTeam, active: true };
  }

  /** 후반 시작 — 관례상 원정팀 킥오프 */
  startSecondHalf() {
    this.half = 2;
    this.phase = 'playing';
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

    for (const p of this.all) {
      const mates = p.team === 'home' ? this.homeP : this.awayP;
      const chaser = p.team === 'home' ? hc : ac;
      const mine = p.team === 'home';
      const restricted = !!lock && p.team !== lock.team;
      // 전술은 홈팀에만 적용한다 (감독은 우리 팀만 지시한다)
      // 개인 지시는 팀 값을 덮어쓰지 않고 ±0.3까지 밀거나 당긴다 — 팀 전술이 여전히 뼈대다.
      const press = mine ? clamp(t.pressing + (p.ins.pressing - 0.5) * 0.6, 0, 1) : 0.5;
      const line = mine ? t.lineHeight : 0.5;
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
        const gx = (mine ? -HALF.L : HALF.L) + (mine ? 2 : -2);
        const gz = clamp(this.ball.z * 0.5, -GOAL_W / 2, GOAL_W / 2);
        [fx, fz] = arrive(p, gx, gz);
      } else if (isCarrier && p.dribbleMode === 'hold') {
        // 키핑 — 판단(decision.js scoreHoldCandidate)이 "제자리에서 볼을 지킨다"를 골랐을 때.
        // 목표를 자기 자신으로 두면 arrive()가 [0,0]을 돌려줘 정지 상태가 된다.
        [fx, fz] = arrive(p, p.x, p.z);
      } else if (isCarrier) {
        // 드리블 중 — 공을 몰고 상대 골 쪽으로 전진한다(목표를 매 틱 앞으로 다시 잡아 계속
        // 전진하게 만든다). 개인 지시(roaming)로 살짝 좌우 흔들림을 준다.
        const dir = mine ? 1 : -1;
        const tx = clamp(p.x + dir * PARAMS.dribbleLookahead, -HALF.L, HALF.L);
        const tz = clamp(p.z + (p.ins.roaming - 0.5) * PARAMS.dribbleLookahead, -HALF.W, HALF.W);
        [fx, fz] = arrive(p, tx, tz);
      } else if (p === chaser) {
        [fx, fz] = pursuit(p, this.ball);
      } else {
        // 고정 위치를 따라 블록 전체가 밀린다. lineHeight가 전진 폭을 늘린다
        const shift = (this.ball.x / FIELD.L) * (14 + line * 22);
        // 우리팀이 공을 갖고 있을 때만 개인차 있는 침투런을 반영한다
        const run = holding ? (p.ins.runs - 0.5) * RUN_PUSH * (mine ? 1 : -1) : 0;
        let tx = p.home.x + shift + run;
        let tz = p.home.z + (this.ball.z - p.home.z) * (0.08 + press * 0.14) * (0.5 + p.ins.roaming);
        if (restricted) {
          // 킥오프 규정: 상대팀 선수는 볼이 움직이기 전까지 센터서클 밖에 있어야 한다
          const d = vlen(tx, tz);
          if (d < PARAMS.centerCircleRadius) {
            if (d < 1e-6) {
              tx = (mine ? -1 : 1) * PARAMS.centerCircleRadius;
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
      p.x = clamp(p.x + p.vx * dt, -HALF.L - 1, HALF.L + 1);
      p.z = clamp(p.z + p.vz * dt, -HALF.W, HALF.W);
      if (isCarrier) {
        // 드리블로는 골라인을 절대 못 넘는다(골은 슛으로만) — mandatoryShotDistance가 미리
        // 슛을 강제하지만, 그 전에라도 몸으로 넘어가 버리는 걸 여기서 한 번 더 확실히 막는다.
        // dribbleCarryOffset(볼을 몸 앞에 붙이는 거리)만큼 더 여유를 둬야, 붙어있는 볼까지
        // 골라인에 안 닿는다 — 안 그러면 슛으로 놓는 순간 볼이 이미 골라인 위에 있어서
        // 슛이 날아가기도 전에 골로 잡히는 버그가 난다(실제로 겪었다).
        const goalLimit = HALF.L - PARAMS.dribbleCarryOffset - 0.5;
        p.x = mine ? Math.min(p.x, goalLimit) : Math.max(p.x, -goalLimit);
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
      }

      const drain = (sp / PARAMS.maxSpeed) * (0.6 + press * 0.8) * (110 - p.stamina) / 100;
      p.energy = clamp(p.energy - drain * dt * 0.004, 0.35, 1);
    }

    for (const p of this.all) this.tryKick(p);
    // 드리블 중엔 이미 위(캐리어 처리)에서 매 틱 위치를 붙여놨다 — 마찰/관성 물리를 또 적용하면 안 된다.
    if (!this.ball.carrierKey) this.ball.update(dt);
    // 골은 슛(킥)으로만 넣는다 — 드리블로 공을 몰고 골라인을 그냥 지나가는 건 골이 아니다.
    // 캐리어가 있는 동안은 골 판정을 아예 안 한다(아래 carrierDecide의 골문 근처 슛 강제와 짝).
    if (!this.ball.carrierKey) this.checkGoal();
    this.tick++;
    this.updatePhase();
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
    this.ball.kick(edx, edz, PARAMS.clearForce); // kick()이 carrierKey도 같이 지운다
    this.pushEvent('tackle', defender.team, `${defender.name} 볼 탈취`);
  }

  /** 캐리어를 드리블 중에 노리는 상대. 사거리 안에 실제로 붙어야 다툰다. */
  tryTackleCarrier(defender) {
    const carrier = this.playerByKey(this.ball.carrierKey);
    if (!carrier) return;
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
    this.ball.kick(edx, edz, PARAMS.passForce);
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
    this.ball.kick(edx, edz, PARAMS.shootForce);
  }

  /** 드리블 유지 — "계속 갈지"는 이미 판단(점수 비교)에서 끝났다. 확률 판정 없음. */
  executeDribble(p) {
    p.dribbleMode = 'advance';
    p.kc = PARAMS.dribbleDecisionTicks;
  }

  /** 키핑 — 다음 판단 주기까지 제자리에서 볼을 지킨다. 확률 판정 없음. */
  executeHold(p) {
    p.dribbleMode = 'hold';
    p.kc = PARAMS.dribbleDecisionTicks;
  }

  /** 클리어 — 압박에 밀린 캐리어가 무조건 앞으로 걷어낸다. 클리어링이라 오차를 크게 잡는다. */
  executeClear(p) {
    const cdx = p.atkX - p.x;
    const cdz = 0 - p.z;
    const errDeg = this.errorDegrees(p, { statValue: p.passSkill, distance: PARAMS.distanceErrorRef, baseDeg: PARAMS.clearBaseErrorDeg });
    const [edx, edz] = this.rotateXZ(cdx, cdz, errDeg);
    this.ball.kick(edx, edz, PARAMS.clearForce);
    this.pushEvent('tackle', p.team, `${p.name} 압박에 클리어`);
  }

  tryKick(p) {
    const pKey = `${p.team}:${p.idx}`;

    if (this.ball.carrierKey) {
      // 볼이 이미 누군가의 발밑에 있다 — 그 사람이면 계속 갈지/풀지 재판단하고,
      // 상대편이면(같은 편은 아무 것도 안 함) 사거리 안일 때만 태클을 시도한다.
      if (this.ball.carrierKey === pKey) {
        if (p.kc <= 0) this.carrierDecide(p);
      } else if (p.team !== this.ball.carrierKey.split(':')[0] && p.kc <= 0) {
        this.tryTackleCarrier(p);
      }
      return;
    }

    // 볼이 자유 상태(아무도 안 갖고 있음) — 이 틱에 실제로 주울 수 있는 사람만 처리한다.
    if (p.kc > 0 || vlen(p.x - this.ball.x, p.z - this.ball.z) > PARAMS.kickDist) return;

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
    p.kc = PARAMS.dribbleDecisionTicks;
  }

  checkGoal() {
    const b = this.ball;
    if (b.x <= -HALF.L && Math.abs(b.z) < GOAL_W / 2) {
      this.score.away++;
      this.pushEvent('goal', 'away', '실점');
      this.kickoff({ kickoffTeam: 'home' }); // 실점 팀이 킥오프한다
    } else if (b.x >= HALF.L && Math.abs(b.z) < GOAL_W / 2) {
      this.score.home++;
      const scorer = this.playerByKey(b.ownerKey);
      this.pushEvent('goal', 'home', scorer ? `${scorer.name} 득점` : '득점');
      this.kickoff({ kickoffTeam: 'away' }); // 실점 팀이 킥오프한다
    }
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
   * 그 직전(EVENT_REWIND_LOOKBACK_SECONDS만큼 앞)을 계산한다. 되감기는 그 순간에만 쓸 수
   * 있는 것이라 그 외에는 폴백 없이 null — 호출 전에 반드시 canRewind()로 확인해야 한다.
   */
  getRewindTargetTick() {
    const concede = this.getActiveConcedeEvent();
    if (!concede) return null;
    return Math.max(0, concede.tick - EVENT_REWIND_LOOKBACK_SECONDS / PARAMS.dt);
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
      ball: [this.ball.x, this.ball.z, this.ball.vx, this.ball.vz],
      ownerKey: this.ball.ownerKey,
      carrierKey: this.ball.carrierKey,
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
    [this.ball.x, this.ball.z, this.ball.vx, this.ball.vz] = s.ball;
    this.ball.ownerKey = s.ownerKey;
    this.ball.carrierKey = 'carrierKey' in s ? s.carrierKey : null; // 옛 스냅샷 호환: 없으면 자유 상태로 취급
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
