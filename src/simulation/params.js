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

  // 드리블(볼 소유 유지) — 잡으면 그 자리에서 바로 안 놓고, 발밑에 붙인 채로 전진하다가
  // 판단 주기마다 계속 갈지/패스·슛으로 풀지 정한다. "차고 뛰어가서 다시 잡기"를 없앤다.
  dribbleDecisionTicks: 24, // 판단 주기(틱) — 이 동안은 계속 드리블하며 재판단 안 함
  dribbleCarryOffset: 0.9, // 캐리어 발밑 앞쪽으로 볼을 붙여두는 거리(m)
  dribbleLookahead: 6, // 드리블 목표를 몇 m 앞으로 계속 갱신할지
  dribbleBaseChance: 0.4, // 패스 후보가 있어도 그냥 계속 드리블할 기본 확률
  dribbleRiskInfluence: 0.4, // risk 지시가 드리블 확률을 얼마나 더 흔드는지(±)
  mandatoryShotDistance: 12, // 골문에서 이 거리 안이면 확률 없이 무조건 슛 — 드리블로 골라인까지 걸어들어가는 걸 막는다

  // 판단/실행 분리 리팩터링(decision.js) — 실행 성공확률 sigmoid 계수. §6.7 공식의
  // "패스스탯×체력승수" 같은 0..100 스케일 항이 sigmoid에 그대로 들어가면 거의 항상
  // 포화(승률 0 또는 1에 붙음)돼서, Scale/Divisor로 정규화한다. 값은 실전 로스터로 돌려본
  // 빈도 비교(슛/드리블/패스 비율)로 조정했다 — 아래 "판단 빈도 비교" 결과 참고.
  passStatScale: 45,
  passStatDivisor: 18,
  passDistanceCoef: 0.05,
  passPressureCoef: 0.8, // §6.7 고정값
  passFirstTouchCoef: 0.3, // §6.7 고정값 (수신자 퍼스트터치 — 계약에 없어 dribbleSkill 대리)
  passFailErrorMultiplier: 3, // 실행 실패 시 오차각을 이만큼 키운다(성공/실패를 이진 소멸이 아니라 큰 오차로 표현)
  shootStatScale: 42,
  shootStatDivisor: 16,
  shootDistanceCoef: 0.08,
  shootAngleCoef: 1.6,
  shotFailErrorMultiplier: 2.2,

  // 태클 확률의 압박강도 항 — defender의 압박 지시(0..1)를 다른 항(수비력/드리블력, 0..100)과
  // 같은 "스탯형 0..100" 스케일로 맞추려면 ×100이 필요하다. §6.7의 "(1+압박강도/200)"은
  // 압박강도가 0..100 스케일이라는 전제라서, ×100 정규화 후 그대로 나눈다.
  tacklePressingScale: 100,
  tacklePressingDivisor: 200,
  tackleDistanceDecayMin: 0.5, // 사거리(kickDist) 끝에서도 이 밑으로는 안 깎는다

  clearBaseErrorDeg: 6, // 캐리어가 압박에 밀려 그냥 걷어낼 때의 기본 오차각(패스보다 급하게 찬다)
};
