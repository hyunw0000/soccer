import { knockoutRoundTemplates, roundOf32Matches, tournamentRounds } from '../data/bracket.js';

export const QUALIFICATION_STATUSES = Object.freeze(['pending', 'qualified', 'eliminated']);

const copyMatch = (match) => ({ ...match, score: match.score ? { ...match.score } : null });
const registeredTeamIds = new Set(roundOf32Matches.flatMap(({ homeTeamId, awayTeamId, originalHomeTeamId }) => [homeTeamId, awayTeamId, originalHomeTeamId].filter(Boolean)));

export function createInitialBracket({ qualificationStatus = 'pending' } = {}) {
  if (!QUALIFICATION_STATUSES.includes(qualificationStatus)) {
    throw new TypeError(`알 수 없는 진출 상태: ${qualificationStatus}`);
  }

  const firstRound = roundOf32Matches.map((match) => {
    const isHistoryMatch = match.matchId === 73;
    const koreaQualified = qualificationStatus === 'qualified';
    return {
      ...match,
      roundId: 'roundOf32',
      homeTeamId: isHistoryMatch && !koreaQualified ? match.originalHomeTeamId : match.homeTeamId,
      status: isHistoryMatch && qualificationStatus === 'pending' ? 'locked' : 'scheduled',
      score: null,
      winnerTeamId: null,
      sourceMatchIds: null,
      historyChanged: isHistoryMatch && koreaQualified,
    };
  });
  const laterRounds = knockoutRoundTemplates.flatMap(({ roundId, matches }) => matches.map((match) => ({
    ...match,
    roundId,
    homeTeamId: null,
    awayTeamId: null,
    status: 'pending',
    score: null,
    winnerTeamId: null,
    historyChanged: false,
  })));

  return {
    version: 1,
    tournamentId: 'world-championship-2026',
    qualificationStatus,
    matches: [...firstRound, ...laterRounds],
  };
}

export function applyKoreaQualification(bracket, qualificationStatus) {
  if (!QUALIFICATION_STATUSES.includes(qualificationStatus)) throw new TypeError('유효하지 않은 진출 상태입니다.');
  const match73 = bracket?.matches?.find(({ matchId }) => matchId === 73);
  if (match73?.status === 'completed') throw new Error('완료된 Match 73의 진출 상태는 바꿀 수 없습니다.');
  return createInitialBracket({ qualificationStatus });
}

export function validateBracket(bracket) {
  const errors = [];
  if (!bracket || bracket.version !== 1 || !Array.isArray(bracket.matches)) return { valid: false, errors: ['TournamentBracket version 1이 아닙니다.'] };
  const ids = bracket.matches.map(({ matchId }) => matchId);
  const uniqueIds = new Set(ids);
  if (ids.length !== 31 || uniqueIds.size !== 31) errors.push('토너먼트는 중복 없는 31경기여야 합니다.');
  for (const match of bracket.matches) {
    if (match.homeTeamId && !registeredTeamIds.has(match.homeTeamId)) errors.push(`Match ${match.matchId}: 알 수 없는 홈팀입니다.`);
    if (match.awayTeamId && !registeredTeamIds.has(match.awayTeamId)) errors.push(`Match ${match.matchId}: 알 수 없는 원정팀입니다.`);
    if (match.nextMatchId != null && !uniqueIds.has(match.nextMatchId)) errors.push(`Match ${match.matchId}: 다음 경기 ${match.nextMatchId}가 없습니다.`);
    if (match.nextMatchId != null) {
      const target = bracket.matches.find(({ matchId }) => matchId === match.nextMatchId);
      if (target && !target.sourceMatchIds?.includes(match.matchId)) errors.push(`Match ${match.matchId}: 다음 경기 연결이 서로 일치하지 않습니다.`);
    }
    if (match.sourceMatchIds) {
      for (const sourceId of match.sourceMatchIds) {
        const source = bracket.matches.find(({ matchId }) => matchId === sourceId);
        if (!source || source.nextMatchId !== match.matchId) errors.push(`Match ${match.matchId}: 이전 경기 ${sourceId} 연결이 올바르지 않습니다.`);
      }
    }
    if (match.winnerTeamId && ![match.homeTeamId, match.awayTeamId].includes(match.winnerTeamId)) errors.push(`Match ${match.matchId}: 승자가 참가팀이 아닙니다.`);
  }
  for (const round of tournamentRounds) {
    if (round.matchIds.some((id) => !uniqueIds.has(id))) errors.push(`${round.label} 경기 구성이 불완전합니다.`);
  }
  return { valid: errors.length === 0, errors };
}

export function recordMatchResult(bracket, result) {
  const validation = validateBracket(bracket);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const index = bracket.matches.findIndex(({ matchId }) => matchId === result?.matchId);
  if (index < 0) throw new Error('존재하지 않는 경기입니다.');
  const current = bracket.matches[index];
  if (current.status === 'completed') throw new Error('완료된 경기 결과는 다시 기록할 수 없습니다.');
  if (!current.homeTeamId || !current.awayTeamId || current.status === 'locked') throw new Error('아직 진행할 수 없는 경기입니다.');
  if (![current.homeTeamId, current.awayTeamId].includes(result.winnerTeamId)) throw new Error('승자는 경기 참가팀이어야 합니다.');
  const home = Number(result.homeScore);
  const away = Number(result.awayScore);
  if (!Number.isInteger(home) || home < 0 || !Number.isInteger(away) || away < 0) throw new Error('점수는 0 이상의 정수여야 합니다.');

  const matches = bracket.matches.map(copyMatch);
  matches[index] = { ...matches[index], status: 'completed', score: { home, away }, winnerTeamId: result.winnerTeamId };
  if (current.nextMatchId != null) {
    const targetIndex = matches.findIndex(({ matchId }) => matchId === current.nextMatchId);
    const target = matches[targetIndex];
    const slot = target.sourceMatchIds.indexOf(current.matchId);
    matches[targetIndex] = {
      ...target,
      [slot === 0 ? 'homeTeamId' : 'awayTeamId']: result.winnerTeamId,
      status: (slot === 0 ? target.awayTeamId : target.homeTeamId) ? 'scheduled' : 'pending',
      historyChanged: target.historyChanged || result.winnerTeamId === 'KOR',
    };
  }
  return { ...bracket, matches };
}

export function getCurrentRound(bracket) {
  return tournamentRounds.find((round) => round.matchIds.some((id) => bracket.matches.find((match) => match.matchId === id)?.status !== 'completed')) ?? tournamentRounds.at(-1);
}

export function getTournamentNextOpponent(bracket, teamId) {
  const match = bracket?.matches?.find(({ status, homeTeamId, awayTeamId }) => status !== 'completed' && [homeTeamId, awayTeamId].includes(teamId));
  if (!match) return null;
  return match.homeTeamId === teamId ? match.awayTeamId : match.homeTeamId;
}
