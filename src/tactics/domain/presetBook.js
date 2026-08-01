/**
 * 전술 목록(A/B/C 세트 × 10 슬롯)과 그 저장.
 *
 * 앱 상태(`src/app/state.js`)에는 계약 값인 `tactics` 네 개만 남기고,
 * 감독이 만든 전술 원본은 tactics 영역이 자기 키로 직접 보관한다.
 */

import { PRESET_COUNT, createPreset, normalizePreset } from './presets.js';

const STORAGE_KEY = 'soccer-manager-3d/tactics-book/v1';

export const SET_KEYS = Object.freeze(['A', 'B', 'C']);

/** 공장 초기 상태의 전술 목록. */
export function createBook() {
  const sets = {};
  for (const key of SET_KEYS) {
    sets[key] = Array.from({ length: PRESET_COUNT }, (_, i) => createPreset(i));
  }
  return { activeSet: 'A', selected: { A: 0, B: 0, C: 0 }, sets };
}

/** 저장값을 신뢰하지 않고 형태·범위를 검사해 통과한 것만 받는다. */
export function normalizeBook(input) {
  const out = createBook();
  if (!input || typeof input !== 'object') return out;

  if (SET_KEYS.includes(input.activeSet)) out.activeSet = input.activeSet;

  for (const key of SET_KEYS) {
    const saved = Array.isArray(input.sets?.[key]) ? input.sets[key] : [];
    out.sets[key] = out.sets[key].map((base, i) => (saved[i] ? normalizePreset(saved[i], i) : base));

    const at = Number(input.selected?.[key]);
    if (Number.isInteger(at) && at >= 0 && at < PRESET_COUNT) out.selected[key] = at;
  }
  return out;
}

export const activePreset = (book) => book.sets[book.activeSet][book.selected[book.activeSet]];

/** 현재 선택된 슬롯만 갈아 끼운 새 book. book은 항상 통째로 교체한다. */
export function replaceActive(book, preset) {
  const set = book.activeSet;
  const at = book.selected[set];
  return {
    ...book,
    sets: { ...book.sets, [set]: book.sets[set].map((p, i) => (i === at ? preset : p)) },
  };
}

export function selectPreset(book, index) {
  return { ...book, selected: { ...book.selected, [book.activeSet]: index } };
}

export function selectSet(book, setKey) {
  return SET_KEYS.includes(setKey) ? { ...book, activeSet: setKey } : book;
}

export function loadBook() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeBook(JSON.parse(raw)) : createBook();
  } catch {
    return createBook();
  }
}

export function saveBook(book) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
  } catch {
    /* 시크릿 모드 등 저장 불가 환경은 무시 — 전술 자체는 그대로 동작해야 한다 */
  }
}
