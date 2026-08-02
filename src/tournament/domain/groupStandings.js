import { GROUP_A_TEAM_IDS, groupACompletedMatches, koreaSouthAfricaMatch } from '../data/groupA.js';
import { createGameTimelineBracket } from './bracket.js';

const emptyRow = (teamId, seed) => ({ teamId, seed, played:0, points:0, won:0, drawn:0, lost:0, goalsFor:0, goalsAgainst:0, goalDifference:0 });

export function normalizeGroupAFinalResult(result) {
  if (result == null) return null;
  const homeScore = Number(result.homeScore);
  const awayScore = Number(result.awayScore);
  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) throw new TypeError('남아공전 점수는 0 이상의 정수여야 합니다.');
  return { ...koreaSouthAfricaMatch, homeScore, awayScore, status:'completed', source:'GAME_RESULT' };
}

export function calculateGroupStandings(matches, teamIds = GROUP_A_TEAM_IDS) {
  const table = new Map(teamIds.map((teamId, seed) => [teamId, emptyRow(teamId, seed)]));
  const teamsWithRemainingMatch = new Set(matches.filter(({status}) => status !== 'completed').flatMap(({homeTeamId,awayTeamId}) => [homeTeamId,awayTeamId]));
  for (const match of matches) {
    if (match.status !== 'completed') continue;
    const home = table.get(match.homeTeamId);
    const away = table.get(match.awayTeamId);
    if (!home || !away || !Number.isInteger(match.homeScore) || !Number.isInteger(match.awayScore)) continue;
    home.played++; away.played++;
    home.goalsFor += match.homeScore; home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore; away.goalsAgainst += match.homeScore;
    if (match.homeScore > match.awayScore) { home.won++; home.points += 3; away.lost++; }
    else if (match.homeScore < match.awayScore) { away.won++; away.points += 3; home.lost++; }
    else { home.drawn++; away.drawn++; home.points++; away.points++; }
  }
  return [...table.values()]
    .map((row) => ({ ...row, goalDifference:row.goalsFor-row.goalsAgainst }))
    // 최종전 직전의 임시 표에서는 같은 승점이면 일정을 마친 팀을 먼저 둔다.
    // 모든 경기가 끝나면 이 항목은 전부 같아져 승점 → 득실차 → 다득점만 적용된다.
    .sort((a,b) => b.points-a.points || Number(teamsWithRemainingMatch.has(a.teamId))-Number(teamsWithRemainingMatch.has(b.teamId)) || b.goalDifference-a.goalDifference || b.goalsFor-a.goalsFor || a.seed-b.seed)
    .map(({seed,...row},index) => ({position:index+1,...row}));
}

/** FIFA 3자리 팀 ID로 해당 팀의 조별리그 경기만 조회한다. */
export function getMatchesForTeam(matches, teamId) {
  return matches.filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId);
}

/**
 * 이 게임의 진출 규칙: 남아공전을 **이겨야만** 32강에 오른다.
 * 승점만 보면 무승부로도 2위를 지키지만, 감독에게 주어진 조건은 승리 하나뿐이다 —
 * 무승부와 패배는 똑같이 탈락이다.
 */
export function resolveKoreaQualification(standings, finalResult = null) {
  if (!finalResult) return 'pending';
  const koreaScore = finalResult.awayTeamId === 'KOR' ? finalResult.awayScore : finalResult.homeScore;
  const opponentScore = finalResult.awayTeamId === 'KOR' ? finalResult.homeScore : finalResult.awayScore;
  if (!(koreaScore > opponentScore)) return 'eliminated';
  return standings.find(({teamId}) => teamId === 'KOR')?.position === 2 ? 'qualified' : 'eliminated';
}

export function createGroupAState(finalResult = null) {
  const finalMatch = normalizeGroupAFinalResult(finalResult);
  const matches = finalMatch ? [...groupACompletedMatches,finalMatch] : [...groupACompletedMatches,koreaSouthAfricaMatch];
  const standings = calculateGroupStandings(matches);
  return { matches, standings, finalMatch:finalMatch ?? koreaSouthAfricaMatch, qualificationStatus:resolveKoreaQualification(standings,finalMatch) };
}

/** 경기 종료 저장값 하나로 조별리그 표와 Match 73 시간선을 함께 파생한다. */
export function createTournamentProgress(finalResult = null) {
  const group = createGroupAState(finalResult);
  return { group, bracket:createGameTimelineBracket({qualificationStatus:group.qualificationStatus}) };
}
