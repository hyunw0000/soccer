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
  rewindCooldownSeconds: 15, // 되감기 쿨다운(게임 시간 15분 스케일 = clockSeconds 15단위)
  // 실점 순간에만 그 골을 겨냥한 되감기를 제안한다 — 이 시간(같은 단위)이 지나면
  // "실점 직전으로" 제안이 사라지고 기회는 끝난다(감독이 그 자리에서 안 쓰면 그냥 지나감).
  concedeRewindWindowSeconds: 10,

  // 실수는 성공/실패 주사위가 아니라 "방향 오차"로만 만든다 — errorDegrees()가 이 값들을 곱해 오차각을 낸다.
  passBaseErrorDeg: 3, // 압박 없음·전력·짧은 패스 기준 오차각
  shotBaseErrorDeg: 5, // 슛은 패스보다 기본 오차를 크게 잡는다
  pressureRadius: 4, // 이 거리 안의 상대가 오차를 키운다(m)
  pressureMax: 2.5, // 압박 배수 상한
  staminaErrorMax: 2.5, // 체력 소진 시 오차 배수 상한
  distanceErrorRef: 15, // 오차가 1배가 되는 기준 거리(m) — 이보다 멀면 오차가 커진다
  maxErrorDeg: 40, // 오차각 절대 상한(모든 배수를 곱한 뒤 이 값으로 자른다)

  // 태클/인터셉트 — 수비스탯 vs 드리블스탯 다툼. 0%/100%로 굳지 않게 상하한을 둔다.
  tackleWinMin: 0.15,
  tackleWinMax: 0.85,
  clearForce: 16, // 태클 성공 시 걷어내는 힘 — 드리블(10)과 패스(22) 사이

  // 선택 개성 — "자아"는 무작위 선택이 아니라 (1) 못 보고 지나침 (2) 가끔 1등을 안 고름, 이 둘로만 만든다.
  visionRefStat: 60, // 이 스탯 밑으로는 시야 밖 후보가 생기기 시작한다
  visionMaxMissChance: 0.5, // 후보 하나를 못 보고 지나칠 확률의 상한
  personalityDeviateMax: 0.5, // boldness가 극단(0 또는 1)일 때 1등을 안 고르는 확률의 상한
  personalityTopN: 3, // 대안을 고를 때 훑는 후보 범위(점수 상위 N개)
};
