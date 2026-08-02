import { createGameTimelineBracket, recordMatchResult } from './bracket.js';
import { createGroupAState } from './groupStandings.js';

/**
 * 감독이 실제로 치르는 경기의 진행 상태.
 *
 * 조별리그 최종전은 승리 또는 무승부 시 진출하고, 토너먼트는 승리해야 다음 라운드가 열린다.
 * 탈락한 경기는 언제든 다시 치를 수 있다.
 *
 * 저장되는 값은 두 개뿐이고(`groupAFinalResult`, `knockoutResults`) 나머지는 전부
 * 여기서 파생한다 — 대진표, 조 순위, 다음 상대, 탈락 여부가 한 곳에서만 결정된다.
 */

export const GROUP_FINAL_MATCH_ID = 54;

/** 대한민국이 밟는 경로. 배열 순서가 곧 진행 순서다. */
export const KOREA_RUN = Object.freeze([
  { matchId: 54, stage: 'group', roundId: 'groupA', roundLabel: '조별리그 최종전', eyebrow: 'GROUP A · MATCH 54', opponentTeamId: 'RSA', koreaSide: 'away', advanceLabel: '32강' },
  { matchId: 73, stage: 'r32', roundId: 'roundOf32', roundLabel: '32강', eyebrow: 'ROUND OF 32 · MATCH 73', opponentTeamId: 'CAN', koreaSide: 'home', advanceLabel: '16강' },
  { matchId: 90, stage: 'r16', roundId: 'roundOf16', roundLabel: '16강', eyebrow: 'ROUND OF 16 · MATCH 90', opponentTeamId: 'MAR', koreaSide: 'home', advanceLabel: '8강' },
  { matchId: 97, stage: 'qf', roundId: 'quarterFinal', roundLabel: '8강', eyebrow: 'QUARTER-FINAL · MATCH 97', opponentTeamId: 'FRA', koreaSide: 'away', advanceLabel: '준결승' },
  { matchId: 101, stage: 'sf', roundId: 'semiFinal', roundLabel: '준결승', eyebrow: 'SEMI-FINAL · MATCH 101', opponentTeamId: 'ESP', koreaSide: 'home', advanceLabel: '결승' },
  { matchId: 104, stage: 'final', roundId: 'final', roundLabel: '결승', eyebrow: 'FINAL · MATCH 104', opponentTeamId: 'ARG', koreaSide: 'home', advanceLabel: '우승' },
].map(Object.freeze));

const KNOCKOUT_RUN = Object.freeze(KOREA_RUN.slice(1));

export const findRunStep = (matchId) => KOREA_RUN.find((step) => step.matchId === matchId) ?? null;
const runIndex = (matchId) => KOREA_RUN.findIndex((step) => step.matchId === matchId);

/** 우리 팀 관점의 경기 결과. 진출 여부는 조별리그와 토너먼트 규칙에 따라 별도로 판단한다. */
export const outcomeOf = (koreaScore, opponentScore) =>
  koreaScore > opponentScore ? 'win' : koreaScore === opponentScore ? 'draw' : 'loss';

/** 저장값을 믿지 않는다: 경로에 있는 경기의 0 이상 정수 점수만 진행 순서대로 남긴다. */
export function normalizeKnockoutResults(results) {
  if (!Array.isArray(results)) return [];
  const kept = [];
  for (const step of KNOCKOUT_RUN) {
    const found = results.find((r) => r?.matchId === step.matchId);
    if (!found) break; // 중간이 비면 그 뒤는 진행된 적이 없는 결과다
    const koreaScore = Number(found.koreaScore);
    const opponentScore = Number(found.opponentScore);
    if (!Number.isInteger(koreaScore) || koreaScore < 0 || !Number.isInteger(opponentScore) || opponentScore < 0) break;
    kept.push({ matchId: step.matchId, koreaScore, opponentScore });
    if (outcomeOf(koreaScore, opponentScore) !== 'win') break; // 탈락 뒤의 경기는 없다
  }
  return kept;
}

/**
 * 저장값 두 개에서 지금 상황 전체를 만든다.
 *
 * @param {{groupAFinalResult?: {homeScore:number,awayScore:number}|null, knockoutResults?: Array}} [saved]
 * @returns {{group, bracket, qualificationStatus, played, lastPlayed, nextStep, activeStep, status}}
 *   status: 'playing' | 'eliminated' | 'champion'
 */
export function createGameProgress({ groupAFinalResult = null, knockoutResults = [] } = {}) {
  const group = createGroupAState(groupAFinalResult);
  const results = normalizeKnockoutResults(knockoutResults);
  const played = [];
  let status = 'playing';
  let bracket = createGameTimelineBracket({ qualificationStatus: group.qualificationStatus });

  if (groupAFinalResult) {
    // 남아공전은 우리가 원정(away)이다 — 저장값의 home이 남아공 점수다.
    const koreaScore = groupAFinalResult.awayScore;
    const opponentScore = groupAFinalResult.homeScore;
    played.push({ ...KOREA_RUN[0], koreaScore, opponentScore, outcome: outcomeOf(koreaScore, opponentScore) });
    if (group.qualificationStatus !== 'qualified') status = 'eliminated';
  }

  if (status === 'playing' && group.qualificationStatus === 'qualified') {
    for (const step of KNOCKOUT_RUN) {
      const result = results.find((r) => r.matchId === step.matchId);
      if (!result) break;
      const outcome = outcomeOf(result.koreaScore, result.opponentScore);
      const [homeScore, awayScore] = step.koreaSide === 'home'
        ? [result.koreaScore, result.opponentScore]
        : [result.opponentScore, result.koreaScore];
      bracket = recordMatchResult(bracket, {
        matchId: step.matchId,
        homeScore,
        awayScore,
        winnerTeamId: outcome === 'win' ? 'KOR' : step.opponentTeamId,
      });
      played.push({ ...step, koreaScore: result.koreaScore, opponentScore: result.opponentScore, outcome });
      if (outcome !== 'win') { status = 'eliminated'; break; }
      if (step.stage === 'final') { status = 'champion'; break; }
    }
  }

  const lastPlayed = played.at(-1) ?? null;
  // played는 항상 KOREA_RUN의 앞부분이므로 길이가 곧 다음 순서다.
  const nextStep = status === 'playing' ? (KOREA_RUN[played.length] ?? null) : null;

  return {
    group,
    bracket,
    qualificationStatus: group.qualificationStatus,
    played,
    lastPlayed,
    nextStep,
    // 화면이 "지금 다루는 경기". 탈락했으면 마지막으로 치른 경기(=다시 시도할 경기)다.
    activeStep: nextStep ?? lastPlayed,
    status,
  };
}

/**
 * 경기 결과 하나를 저장값에 반영한다. 이미 치른 경기를 다시 치르면
 * 그 뒤의 결과는 전부 사라진다 — 역사는 한 갈래만 남는다.
 */
export function applyKoreaMatchResult({ groupAFinalResult = null, knockoutResults = [] } = {}, result) {
  const step = findRunStep(result?.matchId);
  if (!step) throw new Error(`대한민국의 경기가 아닙니다: ${result?.matchId}`);
  const koreaScore = Number(result.koreaScore);
  const opponentScore = Number(result.opponentScore);
  if (!Number.isInteger(koreaScore) || koreaScore < 0 || !Number.isInteger(opponentScore) || opponentScore < 0) {
    throw new TypeError('경기 점수는 0 이상의 정수여야 합니다.');
  }
  if (step.matchId === GROUP_FINAL_MATCH_ID) {
    return { groupAFinalResult: { homeScore: opponentScore, awayScore: koreaScore }, knockoutResults: [] };
  }
  const before = new Set(KNOCKOUT_RUN.slice(0, runIndex(step.matchId) - 1).map((s) => s.matchId));
  const kept = normalizeKnockoutResults(knockoutResults).filter((r) => before.has(r.matchId));
  return { groupAFinalResult, knockoutResults: [...kept, { matchId: step.matchId, koreaScore, opponentScore }] };
}

/** 그 경기를 치르기 직전으로 되돌린다 — 다시 시도 버튼이 쓰는 값. */
export function clearKoreaMatchResult({ groupAFinalResult = null, knockoutResults = [] } = {}, matchId) {
  const step = findRunStep(matchId);
  if (!step) throw new Error(`대한민국의 경기가 아닙니다: ${matchId}`);
  if (step.matchId === GROUP_FINAL_MATCH_ID) return { groupAFinalResult: null, knockoutResults: [] };
  const before = new Set(KNOCKOUT_RUN.slice(0, runIndex(step.matchId) - 1).map((s) => s.matchId));
  return { groupAFinalResult, knockoutResults: normalizeKnockoutResults(knockoutResults).filter((r) => before.has(r.matchId)) };
}
