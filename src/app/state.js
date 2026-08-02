import { defaultPool, findById } from '../roster/index.js';
import { TACTIC_DEFAULT } from '../tactics/index.js';
import {
  applyKoreaMatchResult,
  clearKoreaMatchResult,
  createGameProgress,
  normalizeKnockoutResults,
} from '../tournament/domain/gameProgress.js';

export const STORAGE_KEY = 'football-manager-simulator';

/**
 * 화면 간에 공유되는 감독 세션.
 * 서버가 없으므로 localStorage에만 저장한다 — 저장되는 값은 사용자가 직접 입력한
 * 감독 이름(닉네임)과 선택한 선수 id뿐이다. 개인정보·인증정보는 저장하지 않는다.
 */
const initial = {
  schemaVersion: 2,
  managerName: '',
  hasCompletedSetup: false,
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
  // 지금 치르는 대회 경기 { tournamentId, roundId, bracketMatchId }. MatchSetup의 seed가 여기서 나온다.
  currentTournamentRef: null,
  // TournamentBracket version 2. 공식 원본과 게임 시간선을 구분한다.
  tournamentBracket: null,
  // 남아공전이 끝난 뒤에만 { homeScore, awayScore }를 저장한다. home이 남아공이다.
  groupAFinalResult: null,
  // 32강부터의 우리 경기 결과. 진행 순서대로만 쌓인다.
  // [{ matchId, koreaScore, opponentScore, koreaPenaltyScore?, opponentPenaltyScore?, extraTime? }]
  // — 연장·승부차기는 무승부가 허용되지 않는 32강 이후에만 붙는다.
  knockoutResults: [],
  // 경기를 치를 때마다 오르는 번호. MatchSetup의 seed에 섞어서 같은 라운드를 다시 치러도
  // 지난번과 똑같은 경기가 반복되지 않게 한다.
  matchAttempt: 0,
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
    currentTournamentRef: null,
    tournamentBracket: null,
    groupAFinalResult: null,
    knockoutResults: [],
    matchAttempt: 0,
  });
  save();
}

export const captain = () => findById(state.captainId);

/** 저장된 결과에서 파생한 지금 상황 — 다음 상대·대진표·탈락 여부는 전부 여기서 읽는다. */
export const gameProgress = () =>
  createGameProgress({ groupAFinalResult: state.groupAFinalResult, knockoutResults: state.knockoutResults });

/**
 * 방금 끝난 경기 결과를 저장한다. 점수는 항상 우리 팀 관점이다.
 * 32강부터는 연장·승부차기까지 갈 수 있어 그 결과도 함께 받는다 —
 * 승부차기 점수는 경기 스코어에 더하지 않고 승자를 가리는 데만 쓴다.
 * @returns {object} 반영된 뒤의 진행 상태
 */
export function recordKoreaMatch({
  matchId,
  koreaScore,
  opponentScore,
  koreaPenaltyScore = null,
  opponentPenaltyScore = null,
  extraTime = false,
}) {
  const saved = applyKoreaMatchResult(
    { groupAFinalResult: state.groupAFinalResult, knockoutResults: state.knockoutResults },
    { matchId, koreaScore, opponentScore, koreaPenaltyScore, opponentPenaltyScore, extraTime }
  );
  const progress = createGameProgress(saved);
  setState({
    ...saved,
    tournamentBracket: progress.bracket,
    // 다음 라운드 상대는 새로 뽑아야 한다 — 이전 경기 설정을 물려받으면 같은 상대를 다시 만난다.
    currentOpponent: null,
    pendingMatchSetup: null,
    currentTournamentRef: null,
    // 다시 시도를 누르지 않고 같은 라운드를 또 치러도 지난 경기가 그대로 재생되지 않게 한다.
    matchAttempt: state.matchAttempt + 1,
  });
  return progress;
}

/** 그 경기를 치르기 직전으로 되돌린다. 다시 치르면 시뮬레이션도 다르게 흘러간다. */
export function retryKoreaMatch(matchId) {
  const saved = clearKoreaMatchResult(
    { groupAFinalResult: state.groupAFinalResult, knockoutResults: state.knockoutResults },
    matchId
  );
  const progress = createGameProgress(saved);
  setState({
    ...saved,
    tournamentBracket: progress.bracket,
    currentOpponent: null,
    pendingMatchSetup: null,
    currentTournamentRef: null,
    matchAttempt: state.matchAttempt + 1,
  });
  return progress;
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        managerName: state.managerName,
        hasCompletedSetup: state.hasCompletedSetup,
        poolIds: state.poolIds,
        captainId: state.captainId,
        formation: state.formation,
        tactics: state.tactics,
        // 감독이 보드에서 옮긴 배치까지 복원한다. MatchSetup은 전술 화면이 다시 만든다.
        startingLineup: state.startingLineup,
        lineupPositions: state.lineupPositions,
        slotTactics: state.slotTactics,
        tournamentBracket: state.tournamentBracket,
        groupAFinalResult: state.groupAFinalResult,
        knockoutResults: state.knockoutResults,
        matchAttempt: state.matchAttempt,
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
    if (typeof v.managerName === 'string') out.managerName = v.managerName.trim().slice(0, 20);
    if (v.hasCompletedSetup === true && out.managerName) out.hasCompletedSetup = true;
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
    if (v.tournamentBracket?.version === 2 && Array.isArray(v.tournamentBracket.matches)) {
      out.tournamentBracket = v.tournamentBracket;
    }
    if (v.groupAFinalResult && Number.isInteger(v.groupAFinalResult.homeScore) && v.groupAFinalResult.homeScore >= 0 && Number.isInteger(v.groupAFinalResult.awayScore) && v.groupAFinalResult.awayScore >= 0) {
      out.groupAFinalResult = { homeScore:v.groupAFinalResult.homeScore, awayScore:v.groupAFinalResult.awayScore };
    }
    // 토너먼트 결과는 경로·순서·점수까지 도메인이 다시 검사한다. 통과한 앞부분만 남는다.
    out.knockoutResults = out.groupAFinalResult ? normalizeKnockoutResults(v.knockoutResults) : [];
    if (Number.isInteger(v.matchAttempt) && v.matchAttempt >= 0) out.matchAttempt = v.matchAttempt;
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
