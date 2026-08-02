/**
 * simulation의 공개 표면 (담당자 4).
 * 입력은 plain JSON MatchSetup 하나뿐이며 roster/lineup/tactics를 import하지 않는다.
 */

export { FIELD, HALF, GOAL_W, GOAL_H, PENALTY_AREA, PARAMS } from './params.js';
export { normalizedToWorld, normalizeInstruction, INSTRUCTION_FALLBACK } from './coordinates.js';
export { Sim, validateMatchSetupForSim } from './sim.js';
export { RewindBuffer } from './rewind.js';

import { Sim } from './sim.js';

/**
 * MatchSetup으로 경기를 만든다. 입력이 유효하지 않으면 오류를 던진다.
 * @param {object} matchSetup MatchSetup version 1
 * @param {object} [rules] 대회 규칙 — `{ extraTime, shootout }`. 32강부터의 토너먼트처럼
 *   무승부로 끝날 수 없는 경기에서만 켠다. 기본값은 둘 다 false(90분에 무승부로 종료).
 */
export function createSimulation(matchSetup, rules) {
  return new Sim(matchSetup, rules);
}
