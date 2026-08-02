/**
 * MatchSetup version 1 생성 — 경기 입력 계약의 조립 지점.
 *
 * 여기서 만들어진 값은 simulation이 그대로 받는 plain JSON이다.
 * simulation은 roster/lineup/tactics를 import하지 않으므로, 시작에 필요한
 * 모든 정보(선수 메타, 양 팀 assignment 좌표, 전술)를 값으로 복사해 넣는다.
 */

import { createLookup, validateStartingLineup } from '../../lineup/index.js';
import { normalizeTactics, validateTactics } from './tactics.js';
import { slotTacticsOf, toPlayerInstruction } from './playerTactics.js';

export const MATCH_SETUP_VERSION = 1;

/**
 * assignment에 실리는 선수별 지시 8축. 모두 0..1이고, 0.5가 "지시 없음"이다.
 * 값이 없는 assignment는 simulation이 이 기본값으로 읽으므로 버전은 그대로 1이다.
 */
export const INSTRUCTION_KEYS = Object.freeze([
  'forwardness',
  'width',
  'runs',
  'roaming',
  'pressing',
  'passLength',
  'risk',
  'coverage',
]);

export class MatchSetupError extends Error {
  constructor(errors) {
    super(errors.map((e) => e.message).join(' / ') || 'MatchSetup을 만들 수 없습니다.');
    this.name = 'MatchSetupError';
    this.errors = errors;
  }
}

/** RawPlayer/Player/SimulationPlayer 어느 형태로 들어와도 SimulationPlayer로 맞춘다. */
export function toSimulationPlayer(player) {
  return {
    id: player.id,
    num: Number(player.num) || 0,
    name: player.name,
    pace: Number(player.pace ?? player.stats?.pace) || 0,
    stamina: Number(player.stamina ?? player.stats?.stamina) || 0,
  };
}

/** 문자열에서 안정적인 32비트 seed를 만든다. 같은 경기면 항상 같은 값이 나온다. */
function seedFrom(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 계약에 실을 assignment 목록.
 * 자리별 전술이 있으면 감독이 만진 단계 값을 0..1로 번역해 함께 싣는다 —
 * simulation은 8축 단계 값을 모르고 이 0..1만 읽는다.
 *
 * @param {object} lineup
 * @param {Record<string, object>|null} [slotTactics] 자리(slotId) → 8축 단계 값
 */
function assignmentsForContract(lineup, slotTactics = null) {
  return lineup.assignments.map((a) => {
    const { playerId, slotId, role, x, z } = a;
    const out = { playerId, slotId, role, x, z };
    // 감독이 만진 적 없는 자리도 함께 싣는다. 안 실으면 simulation이 전 축 0.5로 읽어서,
    // 화면에는 골키퍼 전진성 1칸으로 보이는 선수가 경기에서는 3칸으로 뛴다 —
    // 감독이 본 값과 경기가 어긋나는 건 계약이 작아지는 것보다 훨씬 나쁘다.
    // `slotTacticsOf`는 저장값이 없으면 그 자리(역할·좌우 위치)의 기본값을 만들어 준다.
    if (playerId) out.instruction = toPlayerInstruction(slotTacticsOf(slotTactics, a));
    return out;
  });
}

/**
 * MatchSetup 입력을 검사한다. 화면은 이 결과로 킥오프 버튼을 켜고 끈다.
 * @returns {{ok: boolean, errors: Array<{code: string, message: string}>}}
 */
export function validateMatchSetupInput({
  selectedSquad,
  startingLineup,
  tactics,
  opponent,
  playerCatalog,
} = {}) {
  const errors = [];
  const push = (code, message) => errors.push({ code, message });

  if (!selectedSquad?.playerIds?.length) push('squad/missing', '출전 명단이 없습니다.');
  if (!startingLineup) push('lineup/missing', '선발 라인업이 없습니다.');

  if (startingLineup) {
    const lineupResult = validateStartingLineup(startingLineup, selectedSquad ?? null, playerCatalog ?? null);
    errors.push(...lineupResult.errors);
  }
  errors.push(...validateTactics(tactics).errors);

  if (!opponent) {
    push('opponent/missing', '상대가 아직 결정되지 않았습니다.');
  } else {
    if (!opponent.id) push('opponent/no-id', '상대 팀 id가 없습니다.');
    if (!Array.isArray(opponent.players) || opponent.players.length === 0) {
      push('opponent/no-players', '상대 팀 선수 정보가 없습니다.');
    }
    if (!opponent.lineup) {
      push('opponent/no-lineup', '상대 팀 라인업이 없습니다.');
    } else {
      const oppResult = validateStartingLineup(opponent.lineup);
      errors.push(
        ...oppResult.errors.map((e) => ({ ...e, code: `opponent:${e.code}`, message: `상대 ${e.message}` }))
      );
    }
    errors.push(
      ...validateTactics(opponent.tactics).errors.map((e) => ({
        ...e,
        code: `opponent:${e.code}`,
        message: `상대 ${e.message}`,
      }))
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 유효한 입력에서만 MatchSetup version 1을 만든다.
 *
 * @param {object} input
 * @param {object} input.selectedSquad roster의 SelectedSquad
 * @param {object} input.startingLineup lineup의 StartingLineup
 * @param {object} input.tactics Tactics (0..1)
 * @param {Record<string, object>} [input.slotTactics] 자리(slotId) → 개인 전술 8축 단계 값
 * @param {object} input.opponent tournament의 Opponent
 * @param {object} [input.tournamentRef] { tournamentId, roundId, bracketMatchId }
 * @param {*} input.playerCatalog roster의 findById 등 선수 조회기
 * @param {object} [input.team] 우리 팀 메타 { id, code }
 * @param {string} [input.matchId]
 * @param {number} [input.seed]
 * @throws {MatchSetupError} 입력이 유효하지 않으면 던진다.
 * @returns {object} MatchSetup
 */
export function createMatchSetup(input) {
  const {
    selectedSquad,
    startingLineup,
    tactics,
    slotTactics = null,
    opponent,
    tournamentRef = null,
    playerCatalog,
    team = { id: 'KOR', code: 'KOR' },
    matchId,
    seed,
  } = input ?? {};

  const validation = validateMatchSetupInput({
    selectedSquad,
    startingLineup,
    tactics,
    opponent,
    playerCatalog,
  });
  if (!validation.ok) throw new MatchSetupError(validation.errors);

  const lookup = createLookup(playerCatalog);
  const homePlayers = [...new Set(selectedSquad.playerIds)]
    .map(lookup)
    .filter(Boolean)
    .map(toSimulationPlayer);

  const resolvedMatchId =
    matchId ?? `${tournamentRef?.bracketMatchId ?? 'friendly'}:${team.id}-vs-${opponent.id}`;

  return {
    version: MATCH_SETUP_VERSION,
    matchId: resolvedMatchId,
    // seed는 matchId에서 파생해 같은 경기를 다시 열어도 결과가 재현되게 한다.
    seed: Number.isFinite(seed) ? seed : seedFrom(resolvedMatchId),
    homeTeam: {
      id: team.id,
      code: team.code ?? team.id,
      players: homePlayers,
      lineup: {
        formationId: startingLineup.formationId,
        assignments: assignmentsForContract(startingLineup, slotTactics),
        substituteIds: [...(startingLineup.substituteIds ?? [])],
        captainId: startingLineup.captainId ?? null,
        goalkeeperId: startingLineup.goalkeeperId ?? null,
      },
      tactics: normalizeTactics(tactics),
    },
    awayTeam: {
      id: opponent.id,
      code: opponent.code ?? opponent.id,
      players: opponent.players.map(toSimulationPlayer),
      lineup: {
        formationId: opponent.lineup.formationId,
        assignments: assignmentsForContract(opponent.lineup),
        substituteIds: [...(opponent.lineup.substituteIds ?? [])],
        captainId: opponent.lineup.captainId ?? null,
        goalkeeperId: opponent.lineup.goalkeeperId ?? null,
      },
      tactics: normalizeTactics(opponent.tactics),
    },
    tournament: tournamentRef
      ? {
          tournamentId: tournamentRef.tournamentId ?? null,
          roundId: tournamentRef.roundId ?? null,
          bracketMatchId: tournamentRef.bracketMatchId ?? null,
        }
      : null,
  };
}

/**
 * 이미 만들어진 MatchSetup을 계약 기준으로 다시 검사한다.
 * 저장값 복원과 담당자 4 경계 테스트에서 쓴다.
 */
export function validateMatchSetup(matchSetup) {
  const errors = [];
  const push = (code, message) => errors.push({ code, message });

  if (!matchSetup || typeof matchSetup !== 'object') {
    push('setup/missing', 'MatchSetup이 없습니다.');
    return { ok: false, errors };
  }
  if (matchSetup.version !== MATCH_SETUP_VERSION) {
    push('setup/version', `지원하지 않는 MatchSetup 버전입니다: ${matchSetup.version}`);
  }
  if (!matchSetup.matchId) push('setup/no-match-id', 'matchId가 없습니다.');
  if (!Number.isFinite(matchSetup.seed)) push('setup/seed', 'seed가 숫자가 아닙니다.');

  for (const side of ['homeTeam', 'awayTeam']) {
    const team = matchSetup[side];
    if (!team) {
      push(`${side}/missing`, `${side}가 없습니다.`);
      continue;
    }
    if (!team.id) push(`${side}/no-id`, `${side}.id가 없습니다.`);
    if (!Array.isArray(team.players) || team.players.length === 0) {
      push(`${side}/no-players`, `${side}.players가 비어 있습니다.`);
    }
    errors.push(
      ...validateStartingLineup(team.lineup).errors.map((e) => ({
        ...e,
        code: `${side}:${e.code}`,
        message: `${side} ${e.message}`,
      }))
    );
    errors.push(
      ...validateTactics(team.tactics).errors.map((e) => ({
        ...e,
        code: `${side}:${e.code}`,
        message: `${side} ${e.message}`,
      }))
    );

    // 배치된 선수가 players 목록에 없으면 simulation이 메타를 찾을 수 없다.
    const known = new Set((team.players ?? []).map((p) => p.id));
    for (const a of team.lineup?.assignments ?? []) {
      if (a.playerId && !known.has(a.playerId)) {
        push(`${side}/player-meta`, `${side} 배치 선수의 메타가 없습니다: ${a.playerId}`);
      }
      // 선수별 지시는 없어도 되지만, 있다면 계약대로 0..1이어야 한다.
      if (a.instruction === undefined || a.instruction === null) continue;
      for (const key of INSTRUCTION_KEYS) {
        const v = a.instruction[key];
        if (!Number.isFinite(v) || v < 0 || v > 1) {
          push(`${side}/instruction`, `${side} 선수별 지시 ${key}가 0..1이 아닙니다: ${a.playerId}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
