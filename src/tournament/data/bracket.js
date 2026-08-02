/** 승인된 2026 대회 32강 원본 데이터. 팀 id는 FIFA 3자리 코드다. */
export const roundOf32Matches = Object.freeze([
  Object.freeze({ matchId: 73, homeTeamId: 'KOR', awayTeamId: 'CAN', originalHomeTeamId: 'RSA', replacementReason: '대한민국이 남아공을 대신해 A조 2위로 진출', nextMatchId: 90 }),
  Object.freeze({ matchId: 74, homeTeamId: 'GER', awayTeamId: 'PAR', nextMatchId: 89 }),
  Object.freeze({ matchId: 75, homeTeamId: 'NED', awayTeamId: 'MAR', nextMatchId: 90 }),
  Object.freeze({ matchId: 76, homeTeamId: 'BRA', awayTeamId: 'JPN', nextMatchId: 91 }),
  Object.freeze({ matchId: 77, homeTeamId: 'FRA', awayTeamId: 'SWE', nextMatchId: 89 }),
  Object.freeze({ matchId: 78, homeTeamId: 'CIV', awayTeamId: 'NOR', nextMatchId: 91 }),
  Object.freeze({ matchId: 79, homeTeamId: 'MEX', awayTeamId: 'ECU', nextMatchId: 92 }),
  Object.freeze({ matchId: 80, homeTeamId: 'ENG', awayTeamId: 'COD', nextMatchId: 92 }),
  Object.freeze({ matchId: 81, homeTeamId: 'USA', awayTeamId: 'BIH', nextMatchId: 94 }),
  Object.freeze({ matchId: 82, homeTeamId: 'BEL', awayTeamId: 'SEN', nextMatchId: 94 }),
  Object.freeze({ matchId: 83, homeTeamId: 'POR', awayTeamId: 'CRO', nextMatchId: 93 }),
  Object.freeze({ matchId: 84, homeTeamId: 'ESP', awayTeamId: 'AUT', nextMatchId: 93 }),
  Object.freeze({ matchId: 85, homeTeamId: 'SUI', awayTeamId: 'ALG', nextMatchId: 96 }),
  Object.freeze({ matchId: 86, homeTeamId: 'ARG', awayTeamId: 'CPV', nextMatchId: 95 }),
  Object.freeze({ matchId: 87, homeTeamId: 'COL', awayTeamId: 'GHA', nextMatchId: 96 }),
  Object.freeze({ matchId: 88, homeTeamId: 'AUS', awayTeamId: 'EGY', nextMatchId: 95 }),
]);

export const knockoutRoundTemplates = Object.freeze([
  Object.freeze({ roundId: 'roundOf16', label: '16강', matches: Object.freeze([
    Object.freeze({ matchId: 89, sourceMatchIds: [74, 77], nextMatchId: 97 }),
    Object.freeze({ matchId: 90, sourceMatchIds: [73, 75], nextMatchId: 97 }),
    Object.freeze({ matchId: 91, sourceMatchIds: [76, 78], nextMatchId: 98 }),
    Object.freeze({ matchId: 92, sourceMatchIds: [79, 80], nextMatchId: 98 }),
    Object.freeze({ matchId: 93, sourceMatchIds: [83, 84], nextMatchId: 99 }),
    Object.freeze({ matchId: 94, sourceMatchIds: [81, 82], nextMatchId: 99 }),
    Object.freeze({ matchId: 95, sourceMatchIds: [86, 88], nextMatchId: 100 }),
    Object.freeze({ matchId: 96, sourceMatchIds: [85, 87], nextMatchId: 100 }),
  ]) }),
  Object.freeze({ roundId: 'quarterFinal', label: '8강', matches: Object.freeze([
    Object.freeze({ matchId: 97, sourceMatchIds: [89, 90], nextMatchId: 101 }),
    Object.freeze({ matchId: 98, sourceMatchIds: [91, 92], nextMatchId: 101 }),
    Object.freeze({ matchId: 99, sourceMatchIds: [93, 94], nextMatchId: 102 }),
    Object.freeze({ matchId: 100, sourceMatchIds: [95, 96], nextMatchId: 102 }),
  ]) }),
  Object.freeze({ roundId: 'semiFinal', label: '준결승', matches: Object.freeze([
    Object.freeze({ matchId: 101, sourceMatchIds: [97, 98], nextMatchId: 104 }),
    Object.freeze({ matchId: 102, sourceMatchIds: [99, 100], nextMatchId: 104 }),
  ]) }),
  Object.freeze({ roundId: 'final', label: '결승', matches: Object.freeze([
    Object.freeze({ matchId: 104, sourceMatchIds: [101, 102], nextMatchId: null }),
  ]) }),
]);

/** 정확한 승점 조건은 경기 규칙 담당 영역에서 주입한다. UI가 임의 판정하지 않는다. */
export const qualificationRules = Object.freeze({
  southAfricaGroupFinal: Object.freeze({
    matchType: 'group-stage',
    matchday: 3,
    koreaTeamId: 'KOR',
    opponentTeamId: 'RSA',
    replacementMatchId: 73,
    replacedTeamId: 'RSA',
    status: 'awaiting-approved-condition',
  }),
});

export const tournamentRounds = Object.freeze([
  Object.freeze({ roundId: 'roundOf32', label: '32강', matchIds: Object.freeze(roundOf32Matches.map(({ matchId }) => matchId)) }),
  ...knockoutRoundTemplates.map(({ roundId, label, matches }) => Object.freeze({ roundId, label, matchIds: Object.freeze(matches.map(({ matchId }) => matchId)) })),
]);
