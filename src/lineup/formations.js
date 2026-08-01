/**
 * 포메이션 정의와 정규화 슬롯의 단일 출처 (담당자 3 / A안).
 *
 * 좌표는 정규화 값이다. x, z 모두 [-0.5, 0.5] 범위이며
 * "자기 진영에서 상대 진영으로 공격"하는 기준으로만 기술한다.
 * 필드 미터 변환, 진영 반전, 전술 폭 적용은 simulation의 책임이다.
 *
 * slotId는 배열 순서가 바뀌어도 유지되는 안정적인 값이다.
 * StartingLineup.assignments[].slotId가 같은 값을 참조한다.
 */

// slots 배열 순서는 GK → DF → MF → FW를 유지한다.
// simulation이 슬롯 배열 순서로 선수를 배치하므로 순서를 임의로 바꾸지 않는다.
const RAW_FORMATIONS = {
  '4-3-3': {
    label: '4-3-3',
    description: '윙어를 넓게 벌려 측면에서 만든다. 중원 3인의 활동량이 관건.',
    slots: [
      { slot: 'gk', label: 'GK', role: 'GK', x: -0.46, z: 0 },
      { slot: 'lb', label: 'LB', role: 'DF', x: -0.3, z: -0.28 },
      { slot: 'lcb', label: 'LCB', role: 'DF', x: -0.32, z: -0.09 },
      { slot: 'rcb', label: 'RCB', role: 'DF', x: -0.32, z: 0.09 },
      { slot: 'rb', label: 'RB', role: 'DF', x: -0.3, z: 0.28 },
      { slot: 'lcm', label: 'LCM', role: 'MF', x: -0.12, z: -0.22 },
      { slot: 'cm', label: 'CM', role: 'MF', x: -0.14, z: 0 },
      { slot: 'rcm', label: 'RCM', role: 'MF', x: -0.12, z: 0.22 },
      { slot: 'lw', label: 'LW', role: 'FW', x: 0.14, z: -0.26 },
      { slot: 'st', label: 'ST', role: 'FW', x: 0.18, z: 0 },
      { slot: 'rw', label: 'RW', role: 'FW', x: 0.14, z: 0.26 },
    ],
  },
  '4-4-2': {
    label: '4-4-2',
    description: '두 줄 블록으로 버티고 투톱에게 연결한다. 안정적이지만 중앙 숫자가 적다.',
    slots: [
      { slot: 'gk', label: 'GK', role: 'GK', x: -0.46, z: 0 },
      { slot: 'lb', label: 'LB', role: 'DF', x: -0.3, z: -0.3 },
      { slot: 'lcb', label: 'LCB', role: 'DF', x: -0.33, z: -0.1 },
      { slot: 'rcb', label: 'RCB', role: 'DF', x: -0.33, z: 0.1 },
      { slot: 'rb', label: 'RB', role: 'DF', x: -0.3, z: 0.3 },
      { slot: 'lm', label: 'LM', role: 'MF', x: -0.1, z: -0.3 },
      { slot: 'lcm', label: 'LCM', role: 'MF', x: -0.14, z: -0.1 },
      { slot: 'rcm', label: 'RCM', role: 'MF', x: -0.14, z: 0.1 },
      { slot: 'rm', label: 'RM', role: 'MF', x: -0.1, z: 0.3 },
      { slot: 'lst', label: 'LST', role: 'FW', x: 0.16, z: -0.12 },
      { slot: 'rst', label: 'RST', role: 'FW', x: 0.16, z: 0.12 },
    ],
  },
  '3-4-3': {
    label: '3-4-3',
    description: '윙백을 끝까지 올려 숫자 싸움을 건다. 역습에 뒷공간을 내준다.',
    slots: [
      { slot: 'gk', label: 'GK', role: 'GK', x: -0.46, z: 0 },
      { slot: 'lcb', label: 'LCB', role: 'DF', x: -0.32, z: -0.18 },
      { slot: 'cb', label: 'CB', role: 'DF', x: -0.34, z: 0 },
      { slot: 'rcb', label: 'RCB', role: 'DF', x: -0.32, z: 0.18 },
      { slot: 'lwb', label: 'LWB', role: 'MF', x: -0.08, z: -0.34 },
      { slot: 'lcm', label: 'LCM', role: 'MF', x: -0.16, z: -0.11 },
      { slot: 'rcm', label: 'RCM', role: 'MF', x: -0.16, z: 0.11 },
      { slot: 'rwb', label: 'RWB', role: 'MF', x: -0.08, z: 0.34 },
      { slot: 'lw', label: 'LW', role: 'FW', x: 0.16, z: -0.24 },
      { slot: 'st', label: 'ST', role: 'FW', x: 0.2, z: 0 },
      { slot: 'rw', label: 'RW', role: 'FW', x: 0.16, z: 0.24 },
    ],
  },
};

/** 정규화 좌표 허용 범위. lineup 검증과 MatchSetup 생성이 함께 사용한다. */
export const COORD_MIN = -0.5;
export const COORD_MAX = 0.5;

/** 포메이션당 슬롯 수 = 선발 인원. */
export const LINEUP_SIZE = 11;

export const FORMATIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_FORMATIONS).map(([formationId, formation]) => [
      formationId,
      Object.freeze({
        id: formationId,
        label: formation.label,
        description: formation.description,
        // 기존 화면이 사용하던 desc 필드도 계약으로 함께 유지한다.
        desc: formation.description,
        slots: Object.freeze(
          formation.slots.map(({ slot, label, role, x, z }) =>
            Object.freeze({ slotId: `${formationId}-${slot}`, label, role, x, z })
          )
        ),
      }),
    ])
  )
);

export const FORMATION_KEYS = Object.freeze(Object.keys(FORMATIONS));

/** @returns {object|null} 알 수 없는 id는 null. 호출자가 fallback을 결정한다. */
export function getFormation(formationId) {
  return FORMATIONS[formationId] ?? null;
}

/** @returns {ReadonlyArray<object>} 없는 포메이션은 빈 배열. */
export function getNormalizedSlots(formationId) {
  return getFormation(formationId)?.slots ?? [];
}

/** @returns {object|null} 포메이션 안에서 slotId로 슬롯을 찾는다. */
export function getSlot(formationId, slotId) {
  return getNormalizedSlots(formationId).find((slot) => slot.slotId === slotId) ?? null;
}

/** 포메이션별 포지션 요구 수량 (예: {GK:1, DF:4, MF:3, FW:3}) */
export function positionNeeds(formationId) {
  const need = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const slot of getNormalizedSlots(formationId)) need[slot.role]++;
  return need;
}

/** 알 수 없는 포메이션이 들어와도 화면이 죽지 않도록 첫 번째 포메이션으로 되돌린다. */
export function resolveFormationId(formationId) {
  return FORMATIONS[formationId] ? formationId : FORMATION_KEYS[0];
}
