import { FIELD } from './params.js';

// 슬롯 좌표는 정규화 값. x:[-0.5,0.5]*L, z:[-0.5,0.5]*W.
// 홈팀은 -x 진영에서 +x 방향으로 공격한다.
export const FORMATIONS = {
  '4-3-3': {
    label: '4-3-3',
    desc: '윙어를 넓게 벌려 측면에서 만든다. 중원 3인의 활동량이 관건.',
    slots: [
      { role: 'GK', x: -0.46, z: 0 },
      { role: 'DF', x: -0.3, z: -0.28 },
      { role: 'DF', x: -0.32, z: -0.09 },
      { role: 'DF', x: -0.32, z: 0.09 },
      { role: 'DF', x: -0.3, z: 0.28 },
      { role: 'MF', x: -0.12, z: -0.22 },
      { role: 'MF', x: -0.14, z: 0 },
      { role: 'MF', x: -0.12, z: 0.22 },
      { role: 'FW', x: 0.14, z: -0.26 },
      { role: 'FW', x: 0.18, z: 0 },
      { role: 'FW', x: 0.14, z: 0.26 },
    ],
  },
  '4-4-2': {
    label: '4-4-2',
    desc: '두 줄 블록으로 버티고 투톱에게 연결한다. 안정적이지만 중앙 숫자가 적다.',
    slots: [
      { role: 'GK', x: -0.46, z: 0 },
      { role: 'DF', x: -0.3, z: -0.3 },
      { role: 'DF', x: -0.33, z: -0.1 },
      { role: 'DF', x: -0.33, z: 0.1 },
      { role: 'DF', x: -0.3, z: 0.3 },
      { role: 'MF', x: -0.1, z: -0.3 },
      { role: 'MF', x: -0.14, z: -0.1 },
      { role: 'MF', x: -0.14, z: 0.1 },
      { role: 'MF', x: -0.1, z: 0.3 },
      { role: 'FW', x: 0.16, z: -0.12 },
      { role: 'FW', x: 0.16, z: 0.12 },
    ],
  },
  '3-4-3': {
    label: '3-4-3',
    desc: '윙백을 끝까지 올려 숫자 싸움을 건다. 역습에 뒷공간을 내준다.',
    slots: [
      { role: 'GK', x: -0.46, z: 0 },
      { role: 'DF', x: -0.32, z: -0.18 },
      { role: 'DF', x: -0.34, z: 0 },
      { role: 'DF', x: -0.32, z: 0.18 },
      { role: 'MF', x: -0.08, z: -0.34 },
      { role: 'MF', x: -0.16, z: -0.11 },
      { role: 'MF', x: -0.16, z: 0.11 },
      { role: 'MF', x: -0.08, z: 0.34 },
      { role: 'FW', x: 0.16, z: -0.24 },
      { role: 'FW', x: 0.2, z: 0 },
      { role: 'FW', x: 0.16, z: 0.24 },
    ],
  },
};

export const FORMATION_KEYS = Object.keys(FORMATIONS);

/** 포메이션별 포지션 요구 수량 (예: {GK:1, DF:4, MF:3, FW:3}) */
export function positionNeeds(key) {
  const need = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const s of FORMATIONS[key].slots) need[s.role]++;
  return need;
}

/** 슬롯 인덱스 → 월드 좌표. side='home'이면 그대로, 'away'면 진영을 뒤집는다. */
export function slotPosition(key, i, side, width = 0.5) {
  const s = FORMATIONS[key].slots[i];
  const sgn = side === 'home' ? 1 : -1;
  const spread = 0.8 + width * 0.5; // 전술 '폭' 슬라이더가 z 간격을 벌린다
  return { x: s.x * FIELD.L * sgn, z: s.z * FIELD.W * spread * sgn, role: s.role };
}
