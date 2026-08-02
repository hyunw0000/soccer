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
  poolIds: defaultPool(26),
  captainId: 'kor_son',
  formation: '4-3-3',
  tactics: { ...TACTIC_DEFAULT },
  // 포메이션별로 감독이 옮겨 둔 좌표. { formationId: { slotId: {x, z} } }
  lineupPositions: {},
  // 자리별 개인 전술 8축. { slotId: { forwardness, width, ... } }
  // 지시는 선수가 아니라 자리에 붙는다 — 다른 선수를 세워도 그 자리의 지시로 뛴다.
  slotTactics: {},
  // 아래 세 값은 화면이 채운다. 경기 화면은 pendingMatchSetup만 읽는다.
  startingLineup: null,
  currentOpponent: null,
  pendingMatchSetup: null,
};

export const state = { ...initial, ...load() };

export function setState(patch) {
  Object.assign(state, patch);
  save();
}

export function resetState() {
  Object.assign(state, initial, {
    poolIds: defaultPool(26),
    tactics: { ...TACTIC_DEFAULT },
    lineupPositions: {},
    slotTactics: {},
    // 새 게임이 이전 경기 설정을 물려받지 않게 한다.
    startingLineup: null,
    currentOpponent: null,
    pendingMatchSetup: null,
  });
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
        // 감독이 보드에서 옮긴 배치까지 복원한다. MatchSetup은 전술 화면이 다시 만든다.
        startingLineup: state.startingLineup,
        lineupPositions: state.lineupPositions,
        slotTactics: state.slotTactics,
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
    // 배치는 lineup의 createStartingLineup이 읽을 때 정규화하므로 형태만 확인한다.
    if (v.startingLineup && Array.isArray(v.startingLineup.assignments)) {
      out.startingLineup = v.startingLineup;
    }
    // 좌표 기억은 { formationId: { slotId: {x, z} } } 모양만 받는다. 값은 편집기가 다시 잘라낸다.
    if (v.lineupPositions && typeof v.lineupPositions === 'object') {
      const memory = {};
      for (const [formationId, slots] of Object.entries(v.lineupPositions)) {
        if (!slots || typeof slots !== 'object') continue;
        const kept = {};
        for (const [slotId, p] of Object.entries(slots)) {
          if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z))) {
            kept[slotId] = { x: Number(p.x), z: Number(p.z) };
          }
        }
        memory[formationId] = kept;
      }
      out.lineupPositions = memory;
    }
    // 개인 전술은 tactics 영역의 normalizePlayerTactics가 값을 잘라내므로 모양만 확인한다.
    // 선수 id로 저장하던 옛 값(v.playerTactics)은 읽지 않는다 — 자리에 붙는 값이 되었다.
    if (v.slotTactics && typeof v.slotTactics === 'object') {
      out.slotTactics = Object.fromEntries(
        Object.entries(v.slotTactics).filter(([, t]) => t && typeof t === 'object')
      );
    }
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
