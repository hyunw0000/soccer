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
