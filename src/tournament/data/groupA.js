const completed = (matchId, homeTeamId, awayTeamId, homeScore, awayScore) => Object.freeze({
  matchId, group:'A', homeTeamId, awayTeamId, homeScore, awayScore,
  status:'completed', source:'FIFA_OFFICIAL_2026',
});

/** FIFA 공식 경기 결과 원본. */
export const groupACompletedMatches = Object.freeze([
  completed(1,'MEX','RSA',2,0),
  completed(2,'KOR','CZE',2,1),
  completed(25,'CZE','RSA',1,1),
  completed(28,'MEX','KOR',1,0),
  completed(53,'CZE','MEX',0,3),
]);

export const koreaSouthAfricaMatch = Object.freeze({
  matchId:54, group:'A', homeTeamId:'RSA', awayTeamId:'KOR',
  homeScore:null, awayScore:null, status:'scheduled', source:'GAME_TIMELINE',
});

export const GROUP_A_TEAM_IDS = Object.freeze(['MEX','KOR','CZE','RSA']);
