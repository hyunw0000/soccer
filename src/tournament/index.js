/**
 * tournament 영역의 공개 표면 (담당자 2).
 *
 * 대진표(bracket)는 제품 정책 승인 후에 구현한다. 지금은 계약상 반드시 필요한
 * `Opponent` 하나만 제공해 lineup/tactics가 MatchSetup을 만들 수 있게 한다.
 * bracket이 생기면 `getNextOpponent()`가 현재 라운드의 상대를 돌려주도록 바뀐다.
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
