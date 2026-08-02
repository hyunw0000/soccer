/**
 * Tactics 도메인 (Contracts v1).
 * 네 값 모두 0..1 범위의 순수 데이터이며, 의미 해석은 simulation이 한다.
 */

import { TACTIC_DEFAULT, createDefaultTactics } from '../defaults.js';

export const TACTIC_KEYS = Object.freeze(Object.keys(TACTIC_DEFAULT));

/** 화면이 쓰는 표시 문구. 값 자체가 아니므로 계약에는 포함되지 않는다. */
export const TACTIC_META = Object.freeze([
  { key: 'lineHeight', label: '수비 라인', lo: '내려선다', hi: '끌어올린다' },
  { key: 'pressing', label: '압박 강도', lo: '지역 방어', hi: '전방 압박' },
  { key: 'tempo', label: '공격 템포', lo: '점유·안정', hi: '직선·속공' },
  { key: 'width', label: '진영 폭', lo: '좁게', hi: '넓게' },
]);

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * 저장값·입력값을 안전한 Tactics로 정규화한다.
 * 알 수 없는 키는 버리고, 숫자가 아니면 기본값으로 되돌린다.
 */
export function normalizeTactics(input) {
  const out = createDefaultTactics();
  if (!input || typeof input !== 'object') return out;
  for (const key of TACTIC_KEYS) {
    const n = Number(input[key]);
    if (Number.isFinite(n)) out[key] = clamp01(n);
  }
  return out;
}

/** @returns {{ok: boolean, errors: Array<{code: string, message: string, key?: string}>}} */
export function validateTactics(tactics) {
  const errors = [];
  if (!tactics || typeof tactics !== 'object') {
    errors.push({ code: 'tactics/missing', message: '전술 값이 없습니다.' });
    return { ok: false, errors };
  }
  for (const key of TACTIC_KEYS) {
    const n = Number(tactics[key]);
    if (!Number.isFinite(n)) {
      errors.push({ code: 'tactics/not-number', message: `${key} 값이 숫자가 아닙니다.`, key });
    } else if (n < 0 || n > 1) {
      errors.push({ code: 'tactics/range', message: `${key} 값은 0..1 이어야 합니다. 현재 ${n}.`, key });
    }
  }
  for (const key of Object.keys(tactics)) {
    if (!TACTIC_KEYS.includes(key)) {
      errors.push({ code: 'tactics/unknown-key', message: `알 수 없는 전술 값입니다: ${key}`, key });
    }
  }
  return { ok: errors.length === 0, errors };
}
