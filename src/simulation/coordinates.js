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
// 감독이 이 선수만 극단으로 지시하면 대형에서 확 튀어나올 만큼 크게 잡는다.
const FORWARD_RANGE = 0.3; // ±0.15 → 필드 기준 약 ±16m
const WIDTH_RANGE = 1.1; // 0.45배(중앙) … 1.55배(측면)

/**
 * 정규화 좌표(±0.5)에서 라인 안쪽으로 남겨 두는 여유.
 * 전술을 어떻게 밀어도 자리는 경기장 안에 있어야 한다 — 폭·전진성·팀 전술을 곱한 **뒤에**
 * 이 한계로 자르기 때문에, 값을 끝까지 올려도 선수가 터치라인·골라인 밖에 서지 않는다.
 */
const PITCH_MARGIN = 0.04; // 길이 기준 약 4m, 폭 기준 약 2.7m
const LIMIT = 0.5 - PITCH_MARGIN;
const clampToPitch = (n) => Math.min(LIMIT, Math.max(-LIMIT, n));

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
  const spread = 0.65 + width * 0.8;
  const ins = instruction ? normalizeInstruction(instruction) : INSTRUCTION_FALLBACK;

  // 전진성은 자기 자리를 상대 골문 쪽으로 밀고, 개인 폭과 팀 폭은 중앙에서 벌어진 거리를 늘린다.
  // 팀 폭(spread)까지 곱한 뒤에 한 번만 자른다 — 곱하기 전에 자르면 폭을 올렸을 때
  // 자리가 터치라인 밖으로 나가 버린다(예전에 실제로 그랬다).
  const px = x + (ins.forwardness - 0.5) * FORWARD_RANGE;
  const pz = z * (1 + (ins.width - 0.5) * WIDTH_RANGE) * spread;

  return {
    x: clampToPitch(px) * FIELD.L * direction,
    z: clampToPitch(pz) * FIELD.W * direction,
  };
}

/** assignment 하나를 월드 좌표 슬롯으로 바꾼다. 역할과 개인 지시는 그대로 들고 간다. */
export function assignmentSlot(assignment, side, width) {
  const instruction = normalizeInstruction(assignment.instruction);
  const { x, z } = normalizedToWorld(assignment, { side, width, instruction });
  return { x, z, role: assignment.role, instruction };
}
