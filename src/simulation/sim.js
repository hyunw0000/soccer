import { PARAMS, FIELD, HALF, GOAL_W } from './params.js';
import { vlen, clamp } from './math.js';
import { Rng } from './rng.js';
import { Player, Ball } from './entities.js';
import { assignmentSlot, INSTRUCTION_FALLBACK } from './coordinates.js';
import { arrive, pursuit, separation, closest } from './steering.js';

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
// 아직 실점이 없을 때의 대체 되감기 폭 — match.js의 기존 "8초 되감기"와 같은 단위
const FALLBACK_REWIND_SECONDS = 8;

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
      if (sp > 0.5) p.heading = Math.atan2(p.vx, p.vz);
      if (p.kc > 0) p.kc--;

      const drain = (sp / PARAMS.maxSpeed) * (0.6 + press * 0.8) * (110 - p.stamina) / 100;
      p.energy = clamp(p.energy - drain * dt * 0.004, 0.35, 1);
    }

    for (const p of this.all) this.tryKick(p);
    this.ball.update(dt);
    this.checkGoal();
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

  tryKick(p) {
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

    p.kc = PARAMS.kickCooldownTicks;

    // 상대가 같은 순간 볼에 붙어 있으면 태클/인터셉트 다툼 — 수비스탯(체력승수 포함) vs
    // 드리블스탯. 이겨야 원래 하려던 패스/슛/드리블이 그대로 나간다. 지면 상대가 그 자리에서
    // 걷어낸다(그 클리어링도 킥이라 같은 오차 모델을 그대로 쓴다 — 별도 성공/실패 판정 없음).
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
      challenger.kc = PARAMS.kickCooldownTicks; // 승패 무관 — 이번 틱엔 둘 다 다시 못 다툰다
      const staminaMult = 0.55 + 0.45 * challenger.energy;
      const def = challenger.defenseSkill * staminaMult;
      const winProb = clamp(def / (def + p.dribbleSkill), PARAMS.tackleWinMin, PARAMS.tackleWinMax);
      if (this.rng.next() < winProb) {
        this.ball.ownerKey = `${challenger.team}:${challenger.idx}`;
        const cdx = challenger.atkX - challenger.x;
        const cdz = 0 - challenger.z;
        const errDeg = this.errorDegrees(challenger, {
          statValue: challenger.passSkill,
          distance: PARAMS.distanceErrorRef,
          baseDeg: PARAMS.passBaseErrorDeg,
        });
        const [edx, edz] = this.rotateXZ(cdx, cdz, errDeg);
        this.ball.kick(edx, edz, PARAMS.clearForce);
        this.pushEvent('tackle', challenger.team, `${challenger.name} 볼 탈취`);
        return;
      }
    }

    this.ball.ownerKey = `${p.team}:${p.idx}`;

    const gdx = p.atkX - p.x;
    const gdz = 0 - p.z;
    const gd = vlen(gdx, gdz);
    const tempo = p.team === 'home' ? this.tactics.tempo : 0.5;
    // 개인 지시는 홈팀 선수에게만 있다 (원정은 전부 0.5로 들어온다).
    const risk = p.ins.risk;
    const long = p.ins.passLength;

    // 골문에 가까우면 슛. 템포가 높을수록, 모험적인 선수일수록 과감하게 때린다.
    if (gd < 30 && this.rng.next() < 0.25 + tempo * 0.3 + (risk - 0.5) * 0.3) {
      const errDeg = this.errorDegrees(p, { statValue: p.shootSkill, distance: gd, baseDeg: PARAMS.shotBaseErrorDeg });
      const [edx, edz] = this.rotateXZ(gdx, gdz, errDeg);
      this.ball.kick(edx, edz, PARAMS.shootForce);
      return;
    }

    let best = null;
    let bs = -Infinity;
    const candidates = [];
    const mates = p.team === 'home' ? this.homeP : this.awayP;
    for (const m of mates) {
      if (m === p || m.role === 'GK') continue;
      const d = vlen(m.x - p.x, m.z - p.z);
      if (d < PARAMS.minPass || d > PARAMS.maxPass) continue;
      // 인지 필터: 시야가 나쁘면 좋은 동료가 후보 목록에 아예 안 잡힌다(성공/실패가 아니라
      // "못 봄"). 시야 60 이상이면 절대 안 놓친다.
      const missChance = clamp((PARAMS.visionRefStat - p.visionSkill) / 100, 0, PARAMS.visionMaxMissChance);
      if (this.rng.next() < missChance) continue;
      const fwd = (m.x - p.x) * (p.team === 'home' ? 1 : -1);
      // 템포가 높으면 전진 패스 가중치가 커진다 (점유 → 직선).
      // 리스크는 전진 패스를 더 노리게 하고, 패스 길이는 먼 동료의 감점을 줄인다.
      const sc = fwd * (0.7 + tempo * 0.8 + (risk - 0.5) * 0.6) - d * (0.26 - long * 0.22);
      candidates.push({ m, sc, fwd });
      if (sc > bs) {
        bs = sc;
        best = m;
      }
    }
    // 선택 개성: "자아"는 무작위 선택이 아니라 1등을 매번 고르지는 않는 것이다.
    // boldness가 중립(0.5)이면 항상 점수 1등. 과감할수록 가끔 후보 중 가장 전진적인 대안을,
    // 신중할수록 가끔 가장 안전한(덜 전진적인) 대안을 대신 고른다 — 그 "가끔"의 빈도가 성격이다.
    if (best && candidates.length > 1) {
      const bold = p.boldness - 0.5;
      const deviateProb = Math.abs(bold) * 2 * PARAMS.personalityDeviateMax;
      if (this.rng.next() < deviateProb) {
        const ranked = [...candidates].sort((a, b) => b.sc - a.sc).slice(0, PARAMS.personalityTopN);
        if (bold > 0) {
          // 과감: 1등이 아닌 아무 대안이나 — 점수 1등이 곧 "제일 전진적인 패스"인 경우가
          // 많은 이 공식 특성상, 2등 이하로 새는 것 자체가 이미 "무리한 선택"으로 읽힌다.
          const alts = ranked.slice(1);
          if (alts.length) best = alts[Math.floor(this.rng.next() * alts.length)].m;
        } else {
          // 신중: 후보 중 가장 안전한(덜 전진적인) 쪽으로 확실히 문다.
          best = ranked.reduce((a, b) => (b.fwd < a.fwd ? b : a)).m;
        }
      }
    }
    if (best) {
      const dx = best.x - p.x;
      const dz = best.z - p.z;
      const errDeg = this.errorDegrees(p, { statValue: p.passSkill, distance: vlen(dx, dz), baseDeg: PARAMS.passBaseErrorDeg });
      const [edx, edz] = this.rotateXZ(dx, dz, errDeg);
      this.ball.kick(edx, edz, PARAMS.passForce);
      return;
    }
    this.ball.kick(gdx, gdz, PARAMS.dribbleForce);
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
   * 되감기 목표 tick.
   * 실점 이벤트가 있으면 그 직전(EVENT_REWIND_LOOKBACK_SECONDS만큼 앞)을,
   * 없으면 지금으로부터 FALLBACK_REWIND_SECONDS만큼 앞을 목표로 한다.
   */
  getRewindTargetTick() {
    const concede = this.getLastConcedeEvent();
    if (concede) {
      return Math.max(0, concede.tick - EVENT_REWIND_LOOKBACK_SECONDS / PARAMS.dt);
    }
    return Math.max(0, this.tick - FALLBACK_REWIND_SECONDS / PARAMS.dt);
  }

  /** 되감기를 지금 실행해도 되는지 — 후반 막판 잠금과 쿨다운을 검사한다. */
  canRewind() {
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
  }
}
