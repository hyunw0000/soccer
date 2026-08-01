/**
 * 포메이션 정의와 정규화 슬롯의 단일 출처 (담당자 3 / A안).
 *
 * 좌표는 정규화 값이다. x, z 모두 [-0.5, 0.5] 범위이며
 * "자기 진영에서 상대 진영으로 공격"하는 기준으로만 기술한다.
 * 필드 미터 변환, 진영 반전, 전술 폭 적용은 simulation의 책임이다.
 *
 * slotId는 배열 순서가 바뀌어도 유지되는 안정적인 값이다.
 * StartingLineup.assignments[].slotId가 같은 값을 참조한다.
 *
 * 표의 label은 읽기용 메모다. 공개되는 슬롯의 label·position은 좌표에서 파생하므로
 * 좌표를 옮기면 이름도 함께 바뀐다 — 두 값이 어긋날 일이 없다.
 */

import { positionCode } from './domain/roles.js';

/**
 * 격자의 줄 깊이(x)와 칸 좌우(z). 포메이션 좌표는 전부 여기서 골라 쓴다.
 *
 * 값은 각 칸의 한가운데다. 손으로 찍은 값을 쓰면 칸 경계에 아슬아슬하게 붙어서,
 * 감독이 카드를 조금만 밀어도 이름이 바뀌거나 기본 배치의 이름이 슬롯 뜻과 어긋난다.
 */
const ROW = Object.freeze({
  GK: -0.46,
  CB: -0.31, // 센터백 줄
  FB: -0.28, // 풀백은 센터백보다 반 발 앞
  DM: -0.185,
  CM: -0.09,
  AM: 0.04,
  FWD: 0.135, // 포워드 줄 (LW / LF / CF / RF / RW)
  ST: 0.22, // 최전방 줄 (LS / ST / RS)
});

const COL = Object.freeze({
  CENTER: 0,
  INSIDE: 0.12, // 중앙 두 명이 나란히 설 때 (LCB·RCB, LCM·RCM ...)
  PAIR: 0.14, // 투톱과 백3의 좌우 센터백
  HALF: 0.15, // 중원 3인의 좌우
  SHOULDER: 0.18, // 삼각편대의 좌우. 측면이되 터치라인까지는 안 간다
  WIDE: 0.28, // 측면 미드필더
  FLANK: 0.3, // 풀백·윙어
  TOUCH: 0.38, // 윙백. 터치라인에 붙는다
});

// slots 배열 순서는 GK → DF → MF → FW를 유지한다.
// simulation이 슬롯 배열 순서로 선수를 배치하므로 순서를 임의로 바꾸지 않는다.
const RAW_FORMATIONS = {
  '4-3-3': {
    label: '4-3-3',
    description: '윙어를 넓게 벌려 측면에서 만든다. 중원 3인의 활동량이 관건.',
    slots: [
      { slot: 'gk', label: 'GK', role: 'GK', x: ROW.GK, z: COL.CENTER },
      { slot: 'lb', label: 'LB', role: 'DF', x: ROW.FB, z: -COL.FLANK },
      { slot: 'lcb', label: 'LCB', role: 'DF', x: ROW.CB, z: -COL.PAIR },
      { slot: 'rcb', label: 'RCB', role: 'DF', x: ROW.CB, z: COL.PAIR },
      { slot: 'rb', label: 'RB', role: 'DF', x: ROW.FB, z: COL.FLANK },
      { slot: 'lcm', label: 'LCM', role: 'MF', x: ROW.CM, z: -COL.HALF },
      { slot: 'cm', label: 'CM', role: 'MF', x: ROW.CM, z: COL.CENTER },
      { slot: 'rcm', label: 'RCM', role: 'MF', x: ROW.CM, z: COL.HALF },
      { slot: 'lw', label: 'LW', role: 'FW', x: ROW.FWD, z: -COL.FLANK },
      { slot: 'st', label: 'ST', role: 'FW', x: ROW.ST, z: COL.CENTER },
      { slot: 'rw', label: 'RW', role: 'FW', x: ROW.FWD, z: COL.FLANK },
    ],
  },
  '4-4-2': {
    label: '4-4-2',
    description: '두 줄 블록으로 버티고 투톱에게 연결한다. 안정적이지만 중앙 숫자가 적다.',
    slots: [
      { slot: 'gk', label: 'GK', role: 'GK', x: ROW.GK, z: COL.CENTER },
      { slot: 'lb', label: 'LB', role: 'DF', x: ROW.FB, z: -COL.FLANK },
      { slot: 'lcb', label: 'LCB', role: 'DF', x: ROW.CB, z: -COL.PAIR },
      { slot: 'rcb', label: 'RCB', role: 'DF', x: ROW.CB, z: COL.PAIR },
      { slot: 'rb', label: 'RB', role: 'DF', x: ROW.FB, z: COL.FLANK },
      // 미드필더 4인은 한 줄로 선다. 두 줄 블록이 이 포메이션의 뼈대다.
      { slot: 'lm', label: 'LM', role: 'MF', x: ROW.CM, z: -COL.WIDE },
      { slot: 'lcm', label: 'LCM', role: 'MF', x: ROW.CM, z: -COL.INSIDE },
      { slot: 'rcm', label: 'RCM', role: 'MF', x: ROW.CM, z: COL.INSIDE },
      { slot: 'rm', label: 'RM', role: 'MF', x: ROW.CM, z: COL.WIDE },
      { slot: 'lst', label: 'LS', role: 'FW', x: ROW.ST, z: -COL.PAIR },
      { slot: 'rst', label: 'RS', role: 'FW', x: ROW.ST, z: COL.PAIR },
    ],
  },
  '4-2-3-1': {
    label: '4-2-3-1',
    description: '더블 볼란치가 뒤를 잠그고 삼각편대가 최전방을 받친다. 측면의 복귀가 관건.',
    slots: [
      { slot: 'gk', label: 'GK', role: 'GK', x: ROW.GK, z: COL.CENTER },
      { slot: 'lb', label: 'LB', role: 'DF', x: ROW.FB, z: -COL.FLANK },
      { slot: 'lcb', label: 'LCB', role: 'DF', x: ROW.CB, z: -COL.PAIR },
      { slot: 'rcb', label: 'RCB', role: 'DF', x: ROW.CB, z: COL.PAIR },
      { slot: 'rb', label: 'RB', role: 'DF', x: ROW.FB, z: COL.FLANK },
      { slot: 'ldm', label: 'LDM', role: 'MF', x: ROW.DM, z: -COL.INSIDE },
      { slot: 'rdm', label: 'RDM', role: 'MF', x: ROW.DM, z: COL.INSIDE },
      { slot: 'lam', label: 'LAM', role: 'MF', x: ROW.AM, z: -COL.SHOULDER },
      { slot: 'cam', label: 'CAM', role: 'MF', x: ROW.AM, z: COL.CENTER },
      { slot: 'ram', label: 'RAM', role: 'MF', x: ROW.AM, z: COL.SHOULDER },
      { slot: 'st', label: 'ST', role: 'FW', x: ROW.ST, z: COL.CENTER },
    ],
  },
  '3-4-3': {
    label: '3-4-3',
    description: '윙백을 끝까지 올려 숫자 싸움을 건다. 역습에 뒷공간을 내준다.',
    slots: [
      { slot: 'gk', label: 'GK', role: 'GK', x: ROW.GK, z: COL.CENTER },
      { slot: 'lcb', label: 'LCB', role: 'DF', x: ROW.CB, z: -COL.PAIR },
      { slot: 'cb', label: 'CB', role: 'DF', x: ROW.CB - 0.02, z: COL.CENTER },
      { slot: 'rcb', label: 'RCB', role: 'DF', x: ROW.CB, z: COL.PAIR },
      // 윙백은 중원 줄까지 올라가 터치라인을 잡는다. 측면 미드필더보다 더 넓다.
      { slot: 'lwb', label: 'LWB', role: 'MF', x: ROW.CM, z: -COL.TOUCH },
      { slot: 'lcm', label: 'LCM', role: 'MF', x: ROW.CM, z: -COL.INSIDE },
      { slot: 'rcm', label: 'RCM', role: 'MF', x: ROW.CM, z: COL.INSIDE },
      { slot: 'rwb', label: 'RWB', role: 'MF', x: ROW.CM, z: COL.TOUCH },
      { slot: 'lw', label: 'LW', role: 'FW', x: ROW.FWD, z: -COL.FLANK },
      { slot: 'st', label: 'ST', role: 'FW', x: ROW.ST, z: COL.CENTER },
      { slot: 'rw', label: 'RW', role: 'FW', x: ROW.FWD, z: COL.FLANK },
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
          formation.slots.map(({ slot, role, x, z }) =>
            // 세부 포지션은 좌표에서 파생한다. 표에 적어 둔 label과 실제 좌표가
            // 어긋나면 카드에 적히는 이름과 슬롯 이름이 달라지므로 출처를 하나로 둔다.
            Object.freeze({
              slotId: `${formationId}-${slot}`,
              position: positionCode(role, x, z),
              label: positionCode(role, x, z),
              role,
              x,
              z,
            })
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
