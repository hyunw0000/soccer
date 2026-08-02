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
  if (p.team !== 'home') return 0.5;
  return clamp(sim.tactics.pressing + (p.ins.pressing - 0.5) * 0.6, 0, 1);
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

/** 골문을 향한 각도 여유(0..1, 1=정면). 측면에서 쏠수록 낮아진다. */
function shotAngleFactor(p) {
  return clamp(1 - Math.abs(p.z) / HALF.W, 0.15, 1);
}

/** 패스 후보 — 동료마다 독립적으로 채점한다(§6.5 U(패스→j)). */
export function scorePassCandidates(sim, p) {
  const mates = p.team === 'home' ? sim.homeP : sim.awayP;
  const gdSelf = vlen(p.atkX - p.x, 0 - p.z);
  const wForward = p.ins.forwardness;
  const wSafety = 1 - p.ins.risk;
  const preferredPassLength = 8 + p.ins.passLength * 32;
  // widthBias를 순수하게 중립(0)으로 두니, forwardGain이 거의 항상 "그 순간 제일 전진해 있는
  // 중앙 선수"를 이겨서 측면 선수는 지시가 없으면 사실상 절대 안 뽑혔다(실전 확인: 90분 동안
  // 와이드 포지션 두 명 합쳐 픽업 3회, 수비수 4명은 0회 — 폭을 전혀 안 씀). 실제 팀은 지시가
  // 없어도 어느 정도는 폭을 쓰므로, 기본값(0.5)에서도 작게나마 측면에 가산이 붙게
  // PARAMS.widthDefaultBias만큼 기본으로 얹는다. 명시적으로 "좁게"(0) 지시하면 여전히
  // 감산으로 돌아선다.
  const widthBias = PARAMS.widthDefaultBias + (p.ins.width - 0.5) * 2; // 기본값(0.5)일 때도 소폭 가산
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
    const wideness = clamp(Math.abs(m.z) / HALF.W, 0, 1); // 0=중앙, 1=터치라인
    const widthFit = widthBias * wideness;
    const lengthPenalty = Math.abs(d - preferredPassLength) / PARAMS.maxPass;
    const captainBonus = m.isCaptain ? 0.15 : 0;

    const score = wForward * forwardGain + wSafety * successProb + widthFit - lengthPenalty + captainBonus;
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

  const wForward = p.ins.forwardness;
  const wSafety = 1 - p.ins.risk;
  const angleFactor = shotAngleFactor(p);
  const distFactor = clamp(1 - gd / 34, 0, 1);
  const expectedGoalValue = distFactor * 0.7 + angleFactor * 0.3;
  const successProb = shootSuccessProb(sim, p, gd, angleFactor);

  let score = wForward * expectedGoalValue - wSafety * (1 - successProb);
  // 골문 코앞에서 계속 드리블만 하다 골라인으로 걸어들어가는 옛 버그(mandatoryShotDistance)를
  // "굴림으로 강제"가 아니라 "다른 후보가 절대 못 이기는 점수"로 표현한다 — 판단 결과가
  // 여전히 하나의 점수 비교에서 나오므로 chooseAction()의 일반 규칙을 벗어나지 않는다.
  if (gd < PARAMS.mandatoryShotDistance) score += 999;
  return { type: 'shoot', score, tiebreak: -1, meta: { distance: gd, successProb, angleFactor } };
}

/** 드리블(전진 유지) 후보 — §6.5 U(드리블). */
export function scoreDribbleCandidate(sim, p) {
  const opps = p.team === 'home' ? sim.awayP : sim.homeP;
  const dir = p.team === 'home' ? 1 : -1;
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
  const pressureDensity = densityCount * PARAMS.dribblePressureCoef;

  const wForward = p.ins.forwardness;
  const risk = p.ins.risk;
  // dribbleScoreScale: 실전 계측 결과, 압박이 하나도 안 잡히는(=흔한) 순간마다 드리블이
  // "전진이득 만점 + 돌파기대 절반"으로 거의 항상 0.7~0.8점을 찍어서 패스를 압도적으로
  // 이겼다(90분 실전 한 판에서 판단 96회 중 64회가 드리블, 패스는 겨우 15회 — 그래서
  // 볼이 안 퍼지고 한 명이 몰다 태클로만 넘어갔다). 패스에는 있는 "성공확률" 항이 드리블에는
  // 없어서 애초에 대칭이 아니었던 구조적 문제라, 전체 점수를 한 단계 낮춰 패스와 정직하게
  // 경쟁하게 하고, 압박은 조금만 있어도 확실히 깎이게 계수를 올렸다.
  const score = PARAMS.dribbleScoreScale * (wForward * forwardGain + risk * breakExpect) - pressureDensity;
  return { type: 'dribble', score, tiebreak: -2, meta: { densityCount } };
}

/** 키핑(제자리 볼 지키기) 후보 — 압박이 세고 신중할수록 매력적인, 항상 존재하는 안전판. */
export function scoreHoldCandidate(sim, p) {
  const density = pressureCount(sim, p);
  const wSafety = 1 - p.ins.risk;
  const score = wSafety * 0.5 + density * 0.15 - 0.1;
  return { type: 'hold', score, tiebreak: -3, meta: { density } };
}

/** 클리어(무조건 걷어내기) 후보 — 자기 진영 3분의 1 안에서 압박받을 때만 등장한다. */
export function scoreClearCandidate(sim, p) {
  const ownThird = p.team === 'home' ? p.x < -HALF.L / 3 : p.x > HALF.L / 3;
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
