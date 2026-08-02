/**
 * tournament 영역의 공개 표면 (담당자 2).
 *
 * 기존 상대 스카우팅 API와 2026 토너먼트 공개 API를 함께 제공한다.
 */

import { createStartingLineup, getNormalizedSlots, setCaptain, syncSubstitutes } from '../lineup/index.js';
import { TACTIC_DEFAULT } from '../tactics/index.js';
import { FIRST_OPPONENT, OPPONENT_TEAMS, findTeam } from './data/opponents.js';

export { OPPONENT_TEAMS } from './data/opponents.js';

/** 대회에서 만나는 순서대로의 상대 목록. 화면이 스카우팅 정보를 그릴 때 쓴다. */
export const opponentPath = () => OPPONENT_TEAMS;

/**
 * 스테이지 id 또는 팀 코드로 상대 팀을 찾는다.
 * @param {string} [stageOrCode] 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final' | 'CZE' ...
 * @returns {object} 못 찾으면 첫 경기 상대
 */
export function getOpponentTeam(stageOrCode) {
  return findTeam(stageOrCode) ?? FIRST_OPPONENT;
}

/** 상대 선수 목록 (Player 형식). 화면이 스카우팅 정보를 표시할 때 쓴다. */
export const opponentPlayers = (stageOrCode) => getOpponentTeam(stageOrCode).players;

/**
 * 팀 데이터의 startingXI를 그 팀 포메이션의 슬롯에 순서대로 세운다.
 * 슬롯 배열은 GK → DF → MF → FW 순서가 계약이므로 명단도 같은 순서로 적어 둔다.
 * 좌표는 lineup의 포메이션 정의가 정한다 — 여기서 배치를 복제하지 않는다.
 *
 * @param {object} team OPPONENT_TEAMS의 한 팀
 * @returns {object} StartingLineup
 */
export function buildOpponentLineup(team) {
  const slots = getNormalizedSlots(team.formationId);
  const lineup = createStartingLineup({
    formationId: team.formationId,
    assignments: slots.map((slot, i) => ({ slotId: slot.slotId, playerId: team.startingXI[i] ?? null })),
    captainId: team.captainId,
  });
  // 선발로 서지 않은 나머지가 교체 명단이 된다.
  return setCaptain(
    syncSubstitutes(
      lineup,
      team.players.map((p) => p.id)
    ),
    team.captainId
  );
}

/**
 * 지금 치를 상대를 고른다. 스테이지 id 문자열도, `{ stage }`를 가진 객체(대진표)도 받는다.
 * 대진표가 아직 없으면 조별리그 첫 상대다.
 */
function resolveTeam(source) {
  if (!source) return FIRST_OPPONENT;
  if (typeof source === 'string') return getOpponentTeam(source);
  return getOpponentTeam(source.stage ?? source.currentStage ?? null);
}

/**
 * 다음 상대를 만든다. Contracts v1의 `Opponent` 형식이며 전부 plain JSON이다.
 * 대진표가 없으면(=미구현) 조별리그 첫 상대를 돌려준다.
 *
 * @param {object|string|null} [bracket] AppState의 TournamentBracket 또는 스테이지 id
 * @returns {object} Opponent
 */
export function getNextOpponent(bracket = null) {
  const team = resolveTeam(bracket);

  return {
    id: team.id,
    name: team.name,
    code: team.code,
    stage: team.stage,
    stageLabel: team.stageLabel,
    coach: team.coach,
    formationId: team.formationId,
    style: team.style,
    strength: team.strength,
    players: team.players.map((p) => ({
      id: p.id,
      num: p.num,
      name: p.name,
      pace: p.stats.pace,
      stamina: p.stats.stamina,
    })),
    lineup: buildOpponentLineup(team),
    tactics: { ...TACTIC_DEFAULT },
  };
}

export { countries, countryByFifaCode } from '../shared/index.js';
export { bracketLayout, officialTournamentMatches, roundOf32Matches, knockoutRoundTemplates, qualificationRules, tournamentRounds } from './data/bracket.js';
export { GROUP_A_TEAM_IDS, groupACompletedMatches, koreaSouthAfricaMatch } from './data/groupA.js';
export { calculateGroupStandings, createGroupAState, createTournamentProgress, getMatchesForTeam, normalizeGroupAFinalResult, resolveKoreaQualification } from './domain/groupStandings.js';
export {
  QUALIFICATION_STATUSES,
  applyKoreaQualification,
  createInitialBracket,
  createOfficialBracket,
  createGameTimelineBracket,
  getCurrentRound,
  getTournamentNextOpponent,
  recordMatchResult,
  resolveMatch73HomeTeam,
  validateBracket,
} from './domain/bracket.js';
export { default as tournamentScreen } from './screens/tournament.js';
