import { PARAMS, HALF } from './params.js';
import { vlen } from './math.js';
import { INSTRUCTION_FALLBACK } from './coordinates.js';

/**
 * 선수 1명의 물리/상태. Three.js 객체를 절대 들고 있지 않는다.
 * 렌더링 쪽은 이 상태를 읽기만 하므로, 스냅샷 저장/복원(되감기)이 가능하다.
 */
export class Player {
  constructor({ team, idx, meta, slot }) {
    this.team = team; // 'home' | 'away'
    this.idx = idx;
    this.num = meta.num;
    this.name = meta.name;
    this.role = slot.role;
    // 감독이 이 선수에게만 준 지시 8축(0..1). 경기 중에도 바뀌지 않으므로 스냅샷에 담지 않는다.
    this.ins = slot.instruction ?? { ...INSTRUCTION_FALLBACK };
    this.pace = meta.pace;
    this.stamina = meta.stamina ?? 75;
    // 패스/슛 전용 스탯은 아직 MatchSetup 계약에 없다(SimulationPlayer는 현재 pace/stamina만 싣는다).
    // 들어오면 그대로 쓰고, 없으면 pace를 대리 지표로 쓴다 — 계약이 넓어지면 자동으로 더 정확해진다.
    this.passSkill = meta.pass ?? meta.pace;
    this.shootSkill = meta.shoot ?? meta.pace;
    this.defenseSkill = meta.defense ?? meta.pace;
    this.dribbleSkill = meta.dribble ?? meta.pace;
    this.visionSkill = meta.vision ?? meta.pace;
    // 0..1, 0.5=중립(항상 점수 1등을 고름). 계약에 없으면 중립 — 기존 동작을 그대로 보존한다.
    this.boldness = meta.boldness ?? 0.5;
    this.maxSpeedBase = PARAMS.maxSpeed * (0.82 + meta.pace / 100 * 0.36);
    this.maxSpeed = this.maxSpeedBase;
    this.energy = 1; // 1 → 0 으로 소모, 속도에 곱해진다
    this.home = { x: slot.x, z: slot.z };
    this.x = slot.x;
    this.z = slot.z;
    this.vx = 0;
    this.vz = 0;
    this.kc = 0; // kick cooldown
    this.heading = team === 'home' ? 0 : Math.PI;
    // 되감기 후 드래그로 내리는 경로 지시. { waypoints: [{x,z},...], index } | null.
    // 있으면 기본 AI(추격/포메이션 유지) 대신 이 경로를 arrive()로 따라간다.
    this.command = null;
  }

  /** 공격 방향 골라인의 x좌표 */
  get atkX() {
    return this.team === 'home' ? HALF.L : -HALF.L;
  }

  get speed() {
    return vlen(this.vx, this.vz);
  }
}

export class Ball {
  constructor() {
    this.reset();
  }
  reset() {
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.ownerKey = null; // `${team}:${idx}` — 참조 대신 키로 들고 있어야 스냅샷이 순수해진다
  }
  kick(dx, dz, force) {
    const l = vlen(dx, dz) || 1;
    this.vx = (dx / l) * force;
    this.vz = (dz / l) * force;
    this.ownerKey = null;
  }
  update(dt) {
    this.vx += this.vx * PARAMS.ballFriction * dt;
    this.vz += this.vz * PARAMS.ballFriction * dt;
    if (vlen(this.vx, this.vz) < 0.15) {
      this.vx = 0;
      this.vz = 0;
    }
    const sp = vlen(this.vx, this.vz);
    if (sp > PARAMS.ballMaxSpeed) {
      this.vx = (this.vx / sp) * PARAMS.ballMaxSpeed;
      this.vz = (this.vz / sp) * PARAMS.ballMaxSpeed;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    // 터치라인 반사 (스로인 대신 프로토타입 단순화)
    if (this.z < -HALF.W + 0.3) {
      this.z = -HALF.W + 0.3;
      this.vz *= -0.6;
    }
    if (this.z > HALF.W - 0.3) {
      this.z = HALF.W - 0.3;
      this.vz *= -0.6;
    }
  }
}
