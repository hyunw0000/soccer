// 시뮬레이션 상수. 렌더러와 무관한 순수 수치 — 월드 단위 = 미터.
export const FIELD = { L: 105, W: 68 };
export const HALF = { L: FIELD.L / 2, W: FIELD.W / 2 };
export const GOAL_W = 12; // 골 너비 (프로토타입에서는 관대하게)

export const PARAMS = {
  maxSpeed: 7.2, // m/s (스프린트)
  maxForce: 40,
  comfortZone: 4,
  sepWeight: 2.2,
  sepRadius: 3.2,
  kickDist: 1.6,
  kickCooldownTicks: 8,
  passForce: 22,
  shootForce: 34,
  dribbleForce: 10,
  minPass: 8,
  maxPass: 32,
  ballFriction: -0.9,
  ballMaxSpeed: 40,
  ballRadius: 0.35,
  dt: 1 / 60,
};

// 전술 슬라이더 → 시뮬레이션 계수. 화면에서 조절하는 값의 단일 출처.
export const TACTIC_DEFAULT = {
  lineHeight: 0.5, // 0=수비라인 내림, 1=올림
  pressing: 0.5, // 0=물러서서 지역방어, 1=전방압박
  tempo: 0.5, // 0=점유, 1=직선적
  width: 0.5, // 0=좁게, 1=넓게
};
