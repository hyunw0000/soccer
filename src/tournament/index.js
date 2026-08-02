/**
 * tournament 영역의 공개 표면 (담당자 2).
 *
 * 기존 상대 스카우팅 API와 2026 토너먼트 공개 API를 함께 제공한다.
 */

import { autoLineup, setCaptain } from '../lineup/index.js';
import { TACTIC_DEFAULT } from '../tactics/index.js';
import { WORLD_XI_PLAYERS, WORLD_XI_TEAM } from './data/opponents.js';

/** 상대 선수 목록 (Player 형식). 화면이 스카우팅 정보를 표시할 때 쓴다. */
export const opponentPlayers = () => WORLD_XI_PLAYERS;

/**
 * 다음 상대를 만든다. Contracts v1의 `Opponent` 형식이며 전부 plain JSON이다.
 * bracket이 없으면(=대진표 미구현) 고정 상대를 돌려준다.
 *
 * @param {object|null} [bracket] AppState의 TournamentBracket
 * @returns {object} Opponent
 */
export function getNextOpponent(bracket = null) {
  const ids = WORLD_XI_PLAYERS.map((p) => p.id);
  const captainId = ids[0];
  const lineup = setCaptain(
    autoLineup(ids, WORLD_XI_TEAM.formationId, WORLD_XI_PLAYERS, { captainId }),
    captainId
  );

  return {
    ...WORLD_XI_TEAM,
    players: WORLD_XI_PLAYERS.map((p) => ({
      id: p.id,
      num: p.num,
      name: p.name,
      pace: p.stats.pace,
      stamina: p.stats.stamina,
    })),
    lineup,
    tactics: { ...TACTIC_DEFAULT },
  };
}

export { countries, countryByFifaCode } from '../shared/index.js';
export { roundOf32Matches, knockoutRoundTemplates, qualificationRules, tournamentRounds } from './data/bracket.js';
export {
  QUALIFICATION_STATUSES,
  applyKoreaQualification,
  createInitialBracket,
  getCurrentRound,
  getTournamentNextOpponent,
  recordMatchResult,
  validateBracket,
} from './domain/bracket.js';
export { default as tournamentScreen } from './screens/tournament.js';
