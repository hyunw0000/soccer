// 시뮬레이션 상수. 렌더러와 무관한 순수 수치 — 월드 단위 = 미터.
export const FIELD = { L: 105, W: 68 };
export const HALF = { L: FIELD.L / 2, W: FIELD.W / 2 };
export const GOAL_W = 12; // 골 너비 (프로토타입에서는 관대하게)
export const GOAL_H = 2.44; // 크로스바 높이 — 이보다 높이 지나간 볼은 골이 아니라 골킥이다
// 페널티 에어리어 — 골키퍼가 손을 쓸 수 있는 유일한 구역이다(실측 16.5m × 40.32m).
export const PENALTY_AREA = { depth: 16.5, halfWidth: 20.16 };

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
  // 짧은 연결이 가능해야 점유 축구가 성립한다. 8m로 잡으면 가까운 동료가 아예 후보에서
  // 빠져서, 붙어 있는 동료를 두고 혼자 몰고 가는 선택만 남는다.
  minPass: 5,
  maxPass: 32,
  ballFriction: -0.9,
  ballMaxSpeed: 40,
  ballRadius: 0.35,
  dt: 1 / 60,

  // ---------- 공중볼(높이) ----------
  // 볼은 x/z만이 아니라 y도 갖는다. 로프트 각이 0인 킥은 예전처럼 땅으로만 굴러가므로,
  // 아래 loft 값들을 전부 0으로 두면 높이 도입 전 동작으로 돌아간다.
  gravity: 9.81,
  ballAirDrag: -0.14, // 공중일 때 잔디 마찰 대신 받는 감쇠(마찰보다 훨씬 약하다)
  ballBounce: 0.42, // 지면 반발계수 — 튄 뒤 남는 수직 속도 비율
  ballBounceGrip: 0.72, // 바운드할 때 잔디에 먹히는 수평 속도 비율
  ballBounceMinSpeed: 0.6, // 이보다 느리게 떨어지면 안 튀고 그대로 눕는다(무한 미세 바운스 방지)

  // 킥 종류별 띄우는 각도(도). 여기가 "언제 공이 뜨는가"를 한곳에서 정한다.
  passLoftDeg: 0, // 짧은 패스는 땅볼
  longPassLoftDeg: 11, // longPassDistance를 넘는 패스는 살짝 띄워 보낸다
  longPassDistance: 22,
  shootLoftDeg: 5, // 슛은 살짝만 — 크로스바(2.44m) 밑으로 깔리는 게 기본이다
  shotVerticalErrorScale: 0.35, // 슛 좌우 오차각을 이 비율만큼 상하 오차로도 쓴다(뜬 슛 = 크로스바 위)
  clearLoftDeg: 26, // 걷어내기는 크게 띄운다
  // 헤딩은 낮게 때린다. 여기를 올리면 "헤딩으로 띄운 공을 다시 헤딩으로 띄우는" 되먹임이
  // 생겨서 볼이 경기 내내 공중에 머문다(34도로 뒀을 때 공중 체류가 절반을 넘었다).
  headerLoftDeg: 9,
  goalKickLoftDeg: 33, // 골킥 — 크게 띄워 하프라인 근처까지 보낸다
  gkPunchLoftDeg: 24,

  // 높이별로 볼을 다룰 수 있는 사람이 갈린다. 이 게이트가 없으면 머리 위로 날아가는 공을
  // 땅에서 그대로 낚아채서 로프트가 아무 의미도 갖지 못한다.
  footControlHeight: 0.75, // 이 높이까지는 발로 잡아서 드리블을 시작할 수 있다
  headControlHeight: 2.2, // 여기까지는 헤딩으로 걷어낼 수만 있다(컨트롤 불가). 그 위는 아무도 못 건드린다
  headerForce: 15,
  headerBaseErrorDeg: 14, // 헤딩은 발보다 방향이 훨씬 거칠다

  // ---------- 골키퍼 ----------
  // 손을 쓰기 때문에 필드 플레이어의 kickDist(1.6m)·footControlHeight(0.75m)와 다른 값을 쓴다.
  // 페널티 에어리어 밖에서는 이 규칙이 아예 적용되지 않고 발로만 다룬다.
  gkReachRadius: 2.2, // 다이빙 포함 좌우 도달 거리(m)
  gkReachHeight: 2.6, // 손이 닿는 높이 — 크로스바보다 아주 살짝 위
  // 캐치 확률은 감점을 **곱한다**. 뺄셈으로 두면 감점 하나(특히 속도)가 기본 확률을 통째로
  // 상쇄해서 실전 슛이 전부 하한값에 눌러붙는다 — 실제로 그래서 키퍼가 60%를 놓쳤다.
  // 곱셈이면 어느 항도 혼자서 확률을 0으로 못 만들고, 나쁜 조건이 겹쳐야 비로소 뚫린다.
  gkCatchBaseProb: 0.92, // 모든 조건이 완벽할 때(느린 볼·정면·발밑)의 캐치 확률
  gkHandlingRefStat: 70, // 이 스탯이 "평균 골키퍼"(보정 1.0)
  gkCatchSpeedRef: 45, // 이 속도(m/s)에서 속도 감점이 최대가 된다
  gkCatchSpeedPenalty: 0.55, // 최대 속도 감점 비율
  gkCatchHeightPenalty: 0.25, // 높이 감점(닿는 한계 높이에서 최대)
  gkCatchReachPenalty: 0.45, // 거리 감점(사거리 끝에서 최대)
  gkCatchMin: 0.04,
  gkCatchMax: 0.95,
  // 못 잡았을 때 그래도 손끝에 걸려 쳐낼 확률 — 남은 확률(1-캐치) 중 이 비율.
  // 나머지는 완전히 지나쳐서 볼이 그대로 흐른다(=실점 가능). 이 값이 1이면 골이 안 들어간다.
  gkParryShare: 0.45,
  gkPunchForce: 17,
  gkPunchBaseErrorDeg: 16, // 쳐내기는 방향을 고를 여유가 없다
  gkHoldTicks: 40, // 잡은 뒤 다음 판단(패스/골킥)까지 들고 있는 시간
  gkSaveEventSpeed: 18, // 이 속도 이상으로 날아온 볼을 막았을 때만 "선방"으로 기록한다
  // 공중볼 낙하 예측으로 키퍼가 골문에서 나오는 최대 거리(m). 크게 잡으면 크로스에 다 나와서
  // 골문이 빈다.
  gkComeOutRange: 11,

  // 골킥은 캐리어 드리블로 시작하지 않고 그 자리에서 길게 걷어찬다.
  goalKickForce: 25,
  goalKickBaseErrorDeg: 8,
  halfMinutes: 45, // matchMinute 기준 전/후반 길이 (1초 = 게임 1분 스케일)
  centerCircleRadius: 9.15, // 킥오프 규정 거리
  kickoffUnlockSpeed: 0.5, // 이 이상으로 볼이 움직이면 킥오프 제한 해제
  rewindCooldownSeconds: 15, // 되감기 쿨다운(게임 시간 15분 스케일 = clockSeconds 15단위)
  // 실점 이벤트로부터 얼마나 앞으로 되감을지(같은 단위 = 게임 분). 짧게 잡으면 되감아도
  // 이미 무너진 장면 한복판에서 다시 시작해서, 전술을 바꿔도 같은 실점이 그대로 재현된다.
  // 공격이 시작되기 전까지 충분히 거슬러 올라가야 감독의 선택이 미래를 바꾼다.
  // 기획 기준은 "실점 시각으로부터 15분 전"이다(되감기 쿨다운 15분과 같은 값).
  // 단, getRewindTargetTick()이 그 하프의 시작보다 앞으로는 안 가게 자르므로,
  // 후반 초반(45~60분) 실점은 15분을 다 못 채우고 후반 시작으로 착지한다.
  rewindLookbackSeconds: 15,
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

  // 아웃오브바운즈(스로인/코너킥/골킥) 재개 지점 — 라인 위에 정확히 두면 좌표 클램프 경계와
  // 겹쳐서 다음 스텝에 다시 아웃으로 잡히는 경우가 생겨 살짝 안쪽으로 들여놓는다.
  restartInset: 0.5,
  goalKickDepth: 9, // 골킥 스팟이 자기 골라인에서 이만큼 앞(대략 골에어리어 거리감)

  // ---------- 팀 전술이 경기에 개입하는 폭 ----------
  // 여기 값이 0이면 감독의 전술은 표시만 남고 경기는 똑같이 흐른다. 값을 키울수록 전술이
  // 결과를 더 크게 가른다. 네 값 모두 "전술 0.5 = 예전 동작"이 되도록 식을 맞춰 두었으니,
  // 밸런스를 만질 때는 이 상수만 움직이면 된다(scripts/validate-tactics-impact.mjs가 감시한다).
  lineHeightBasePush: 20, // 라인 높이가 대형 전체를 앞뒤로 미는 거리(m) — 0↔1이면 ±10m
  playerLineInset: 0.6, // 선수가 터치라인·골라인에서 최소한 떨어져 서는 거리(m)
  // "열린 동료에게 준다"의 무게. 이 값이 0이면 판단이 다시 드리블 일변도로 돌아간다.
  openPassWeight: 0.55,
  openPassRadius: 10, // 이 거리만큼 상대와 떨어져 있으면 완전히 열린 것으로 본다(m)
  // 대형 목표 위치를 골라인에서 띄우는 거리(m). 라인을 끝까지 올린 팀의 공격수가 골라인에
  // 눌러붙는 것만 막는 최소값이다 — 크게 잡으면 공격이 박스에 못 들어가 득점이 줄어든다
  // (중립 전술 20경기 총득점: 0.5m→39, 2m→35, 4m→32, 8m→31).
  formationTargetGoalMargin: 2,
  pressSupportRadius: 18, // 압박이 최대일 때 두 번째 선수가 볼로 달려드는 거리(m)
  tempoDecisionScale: 0.7, // 템포가 캐리어 판단 주기를 줄이는 비율 (0.5에서 배수 1)
  tempoPassForceScale: 0.3, // 템포가 패스 힘을 키우는 비율 (0.5에서 배수 1)
  // 드리블 점수의 템포 보정(patience) 배수 상한.
  // 패스 점수 총량이 템포를 따라 내려가는 걸 드리블도 같이 따라가게 하는 보정인데, 저템포로
  // 갈수록 배수가 계속 커져서(patience(0)=1.45) 어느 지점부터 argmax 균형이 무너진다.
  // 10시드 스윕(템포0 드리블 판단 비중): 배수 1.10→27.1% · 1.15→40.9% · 1.20→50.1% · 1.45→65.6%.
  // 그 임계점 아래에서 자른다. 고템포 쪽(배수<1)은 이 상한에 안 걸려 기존 밸런스가 그대로다.
  dribbleTempoCompMax: 1.15,
};
