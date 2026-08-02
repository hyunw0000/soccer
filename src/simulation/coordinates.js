import { FIELD } from './params.js';

/**
 * 선수별 지시 8축의 기본값. 0.5는 "지시 없음"이고, 계약에 지시가 없으면 이 값으로 읽는다.
 * simulation은 8축의 단계 값(1..5)을 모른다 — 계약에 실려 온 0..1만 쓴다.
 */
export const INSTRUCTION_FALLBACK = Object.freeze({
  forwardness: 0.5,
  width: 0.5,
  runs: 0.5,
  roaming: 0.5,
  pressing: 0.5,
  passLength: 0.5,
  risk: 0.5,
  coverage: 0.5,
});

const finite01 = (n) => (Number.isFinite(n) && n >= 0 && n <= 1 ? n : null);

/** 계약의 instruction을 안전한 8축 값으로 되돌린다. 없는 축은 기본값 0.5. */
export function normalizeInstruction(input) {
  if (!input || typeof input !== 'object') return { ...INSTRUCTION_FALLBACK };
  const out = { ...INSTRUCTION_FALLBACK };
  for (const key of Object.keys(INSTRUCTION_FALLBACK)) {
    const v = finite01(Number(input[key]));
    if (v !== null) out[key] = v;
  }
  return out;
}

// 개인 지시가 기본 위치를 흔드는 폭. 전진성은 정규화 좌표 기준, 폭은 배수다.
// 감독이 보드에서 끌어 놓은 자리를 뒤엎지 않을 만큼만 움직인다.
const FORWARD_RANGE = 0.12; // ±0.06 → 필드 기준 약 ±6m
const WIDTH_RANGE = 0.5; // 0.75배(중앙) … 1.25배(측면)
const WORLD_EDGE_MARGIN = 1; // 최종 월드 좌표가 터치라인에서 최소 이만큼은 떨어져 있게 한다(m)

/**
 * MatchSetup의 정규화 좌표 → 월드 좌표.
 *
 * 입력은 항상 "자기 진영에서 상대 진영으로 공격"하는 기준의 [-0.5, 0.5] 값이다.
 * 진영 반전, 필드 미터 변환, 전술 폭 적용은 simulation의 책임이며 여기서만 한다.
 * simulation은 formationId를 해석하지 않고 전달받은 좌표만 변환한다.
 *
 * @param {{x: number, z: number}} coord 정규화 좌표
 * @param {{side?: 'home'|'away', width?: number, instruction?: object}} [options]
 * @returns {{x: number, z: number}} 월드 좌표
 */
export function normalizedToWorld({ x, z }, { side = 'home', width = 0.5, instruction = null } = {}) {
  const direction = side === 'home' ? 1 : -1;
  // 이전 계수(0.8+width*0.5)는 전술 폭을 최대로 올려도 실제 포메이션 z_norm(~0.30, 풀백/윙어
  // 기준)이 터치라인(HALF.W=34m)에서 7.5m 못 미쳐서, 스로인/코너킥이 사실상 안 나왔다(패스
  // AI를 아무리 손봐도 애초에 아무도 그 자리까지 못 감 — 실측으로 확인). 상한을 터치라인
  // 근처까지 닿을 만큼 올린다.
  const spread = 1.0 + width * 0.6;
  const ins = instruction ? normalizeInstruction(instruction) : INSTRUCTION_FALLBACK;

  // 전진성은 자기 자리를 상대 골문 쪽으로 밀고, 개인 폭은 중앙에서 벌어진 거리를 늘린다.
  const px = x + (ins.forwardness - 0.5) * FORWARD_RANGE;
  const pz = z * (1 + (ins.width - 0.5) * WIDTH_RANGE);

  // 기존 코드는 z_norm(정규화 값)만 [-0.5,0.5]로 자르고 그 뒤에 ×FIELD.W×spread를 곱했다 —
  // 그러면 스케일을 아무리 키워도 "잘리는 건 스케일 전 값"이라 최종 월드 좌표가 필드 경계를
  // 넘어갈 수 있었다. 팀 폭 지시와 개인 폭 지시가 둘 다 최대로 겹치면(둘 다 독립적으로 배수를
  // 곱하는 구조라) 실측으로 확인한 것처럼 최종 z가 43m까지 나가서, 서로 다른 포지션(예: 풀백과
  // 윙어)이 같은 값으로 겹친 채 터치라인에 나란히 clamp되는 문제가 있었다. 최종 월드 좌표
  // 자체를 필드 경계 안쪽(터치라인에서 WORLD_EDGE_MARGIN만큼 여유)으로 다시 한번 자른다 —
  // 어떤 지시 조합이 와도 이 함수가 필드 밖 좌표를 절대 내보내지 않는다는 걸 보장한다.
  const worldZ = Math.min(0.5, Math.max(-0.5, pz)) * FIELD.W * spread;
  const zLimit = FIELD.W / 2 - WORLD_EDGE_MARGIN;

  return {
    x: Math.min(0.5, Math.max(-0.5, px)) * FIELD.L * direction,
    z: Math.min(zLimit, Math.max(-zLimit, worldZ)) * direction,
  };
}

/** assignment 하나를 월드 좌표 슬롯으로 바꾼다. 역할과 개인 지시는 그대로 들고 간다. */
export function assignmentSlot(assignment, side, width) {
  const instruction = normalizeInstruction(assignment.instruction);
  const { x, z } = normalizedToWorld(assignment, { side, width, instruction });
  return { x, z, role: assignment.role, instruction };
}
