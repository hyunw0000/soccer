/**
 * tactics 영역의 유일한 공개 표면 (담당자 3).
 * 다른 영역은 이 파일만 import한다. 내부 파일은 계약이 아니다.
 */

export { TACTIC_DEFAULT, createDefaultTactics } from './defaults.js';
export { TACTIC_KEYS, TACTIC_META, normalizeTactics, validateTactics } from './domain/tactics.js';
// 전술 프리셋(수비 스타일·폭·깊이 …)은 감독이 만지는 표현 계층이며,
// 계약 값인 전술 네 개는 항상 toTactics()로 파생시킨다.
export {
  BUILD_UP_STYLES,
  CHANCE_STYLES,
  DEFENSE_STYLES,
  MENTALITIES,
  PRESET_COUNT,
  PRESET_LIBRARY,
  TACTIC_FIELDS,
  createPreset,
  normalizePreset,
  toTactics,
} from './domain/presets.js';
// 자리별 전술 8축. 팀 전술과 같은 원칙 — 감독이 만지는 단계 값이고 계약 값은 파생시킨다.
export {
  PLAYER_TACTIC_FIELDS,
  PLAYER_TACTIC_MAX,
  createPlayerTactics,
  isDefaultPlayerTactics,
  normalizePlayerTactics,
  playerTacticGroup,
  playerTacticGroupOf,
  slotTacticsOf,
  setPlayerField,
  stepPlayerField,
  toPlayerInstruction,
} from './domain/playerTactics.js';
export {
  INSTRUCTION_KEYS,
  MATCH_SETUP_VERSION,
  MatchSetupError,
  createMatchSetup,
  validateMatchSetupInput,
  validateMatchSetup,
  toSimulationPlayer,
} from './domain/matchSetup.js';

export { default as tacticsScreen } from './screens/tactics.js';
// 경기 중에 여는 전술 조작판. 경기 화면이 전술 화면으로 나갔다 오지 않아도 되도록,
// 같은 전술 목록을 그대로 쓰는 패널을 tactics가 만들어서 넘겨준다.
export { createLiveTacticsPanel } from './screens/liveTactics.js';
