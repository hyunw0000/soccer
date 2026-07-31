import { FIELD } from './params.js';

/** 정규화 포메이션 슬롯 → 월드 좌표. 원정은 진영을 뒤집는다. */
export function slotPosition(slots, index, side, width = 0.5) {
  const slot = slots[index];
  if (!slot) throw new Error(`formation slot ${index} not found`);
  const direction = side === 'home' ? 1 : -1;
  const spread = 0.8 + width * 0.5;
  return {
    x: slot.x * FIELD.L * direction,
    z: slot.z * FIELD.W * spread * direction,
    role: slot.role,
  };
}
