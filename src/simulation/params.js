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
  halfMinutes: 45, // matchMinute 기준 전/후반 길이 (1초 = 게임 1분 스케일)
  centerCircleRadius: 9.15, // 킥오프 규정 거리
  kickoffUnlockSpeed: 0.5, // 이 이상으로 볼이 움직이면 킥오프 제한 해제
};
