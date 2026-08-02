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

  kickoff() {
    this.ball.reset();
    for (const p of this.all) {
      p.x = p.home.x;
      p.z = p.home.z;
      p.vx = 0;
      p.vz = 0;
      p.kc = 0;
    }
  }

  playerByKey(key) {
    if (!key) return null;
    const [team, idx] = key.split(':');
    return (team === 'home' ? this.homeP : this.awayP)[Number(idx)] ?? null;
  }

  step() {
    const dt = PARAMS.dt;
    const t = this.tactics;
    const hc = closest(this.homeP, this.ball);
    const ac = closest(this.awayP, this.ball);

    for (const p of this.all) {
      const mates = p.team === 'home' ? this.homeP : this.awayP;
      const chaser = p.team === 'home' ? hc : ac;
      const mine = p.team === 'home';
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

      if (p.role === 'GK') {
        const gx = (mine ? -HALF.L : HALF.L) + (mine ? 2 : -2);
        const gz = clamp(this.ball.z * 0.5, -GOAL_W / 2, GOAL_W / 2);
        [fx, fz] = arrive(p, gx, gz);
      } else if (p === chaser) {
        [fx, fz] = pursuit(p, this.ball);
      } else {
        // 공 위치를 따라 블록 전체가 밀린다. lineHeight가 전진 폭을 키운다.
        const shift = (this.ball.x / FIELD.L) * (14 + line * 22) * (mine ? 1 : -1);
        // 침투는 우리가 공을 잡고 있을 때만 나간다. 뺏긴 채로 앞에 서 있으면 뒷공간만 열린다.
        const run = holding ? (p.ins.runs - 0.5) * RUN_PUSH * (mine ? 1 : -1) : 0;
        const tx = p.home.x + shift + run;
        // 움직임이 큰 선수일수록 공 쪽으로 더 옮겨 다니고, 낮으면 대형을 지킨다.
        const tz =
          p.home.z + (this.ball.z - p.home.z) * (0.08 + press * 0.14) * (0.5 + p.ins.roaming);
        // 커버 범위가 넓은 선수는 자기 자리에서 더 멀어져도 그냥 둔다 (그만큼 자리를 비운다).
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
  }

  tryKick(p) {
    if (p.kc > 0 || vlen(p.x - this.ball.x, p.z - this.ball.z) > PARAMS.kickDist) return;
    p.kc = PARAMS.kickCooldownTicks;
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
      this.ball.kick(gdx, gdz + (this.rng.next() - 0.5) * 6, PARAMS.shootForce);
      return;
    }

    let best = null;
    let bs = -Infinity;
    const mates = p.team === 'home' ? this.homeP : this.awayP;
    for (const m of mates) {
      if (m === p || m.role === 'GK') continue;
      const d = vlen(m.x - p.x, m.z - p.z);
      if (d < PARAMS.minPass || d > PARAMS.maxPass) continue;
      const fwd = (m.x - p.x) * (p.team === 'home' ? 1 : -1);
      // 템포가 높으면 전진 패스 가중치가 커진다 (점유 → 직선).
      // 리스크는 전진 패스를 더 노리게 하고, 패스 길이는 먼 동료의 감점을 줄인다.
      const sc = fwd * (0.7 + tempo * 0.8 + (risk - 0.5) * 0.6) - d * (0.26 - long * 0.22);
      if (sc > bs) {
        bs = sc;
        best = m;
      }
    }
    if (best) {
      this.ball.kick(best.x - p.x, best.z - p.z, PARAMS.passForce);
      return;
    }
    this.ball.kick(gdx, gdz, PARAMS.dribbleForce);
  }

  checkGoal() {
    const b = this.ball;
    if (b.x <= -HALF.L && Math.abs(b.z) < GOAL_W / 2) {
      this.score.away++;
      this.pushEvent('goal', 'away', '실점');
      this.kickoff();
    } else if (b.x >= HALF.L && Math.abs(b.z) < GOAL_W / 2) {
      this.score.home++;
      const scorer = this.playerByKey(b.ownerKey);
      this.pushEvent('goal', 'home', scorer ? `${scorer.name} 득점` : '득점');
      this.kickoff();
    }
  }

  pushEvent(type, team, text) {
    this.events.push({ tick: this.tick, minute: this.matchMinute, type, team, text });
    if (this.events.length > 50) this.events.shift();
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
  }
}
