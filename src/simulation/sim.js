import { PARAMS, FIELD, HALF, GOAL_W } from './params.js';
import { vlen, clamp } from './math.js';
import { Rng } from './rng.js';
import { Player, Ball } from './entities.js';
import { slotPosition } from './coordinates.js';
import { arrive, pursuit, separation, closest } from './steering.js';

const AWAY_NAMES = ['GK', 'RB', 'RCB', 'LCB', 'LB', 'RCM', 'CM', 'LCM', 'RW', 'ST', 'LW'];
const SIM_TACTIC_FALLBACK = { lineHeight: 0.5, pressing: 0.5, tempo: 0.5, width: 0.5 };
// 스냅샷 1인당 저장 항목 수: x, z, vx, vz, heading, energy, kc
const SNAP_STRIDE = 7;

/**
 * 경기 시뮬레이션. Three.js를 전혀 import 하지 않는 순수 모듈이다.
 * - 렌더러는 sim.homeP / sim.awayP / sim.ball 을 읽기만 한다
 * - 모든 상태가 평범한 숫자라서 snapshot()/restore() 로 되감기가 가능하다
 */
export class Sim {
  /**
   * @param {object} cfg
   * @param {Array}  cfg.lineup   홈 11인 [{num,name,pace,stamina}]
   * @param {string} cfg.formation 포메이션 키
   * @param {Array}  cfg.formationSlots 홈 포메이션 정규화 슬롯
   * @param {object} cfg.tactics  전술 슬라이더 값
   * @param {string} cfg.oppFormation 상대 포메이션
   * @param {Array}  cfg.oppFormationSlots 상대 포메이션 정규화 슬롯
   * @param {number} cfg.seed
   */
  constructor({
    lineup,
    formation,
    formationSlots,
    tactics = SIM_TACTIC_FALLBACK,
    oppFormation = '4-4-2',
    oppFormationSlots,
    seed = 2026,
  }) {
    this.formation = formation;
    this.formationSlots = formationSlots;
    this.oppFormation = oppFormation;
    this.oppFormationSlots = oppFormationSlots;
    this.tactics = { ...SIM_TACTIC_FALLBACK, ...tactics };
    this.seed = seed;
    this.lineup = lineup;
    this.build();
  }

  build() {
    this.rng = new Rng(this.seed);
    this.tick = 0;
    this.score = { home: 0, away: 0 };
    this.events = []; // {tick, type, team, text}

    this.homeP = this.lineup.map(
      (meta, i) =>
        new Player({
          team: 'home',
          idx: i,
          meta,
          slot: slotPosition(this.formationSlots, i, 'home', this.tactics.width),
        })
    );
    this.awayP = AWAY_NAMES.map(
      (name, i) =>
        new Player({
          team: 'away',
          idx: i,
          meta: { num: i + 1, name, pace: 78, stamina: 78 },
          slot: slotPosition(this.oppFormationSlots, i, 'away', 0.5),
        })
    );
    this.all = [...this.homeP, ...this.awayP];
    this.ball = new Ball();
  }

  /** 라인업/포메이션/전술을 경기 도중에 갈아끼운다 (교체·전술 변경용) */
  applyTactics(tactics) {
    this.tactics = { ...this.tactics, ...tactics };
    this.refreshHomeSlots();
  }

  setFormation(key, slots = this.formationSlots) {
    this.formation = key;
    this.formationSlots = slots;
    this.refreshHomeSlots();
  }

  refreshHomeSlots() {
    this.homeP.forEach((p, i) => {
      const s = slotPosition(this.formationSlots, i, 'home', this.tactics.width);
      p.home.x = s.x;
      p.home.z = s.z;
      p.role = s.role;
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
      const press = mine ? t.pressing : 0.5;
      const line = mine ? t.lineHeight : 0.5;

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
        const tx = p.home.x + shift;
        const tz = p.home.z + (this.ball.z - p.home.z) * (0.08 + press * 0.14);
        if (vlen(tx - p.x, tz - p.z) > PARAMS.comfortZone) [fx, fz] = arrive(p, tx, tz);
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

    // 골문에 가까우면 슛. 템포가 높을수록 과감하게 때린다.
    if (gd < 30 && this.rng.next() < 0.25 + tempo * 0.3) {
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
      // 템포가 높으면 전진 패스 가중치가 커진다 (점유 → 직선)
      const sc = fwd * (0.7 + tempo * 0.8) - d * 0.15;
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
