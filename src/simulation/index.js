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
 */
export function createSimulation(matchSetup) {
  return new Sim(matchSetup);
}
