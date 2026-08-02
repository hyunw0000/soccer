// 온볼(볼 소유) 판단 — 기획서 §6.3/§6.5의 "판단(Decision)" 계층.
// 후보 행동(패스 대상별/드리블/슛/키핑/클리어)마다 완전히 독립된 점수함수로 채점하고,
// 최고점 후보 하나만 고른다. 여기서는 확률을 굴리지 않는다 — 성공/실패 판정은
// 선택된 행동 하나에 대해서만 sim.js의 execute*()가 한다(§6.3 "판단"과 "실행"의 분리).
//
// 새 행동을 추가할 때는 새 score*() 함수를 만들어 buildCandidates()에 push만 하면 된다.
// 기존 score*() 함수는 절대 건드리지 않는다 — 이게 "if-else 폭포수라 새 행동을 추가하면
// 기존 행동이 실행되지 않는" 문제의 재발을 막는 핵심 규칙이다.

import { PARAMS, HALF, GOAL_W } from './params.js';
import { vlen, clamp } from './math.js';
import { seededRandomPlayerId } from './rng.js';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * p가 속한 팀의 팀 전술(0..1 네 값).
 * 감독이 만지는 건 홈뿐이지만 읽는 경로는 양 팀이 같다 — 그래야 "우리 전술 vs 상대 전술"이
 * 실제 대결이 되고, 한쪽만 전술을 쓰는 비대칭이 사라진다.
 */
export function teamTacticsOf(sim, p) {
  return (p.team === 'home' ? sim.tactics : sim.oppTactics) ?? { lineHeight: 0.5, pressing: 0.5, tempo: 0.5, width: 0.5 };
}

/**
 * 팀 전술(뼈대) + 개인 지시(±0.45)를 합친 실효 지시.
 * 팀 값이 중심이고 개인 지시는 그 위에서 크게 밀거나 당긴다 — 감독이 이 선수만 극단으로
 * 지시하면(1 또는 5) 팀 전술을 사실상 뒤집을 만큼 체감이 커야 한다.
 */
export const blendInstruction = (teamValue, insValue) => clamp(teamValue + (insValue - 0.5) * 0.9, 0, 1);

/**
 * 템포(0..1)가 판단 가중치를 흔드는 배수.
 * `neutral`(0.5)에서 정확히 1이 되도록 잡아서, 전술을 안 만진 감독의 경기는 예전 그대로 흐른다.
 * 템포가 높으면 전진·모험이 커지고, 낮으면 안전·점유가 커진다.
 */
const directness = (tempo) => 0.55 + tempo * 0.9; // 0.55 … 1.45
const patience = (tempo) => 1.45 - tempo * 0.9; // 1.45 … 0.55

/** 체력 0..1 → 실행력 배수. §6.7 "체력승수" 그대로. */
export const staminaMult = (energy) => 0.55 + 0.45 * clamp(energy, 0, 1);

/** p를 압박 중인(반경 안의) 상대 수. 성공확률 sigmoid의 "압박받는수" 항. */
export function pressureCount(sim, p) {
  const opps = p.team === 'home' ? sim.awayP : sim.homeP;
  let n = 0;
  for (const o of opps) if (vlen(o.x - p.x, o.z - p.z) <= PARAMS.pressureRadius) n++;
  return n;
}

/** p 팀의 압박강도 지시 — 팀 전술(0..1) + 개인 지시(±0.3)를 합친, step()의 `press`와 같은 식. */
export function effectivePressing(sim, p) {
  return blendInstruction(teamTacticsOf(sim, p).pressing, p.ins.pressing);
}

/**
 * 패스 성공확률 — §6.7: sigmoid(패스스탯×체력승수 − 거리계수×거리 − 0.8×압박수 + 수신자.퍼스트터치×0.3)
 * "퍼스트터치" 스탯은 아직 MatchSetup 계약에 없어 dribbleSkill을 대리 지표로 쓴다
 * (entities.js가 이미 passSkill 등 없는 스탯을 pace로 대신하는 것과 같은 패턴).
 * 계수(passStatScale 등)는 params.js에서 조정한다 — sigmoid 입력이 포화되지 않게
 * 0..100 스탯을 이 상수들로 정규화한다.
 */
export function passSuccessProb(sim, p, target, distance) {
  const x =
    (p.passSkill * staminaMult(p.energy) - PARAMS.passStatScale) / PARAMS.passStatDivisor -
    PARAMS.passDistanceCoef * distance -
    PARAMS.passPressureCoef * pressureCount(sim, p) +
    PARAMS.passFirstTouchCoef * (target.dribbleSkill / 100);
  return sigmoid(x);
}

/**
 * 슛 성공확률 — 같은 sigmoid 골격에 거리·각도를 얹는다(기획서는 "기대득점(각도,거리)"을
 * 판단 점수 쪽에, 실행 성공확률은 §6.7 공통 sigmoid 골격을 그대로 따르라고만 명시했다).
 */
export function shootSuccessProb(sim, p, distance, angleFactor) {
  const x =
    (p.shootSkill * staminaMult(p.energy) - PARAMS.shootStatScale) / PARAMS.shootStatDivisor -
    PARAMS.shootDistanceCoef * distance -
    PARAMS.shootAngleCoef * (1 - angleFactor) -
    PARAMS.passPressureCoef * pressureCount(sim, p);
  return sigmoid(x);
}

/**
 * 오프사이드 판정 — 패스가 나가는 순간 기준(§Law 11 단순화판).
 * target(패스를 받을 동료)이 "상대 진영"에서, 볼과 상대 두 번째 최종수비수(보통 GK 다음
 * 필드플레이어)보다 더 앞서 있으면 오프사이드다. 셋 중 가장 뒤쪽 기준선을 넘었는지만 본다 —
 * 기준선 = max(상대 두 번째 수비수 전진도, 볼 전진도, 하프라인(0)).
 */
export function isOffside(sim, p, target) {
  if (!target || target === p) return false;
  const dir = p.attackDirection;
  const opps = p.team === 'home' ? sim.awayP : sim.homeP;
  if (opps.length < 2) return false;
  // "전진도" = 공격 방향 기준으로 얼마나 상대 골 쪽에 가까운지(클수록 상대 골에 가깝다).
  const advOf = (x) => x * dir;
  const defenderLine = opps
    .map((o) => advOf(o.x))
    .sort((a, b) => b - a)[1]; // 가장 전진한 수비수 다음, 두 번째로 전진한 수비수
  const threshold = Math.max(defenderLine, advOf(sim.ball.x), 0);
  return advOf(target.x) > threshold;
}

/** 그 선수에게 가장 가까운 상대와의 거리(m). 패스 대상이 "열려 있는지"를 재는 데 쓴다. */
export function nearestOpponentDistance(sim, p) {
  const opps = p.team === 'home' ? sim.awayP : sim.homeP;
  let nearest = Infinity;
  for (const o of opps) {
    const d = vlen(o.x - p.x, o.z - p.z);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

/** 골문을 향한 각도 여유(0..1, 1=정면). 측면에서 쏠수록 낮아진다. */
function shotAngleFactor(p) {
  return clamp(1 - Math.abs(p.z) / HALF.W, 0.15, 1);
}

/** 패스 후보 — 동료마다 독립적으로 채점한다(§6.5 U(패스→j)). */
export function scorePassCandidates(sim, p) {
  const mates = p.team === 'home' ? sim.homeP : sim.awayP;
  const t = teamTacticsOf(sim, p);
  const gdSelf = vlen(p.atkX - p.x, 0 - p.z);
  // 팀 템포가 "앞으로 vs 안전하게"의 저울을 기울이고, 개인 지시가 그 위에서 선수차를 만든다.
  const wForward = p.ins.forwardness * directness(t.tempo);
  const wSafety = (1 - p.ins.risk) * patience(t.tempo);
  // 진영 폭은 팀 전술이 뼈대다 — 좁은 팀은 중앙으로 모으고 넓은 팀은 측면으로 벌린다.
  const wWidth = blendInstruction(t.width, p.ins.width);
  // 패스 길이도 템포를 따른다. 짧은 패스 팀은 가까운 동료를, 롱볼 팀은 먼 동료를 고른다.
  const preferredPassLength = 8 + blendInstruction(t.tempo, p.ins.passLength) * 32;
  // NOTE: 아래 openness(열린 동료에게 준다) 항에는 템포 배수를 곱하지 않는다 — 시도해 봤다가
  // 되돌린 자리다. 여기에 patience를 곱하면 템포1에서 openness가 0.55배로 쪼그라들어
  // 드리블 편중이 오히려 반대쪽으로 터진다(실측: 템포1 드리블 비중 78.6%).
  // 템포 편중의 진짜 원인은 scoreDribbleCandidate 쪽이었다(거기 주석 참고).
  // wWidth를 "desiredZ=중앙 기준 거리"로 바꾸면 중립(0.5)일 때 desiredZ=0이 돼서, 측면
  // 동료는 항상 감점을 받고 중앙 동료는 항상 가산을 받았다(실전 확인: 90분 동안 와이드
  // 포지션 픽업 3회, 수비수 0회 — 폭을 사실상 못 씀). widthBias를 "중립=0(무관), 넓게=+,
  // 좁게=-"로 바꿔서 팀 전술 폭(wWidth)이 중립이면 측면 여부가 점수에 개입하지 않게 한다 —
  // 팀이 실제로 좁게/넓게를 지시했을 때만 그 방향으로 가산·감산이 붙는다.
  const widthBias = (wWidth - 0.5) * 2; // -1(항상 좁게)..0(무관)..+1(항상 넓게)
  const out = [];
  for (const m of mates) {
    if (m === p || m.role === 'GK') continue;
    const d = vlen(m.x - p.x, m.z - p.z);
    if (d < PARAMS.minPass || d > PARAMS.maxPass) continue;
    // 인지(perception) 필터 — 기존 동작 그대로 유지: 시야가 나쁠수록 좋은 동료를 "못 보고"
    // 후보 목록에서 아예 빠뜨릴 확률이 커진다. 이건 실행 성공/실패 판정이 아니라 인지 단계라
    // sim.rng(스트림형 결정론 난수)를 그대로 쓴다 — seededRandom(tick,playerId,actionId)은
    // 이번 리팩터링에서 "실행 성공확률 판정" 용도로 명시된 것이라 여기엔 쓰지 않는다.
    const missChance = clamp((PARAMS.visionRefStat - p.visionSkill) / 100, 0, PARAMS.visionMaxMissChance);
    if (sim.rng.next() < missChance) continue;

    const gdTarget = vlen(m.atkX - m.x, 0 - m.z);
    const forwardGain = clamp((gdSelf - gdTarget) / 30, -1, 1);
    const successProb = passSuccessProb(sim, p, m, d);
    // "얼마나 측면에 있는지"와 팀의 폭 지시 방향을 곱한다 — widthBias가 이미 중립(0)/
    // 넓게(+)/좁게(-) 방향과 세기를 갖고 있으므로 여기서 다시 wWidth를 곱하지 않는다
    // (곱하면 중립일 때도 wideness가 커서 이상하게 감산/가산되는 이중 반영이 생긴다).
    const wideness = clamp(Math.abs(m.z) / HALF.W, 0, 1); // 0=중앙, 1=터치라인
    const widthFit = widthBias * wideness;
    const lengthPenalty = Math.abs(d - preferredPassLength) / PARAMS.maxPass;
    const captainBonus = m.isCaptain ? 0.15 : 0;
    // 동료가 얼마나 열려 있는지 — 붙어 있는 동료에게 주는 건 그냥 볼을 넘겨주는 짓이다.
    // 이 항이 없으면 "혼자 몰고 가기"가 거의 항상 이긴다(실측: 드리블이 판단의 70%였다).
    const openness = clamp(nearestOpponentDistance(sim, m) / PARAMS.openPassRadius, 0, 1);

    const score =
      wForward * forwardGain +
      wSafety * successProb +
      widthFit +
      PARAMS.openPassWeight * openness -
      lengthPenalty +
      captainBonus;
    out.push({
      type: 'pass',
      target: m,
      score,
      tiebreak: seededRandomPlayerId(m.team, m.idx),
      meta: { distance: d, successProb, forwardGain },
    });
  }
  return out;
}

/** 슛 후보 — §6.5 U(슈팅). mandatoryShotDistance 안이면 다른 후보를 절대 못 이기게 큰 가산을 준다. */
export function scoreShootCandidate(sim, p) {
  const gdx = p.atkX - p.x;
  const gdz = 0 - p.z;
  const gd = vlen(gdx, gdz);
  if (gd > 34) return null; // 사거리 밖 — 애초에 후보가 아니다(굳이 낮은 점수로 넣어 경쟁시킬 이유가 없다)

  const t = teamTacticsOf(sim, p);
  const wForward = p.ins.forwardness * directness(t.tempo);
  const wSafety = (1 - p.ins.risk) * patience(t.tempo);
  const angleFactor = shotAngleFactor(p);
  const distFactor = clamp(1 - gd / 34, 0, 1);
  const expectedGoalValue = distFactor * 0.7 + angleFactor * 0.3;
  const successProb = shootSuccessProb(sim, p, gd, angleFactor);

  let score = wForward * expectedGoalValue * PARAMS.shootValueWeight - wSafety * (1 - successProb);
  // 골문 코앞에서 계속 드리블만 하다 골라인으로 걸어들어가는 옛 버그(mandatoryShotDistance)를
  // "굴림으로 강제"가 아니라 "다른 후보가 절대 못 이기는 점수"로 표현한다 — 판단 결과가
  // 여전히 하나의 점수 비교에서 나오므로 chooseAction()의 일반 규칙을 벗어나지 않는다.
  if (gd < PARAMS.mandatoryShotDistance) score += 999;
  return { type: 'shoot', score, tiebreak: -1, meta: { distance: gd, successProb, angleFactor } };
}

/** 드리블(전진 유지) 후보 — §6.5 U(드리블). */
export function scoreDribbleCandidate(sim, p) {
  const opps = p.team === 'home' ? sim.awayP : sim.homeP;
  const dir = p.attackDirection;
  let nearestAhead = Infinity;
  let nearestDefense = 60;
  let densityCount = 0;
  for (const o of opps) {
    const dx = o.x - p.x;
    const dz = o.z - p.z;
    const d = vlen(dx, dz);
    if (d <= PARAMS.pressureRadius) densityCount++;
    if (dx * dir > 0) {
      // 전진 방향(앞쪽)에 있는 상대만 "돌파 상대"로 본다
      if (d < nearestAhead) {
        nearestAhead = d;
        nearestDefense = o.defenseSkill;
      }
    }
  }
  const forwardGain = clamp((Number.isFinite(nearestAhead) ? nearestAhead : PARAMS.dribbleLookahead * 2) / 15, 0, 1);
  const breakExpect = clamp((p.dribbleSkill - nearestDefense) / 100 + 0.5, 0, 1);
  const pressureDensity = densityCount * 0.18;

  // 드리블 편중 버그의 근본 원인이 여기 있었다 — patience의 "방향"이 아니라 "진폭"이 문제였다.
  //
  // 패스 점수의 템포 항은 가중치 합이 directness+patience=2.00으로 불변이지만, 실제 총량은
  // 템포가 오를수록 크게 줄어든다. 두 항이 곱해지는 값의 크기가 전혀 다르기 때문이다
  // (실측: forwardGain 평균 -0.222·73%가 음수 / successProb 평균 +0.587). 즉 템포를 올리면
  // "자주 음수인 작은 항"의 가중치를 키우고 "항상 양수인 큰 항"의 가중치를 깎아서, 패스
  // 매력도 총량이 통째로 내려간다. 드리블에 patience를 곱한 원래 설계는 그 하락을 같이
  // 따라가게 만드는 보정이었고, 실제로 템포 0.25~1 구간은 그 덕에 32~48%에 머물렀다.
  //
  // 문제는 보정의 **상한**이었다. 저템포로 갈수록 보정 배수가 계속 커지는데(patience(0)=1.45),
  // 판단이 argmax라 어느 지점을 넘으면 드리블이 모든 패스를 이겨버린다. 10시드 스윕에서
  // 템포0 드리블 비중이 배수 1.10→27.1%, 1.15→40.9%, 1.20→50.1%, 1.45→65.6%로 무너졌다.
  // 반대쪽(고템포)은 보정이 그대로 필요하다 — 진폭을 통째로 줄이면 오히려 템포 0.75~1에서
  // 드리블이 60%대로 튄다(스윕으로 확인).
  //
  // 그래서 곡선은 원래대로 두고 임계점을 넘는 저템포 구간만 잘라낸다. 고템포 쪽(0.5~1)은
  // 전혀 안 건드리므로 그 구간의 기존 밸런스가 그대로 보존되고, 중립(0.5)은 배수가 정확히
  // 1이라 예전 동작과 완전히 동일하다.
  const tempoComp = Math.min(patience(teamTacticsOf(sim, p).tempo), PARAMS.dribbleTempoCompMax);
  const wForward = p.ins.forwardness * tempoComp;
  const risk = p.ins.risk * tempoComp;
  const score = wForward * forwardGain + risk * breakExpect - pressureDensity;
  return { type: 'dribble', score, tiebreak: -2, meta: { densityCount } };
}

/** 키핑(제자리 볼 지키기) 후보 — 압박이 세고 신중할수록 매력적인, 항상 존재하는 안전판. */
export function scoreHoldCandidate(sim, p) {
  const density = pressureCount(sim, p);
  // 점유 지향(낮은 템포) 팀일수록 "일단 지킨다"가 매력적이다.
  const wSafety = (1 - p.ins.risk) * patience(teamTacticsOf(sim, p).tempo);
  const score = wSafety * 0.5 + density * 0.15 - 0.1;
  return { type: 'hold', score, tiebreak: -3, meta: { density } };
}

/** 클리어(무조건 걷어내기) 후보 — 자기 진영 3분의 1 안에서 압박받을 때만 등장한다. */
export function scoreClearCandidate(sim, p) {
  const ownThird = p.x * p.attackDirection < -HALF.L / 3;
  if (!ownThird) return null;
  const density = pressureCount(sim, p);
  if (density < 1) return null; // 압박이 아예 없으면 클리어를 고려할 이유가 없다
  const score = 0.3 + density * 0.25;
  return { type: 'clear', score, tiebreak: -4, meta: { density } };
}

/** 후보를 전부 모은다. 새 행동을 추가할 때는 여기 한 줄만 늘어난다. */
export function buildCandidates(sim, p) {
  const candidates = [...scorePassCandidates(sim, p)];
  const shoot = scoreShootCandidate(sim, p);
  if (shoot) candidates.push(shoot);
  candidates.push(scoreDribbleCandidate(sim, p));
  candidates.push(scoreHoldCandidate(sim, p));
  const clear = scoreClearCandidate(sim, p);
  if (clear) candidates.push(clear);
  return candidates;
}

/**
 * 점수 최댓값 후보 하나를 고른다. 동점이면 tiebreak 오름차순(§6.10 체크리스트의
 * "playerId 오름차순" 규칙을 후보 식별자로 확장 — 패스는 대상 선수의 정수 id,
 * 그 외 타입은 고정 상수라 대상이 없는 후보끼리도 항상 같은 순서로 정렬된다).
 *
 * 최댓값 선택 뒤에 "선택 개성"(boldness)을 한 번 더 적용한다 — 이건 후보 채점이 아니라
 * 채점이 끝난 다음 "그중에서 실제로 뭘 고르는 성격이냐"의 문제라 점수함수 목록에는 안 넣고
 * 여기서 한 단계로 둔다. 패스 대상 사이에서만 의미가 있어(왜 슛 대신 드리블을 택했는지에는
 * "과감함"이 적용될 자리가 없다) best.type==='pass'일 때만 작동한다.
 */
export function chooseAction(sim, p) {
  const candidates = buildCandidates(sim, p);
  let best = null;
  for (const c of candidates) {
    if (!best || c.score > best.score || (c.score === best.score && c.tiebreak < best.tiebreak)) {
      best = c;
    }
  }
  if (best && best.type === 'pass') {
    best = applyPersonalityDeviation(sim, p, candidates, best);
  }
  return best;
}

/**
 * boldness가 중립(0.5)이면 항상 점수 1등 그대로. 과감할수록 가끔 상위권의 아무 대안을,
 * 신중할수록 가끔 상위권 중 가장 안전한(전진이득이 가장 낮은) 대안을 대신 고른다.
 * 판단 단계의 "성격"이라 실행 성공확률과 무관한 sim.rng(스트림) 그대로 쓴다.
 */
function applyPersonalityDeviation(sim, p, candidates, best) {
  const passCandidates = candidates.filter((c) => c.type === 'pass');
  if (passCandidates.length <= 1) return best;
  const bold = p.boldness - 0.5;
  const deviateProb = Math.abs(bold) * 2 * PARAMS.personalityDeviateMax;
  if (sim.rng.next() >= deviateProb) return best;

  const ranked = [...passCandidates].sort((a, b) => b.score - a.score).slice(0, PARAMS.personalityTopN);
  if (bold > 0) {
    const alts = ranked.slice(1);
    if (!alts.length) return best;
    return alts[Math.floor(sim.rng.next() * alts.length)];
  }
  return ranked.reduce((a, b) => (b.meta.forwardGain < a.meta.forwardGain ? b : a));
}
