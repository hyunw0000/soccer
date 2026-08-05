import { PARAMS, HALF } from './params.js';
import { vlen } from './math.js';
import { INSTRUCTION_FALLBACK } from './coordinates.js';

/**
 * 선수 1명의 물리/상태. Three.js 객체를 절대 들고 있지 않는다.
 * 렌더링 쪽은 이 상태를 읽기만 하므로, 스냅샷 저장/복원(되감기)이 가능하다.
 */
export class Player {
  constructor({ team, idx, meta, slot, isCaptain = false }) {
    this.team = team; // 'home' | 'away'
    this.idx = idx;
    this.num = meta.num;
    this.name = meta.name;
    this.role = slot.role;
    // 라인업이 준 원래 자리. 급조 골키퍼를 원래대로 돌려놓을 때만 쓴다(경기 중 안 바뀐다).
    this.baseRole = slot.role;
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
    // 주장 여부 — §6.5 패스 점수식의 "주장에게 볼이 몰리는 편향" 가산에 쓴다.
    this.isCaptain = isCaptain;
    // 캐리어(드리블 소유자)일 때만 의미 있음: 'advance'(전진 드리블) | 'hold'(제자리 볼 지키기).
    // decision.js의 판단 결과에 따라 sim.js의 executeDribble/executeHold가 바꾼다.
    this.dribbleMode = 'advance';
    this.maxSpeedBase = PARAMS.maxSpeed * (0.82 + meta.pace / 100 * 0.36);
    this.maxSpeed = this.maxSpeedBase;
    this.energy = 1; // 1 → 0 으로 소모, 속도에 곱해진다
    this.distanceRun = 0; // 누적 주행거리(m) — 체력 소모와 별개로 감독이 확인할 측정값
    this.home = { x: slot.x, z: slot.z };
    // 감독이 드래그로 옮겨 놓은 "새 기준 위치"의 변위(m). home에 더해져서 쓰인다.
    //
    // home을 직접 덮어쓰지 않는 이유가 있다 — refreshHomeSlots()가 라인업과 전술 폭에서
    // home을 다시 계산하는데, 그게 전술 변경 때와 되감기 복원 때 매번 불린다. home을
    // 덮어쓰면 감독이 폭 슬라이더를 건드리거나 되감기를 하는 순간 옮겨 놓은 자리가 조용히
    // 사라진다. 변위로 따로 두면 기준이 다시 계산돼도 지시는 그 위에 그대로 얹힌다.
    this.homeOffset = { x: 0, z: 0 };
    this.x = slot.x;
    this.z = slot.z;
    this.vx = 0;
    this.vz = 0;
    this.kc = 0; // kick cooldown
    this.attackDirection = team === 'home' ? 1 : -1;
    this.heading = team === 'home' ? 0 : Math.PI;
    // 되감기 후 드래그로 내리는 경로 지시. { waypoints: [{x,z},...], index } | null.
    // 있으면 기본 AI(추격/포메이션 유지) 대신 이 경로를 arrive()로 따라간다.
    this.command = null;
    this.yellowCards = 0;
    // 퇴장 여부 — true가 되면 그 순간부터 경기장 밖으로 빠져 다시는 판단/이동에 끼지 않는다.
    this.sentOff = false;
    // 부상 여부 — sentOff와 마찬가지로 경기장 밖으로 빠지지만, 교체로 자리를 채울 수 있다는
    // 점이 다르다(퇴장은 그 자리를 영원히 못 채운다).
    this.injured = false;
    // 정식 골키퍼가 부상·퇴장으로 빠져서 대신 골문에 들어간 필드 플레이어인지.
    // role은 refreshHomeSlots()가 라인업에서 매번 다시 써 넣으므로(전술을 바꿀 때마다,
    // 되감기로 복원할 때마다) 역할만 바꿔 두면 곧 풀린다. 이 플래그가 그 사이에도 남는다.
    this.actingKeeper = false;
  }

  /** 공격 방향 골라인의 x좌표 */
  get atkX() {
    return this.attackDirection * HALF.L;
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
    // 공 중심 높이. 지면에 놓인 상태가 곧 반지름이라, y === ballRadius가 "땅에 있다"는 뜻이다.
    this.y = PARAMS.ballRadius;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.ownerKey = null; // `${team}:${idx}` — 참조 대신 키로 들고 있어야 스냅샷이 순수해진다
    // 지금 드리블 중인 선수(ownerKey와 달리 여러 틱 동안 유지된다). kick()하면 놓는다.
    this.carrierKey = null;
    // 마지막으로 볼을 건드린 선수 — ownerKey/carrierKey와 달리 킥해도 안 지워진다(스로인/
    // 코너킥/골킥을 어느 팀에 줄지, 골 득점자가 누군지는 "날아가는 동안" 판정해야 하는데,
    // ownerKey는 킥하는 순간 바로 null이 돼서 그때는 이미 늦다).
    this.lastTouchKey = null;
    // 슛으로 날아가는 중인지 표시 — GK가 이 상태의 볼을 잡으면 "선방"이다. 다른 킥(패스/
    // 클리어)이나 아무나 다시 잡으면 사건이 끝난 것이므로 지운다.
    this.shotBy = null;
  }
  /** 지면에서 떠 있는지 — 발로 잡을지/헤딩할지, 크로스바 밑으로 들어갔는지를 이걸로 가른다. */
  get airborne() {
    return this.y > PARAMS.ballRadius + 1e-6;
  }

  /**
   * @param {number} loftDeg 위로 띄우는 각도(도). 0이면 예전 그대로 땅으로만 굴러간다 —
   *   force는 "총 속력"이라, 띄울수록 수평으로 나아가는 몫이 줄어든다(실제 킥과 같다).
   */
  kick(dx, dz, force, byKey, loftDeg = 0) {
    const l = vlen(dx, dz) || 1;
    const rad = (loftDeg * Math.PI) / 180;
    const horizontal = force * Math.cos(rad);
    this.vx = (dx / l) * horizontal;
    this.vz = (dz / l) * horizontal;
    this.vy = force * Math.sin(rad);
    this.ownerKey = null;
    this.carrierKey = null; // 패스/슛/클리어 — 어느 쪽이든 킥하면 드리블이 끝난다
    this.shotBy = null; // 새 킥이 이전 슛을 대체한다 — 슛인 경우 호출부가 다시 세팅한다
    // 이 킥이 이미 유효슈팅으로 집계됐는지. 골이 들어갔을 때 같은 슛을 두 번 세지 않으려고 둔다.
    this.onTargetCounted = false;
    if (byKey) this.lastTouchKey = byKey;
  }

  /**
   * 지금 궤적대로면 볼이 어디에 떨어지는지. 공기저항을 무시한 닫힌 해라서 실제 낙하점보다
   * 아주 조금 멀지만, 매 틱 다시 계산하므로 다가갈수록 오차가 사라진다 — 선수·골키퍼가
   * "떠 있는 공을 어디서 기다릴지" 정하는 데 쓴다.
   * @returns {{x:number,z:number,t:number}}
   */
  predictLanding() {
    if (!this.airborne && this.vy <= 0) return { x: this.x, z: this.z, t: 0 };
    const dy = this.y - PARAMS.ballRadius;
    const disc = this.vy * this.vy + 2 * PARAMS.gravity * dy;
    if (disc <= 0) return { x: this.x, z: this.z, t: 0 };
    const t = (this.vy + Math.sqrt(disc)) / PARAMS.gravity;
    return { x: this.x + this.vx * t, z: this.z + this.vz * t, t };
  }

  update(dt) {
    // 떠 있는 동안은 잔디 마찰이 아니라 공기저항 + 중력을 받는다. 갓 차올린 순간(y는 아직
    // 지면이지만 vy>0)도 공중으로 취급해야 첫 틱에 마찰로 속도를 깎이지 않는다.
    if (this.airborne || this.vy > 0) {
      const drag = PARAMS.ballAirDrag * dt;
      this.vx += this.vx * drag;
      this.vz += this.vz * drag;
      this.vy += this.vy * drag;
      this.vy -= PARAMS.gravity * dt;
    } else {
      this.vx += this.vx * PARAMS.ballFriction * dt;
      this.vz += this.vz * PARAMS.ballFriction * dt;
      if (vlen(this.vx, this.vz) < 0.15) {
        this.vx = 0;
        this.vz = 0;
      }
    }
    const sp = vlen(this.vx, this.vz);
    if (sp > PARAMS.ballMaxSpeed) {
      this.vx = (this.vx / sp) * PARAMS.ballMaxSpeed;
      this.vz = (this.vz / sp) * PARAMS.ballMaxSpeed;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y += this.vy * dt;
    if (this.y <= PARAMS.ballRadius) {
      this.y = PARAMS.ballRadius;
      if (this.vy < -PARAMS.ballBounceMinSpeed) {
        // 튕긴다 — 수직은 반발계수만큼 되돌리고, 수평은 잔디에 먹힌 만큼 깎는다.
        this.vy = -this.vy * PARAMS.ballBounce;
        this.vx *= PARAMS.ballBounceGrip;
        this.vz *= PARAMS.ballBounceGrip;
      } else {
        this.vy = 0; // 거의 다 죽은 바운스는 그냥 눕힌다(무한 미세 진동 방지)
      }
    }
    // 터치라인/골라인 경계 판정과 스로인/코너킥/골킥 재개는 sim.js의 checkOutOfBounds()가
    // 담당한다 — 여기서 튕겨 돌려보내지 않는다(실제로 밖으로 나가야 "아웃"을 판정할 수 있다).
  }
}
