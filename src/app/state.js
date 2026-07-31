import { defaultPool, findById } from '../roster/index.js';
import { TACTIC_DEFAULT } from '../tactics/index.js';

const STORAGE_KEY = 'soccer-manager-3d/v1';

/**
 * 화면 간에 공유되는 감독 세션.
 * 서버가 없으므로 localStorage에만 저장한다 — 저장되는 값은 사용자가 직접 입력한
 * 감독 이름(닉네임)과 선택한 선수 id뿐이다. 개인정보·인증정보는 저장하지 않는다.
 */
const initial = {
  managerName: '',
  poolIds: defaultPool(23),
  captainId: 'kor_son',
  formation: '4-3-3',
  oppFormation: '4-4-2',
  tactics: { ...TACTIC_DEFAULT },
};

export const state = { ...initial, ...load() };

export function setState(patch) {
  Object.assign(state, patch);
  save();
}

export function resetState() {
  Object.assign(state, initial, { poolIds: defaultPool(23), tactics: { ...TACTIC_DEFAULT } });
  save();
}

export const captain = () => findById(state.captainId);

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        managerName: state.managerName,
        poolIds: state.poolIds,
        captainId: state.captainId,
        formation: state.formation,
        tactics: state.tactics,
      })
    );
  } catch {
    /* 시크릿 모드 등 저장 불가 환경은 무시 — 기능은 그대로 동작해야 한다 */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    // 저장값은 신뢰하지 않는다: 타입/범위를 검증해 통과한 것만 받는다
    const out = {};
    if (typeof v.managerName === 'string') out.managerName = v.managerName.slice(0, 20);
    if (Array.isArray(v.poolIds)) {
      const ids = v.poolIds.filter((id) => typeof id === 'string' && findById(id));
      if (ids.length >= 11) out.poolIds = ids.slice(0, 26);
    }
    if (typeof v.captainId === 'string' && findById(v.captainId)) out.captainId = v.captainId;
    if (typeof v.formation === 'string') out.formation = v.formation;
    if (v.tactics && typeof v.tactics === 'object') {
      out.tactics = { ...TACTIC_DEFAULT };
      for (const k of Object.keys(TACTIC_DEFAULT)) {
        const n = Number(v.tactics[k]);
        if (Number.isFinite(n)) out.tactics[k] = Math.min(1, Math.max(0, n));
      }
    }
    return out;
  } catch {
    return {};
  }
}
