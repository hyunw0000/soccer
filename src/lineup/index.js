/**
 * lineup 영역의 유일한 공개 표면 (담당자 3).
 * 다른 영역은 이 파일만 import한다. 내부 파일은 계약이 아니다.
 */

export {
  FORMATIONS,
  FORMATION_KEYS,
  LINEUP_SIZE,
  COORD_MIN,
  COORD_MAX,
  getFormation,
  getNormalizedSlots,
  getSlot,
  positionNeeds,
  resolveFormationId,
} from './formations.js';

export {
  createLookup,
  createStartingLineup,
  autoLineup,
  applyPositions,
  capturePositions,
  assignPlayer,
  swapAssignments,
  moveAssignment,
  resetPositions,
  hasCustomPositions,
  changeFormation,
  syncSubstitutes,
  setCaptain,
  startingPlayerIds,
  getAssignment,
  isComplete,
} from './domain/lineup.js';

export { validateStartingLineup, formatErrors } from './domain/validation.js';
export {
  ROLES,
  ROLE_LABEL,
  ROLE_ZONES,
  isRole,
  positionLabel,
  roleAtX,
  roleFits,
  roleFitScore,
} from './domain/roles.js';

export { createLineupEditor } from './screens/lineupEditor.js';
export { default as lineupScreen } from './screens/lineup.js';
