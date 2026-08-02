const official = (matchId, roundId, homeTeamId, awayTeamId, homeScore, awayScore, winnerTeamId, nextMatchId, extras = {}) => Object.freeze({
  matchId, roundId, homeTeamId, awayTeamId, homeScore, awayScore, winnerTeamId, nextMatchId,
  status: 'completed', resultType: 'REGULATION', source: 'FIFA_OFFICIAL_2026', ...extras,
});

/** FIFA 공식 2026 대회 결과 원본. 게임 시간선은 이 배열을 절대 변경하지 않는다. */
export const officialTournamentMatches = Object.freeze([
  official(73,'roundOf32','RSA','CAN',0,1,'CAN',90), official(74,'roundOf32','GER','PAR',1,1,'PAR',89,{resultType:'PENALTIES',homePenaltyScore:3,awayPenaltyScore:4}),
  official(75,'roundOf32','NED','MAR',1,1,'MAR',90,{resultType:'PENALTIES',homePenaltyScore:2,awayPenaltyScore:3}), official(76,'roundOf32','BRA','JPN',2,1,'BRA',91),
  official(77,'roundOf32','FRA','SWE',3,0,'FRA',89), official(78,'roundOf32','CIV','NOR',1,2,'NOR',91), official(79,'roundOf32','MEX','ECU',2,0,'MEX',92),
  official(80,'roundOf32','ENG','COD',2,1,'ENG',92), official(81,'roundOf32','USA','BIH',2,0,'USA',94), official(82,'roundOf32','BEL','SEN',3,2,'BEL',94,{resultType:'AET'}),
  official(83,'roundOf32','POR','CRO',2,1,'POR',93), official(84,'roundOf32','ESP','AUT',3,0,'ESP',93), official(85,'roundOf32','SUI','ALG',2,0,'SUI',96),
  official(86,'roundOf32','ARG','CPV',3,2,'ARG',95,{resultType:'AET'}), official(87,'roundOf32','COL','GHA',1,0,'COL',96),
  official(88,'roundOf32','AUS','EGY',1,1,'EGY',95,{resultType:'PENALTIES',homePenaltyScore:2,awayPenaltyScore:4}),
  official(89,'roundOf16','PAR','FRA',0,1,'FRA',97), official(90,'roundOf16','CAN','MAR',0,3,'MAR',97), official(91,'roundOf16','BRA','NOR',1,2,'NOR',99),
  official(92,'roundOf16','MEX','ENG',2,3,'ENG',99), official(93,'roundOf16','POR','ESP',0,1,'ESP',98), official(94,'roundOf16','USA','BEL',1,4,'BEL',98),
  official(95,'roundOf16','ARG','EGY',3,2,'ARG',100), official(96,'roundOf16','SUI','COL',0,0,'SUI',100,{resultType:'PENALTIES',homePenaltyScore:4,awayPenaltyScore:3}),
  official(97,'quarterFinal','FRA','MAR',2,0,'FRA',101), official(98,'quarterFinal','ESP','BEL',2,1,'ESP',101),
  official(99,'quarterFinal','NOR','ENG',1,2,'ENG',102,{resultType:'AET'}), official(100,'quarterFinal','ARG','SUI',3,1,'ARG',102,{resultType:'AET'}),
  official(101,'semiFinal','FRA','ESP',0,2,'ESP',104), official(102,'semiFinal','ENG','ARG',1,2,'ARG',104),
  official(103,'thirdPlace','FRA','ENG',4,6,'ENG',null), official(104,'final','ESP','ARG',1,0,'ESP',null,{resultType:'AET'}),
]);

export const roundOf32Matches = Object.freeze(officialTournamentMatches.filter((m) => m.roundId === 'roundOf32'));
export const knockoutRoundTemplates = Object.freeze([
  ['roundOf16','16강',[89,90,91,92,93,94,95,96]], ['quarterFinal','8강',[97,98,99,100]],
  ['semiFinal','준결승',[101,102]], ['final','결승전',[104,103]],
].map(([roundId,label,matchIds]) => Object.freeze({roundId,label,matches:Object.freeze(matchIds.map((matchId)=>Object.freeze({matchId})))})));

export const qualificationRules = Object.freeze({ southAfricaGroupFinal: Object.freeze({ matchType:'group-stage', matchday:3, koreaTeamId:'KOR', opponentTeamId:'RSA', replacementMatchId:73, replacedTeamId:'RSA' }) });

/**
 * 경기 저장 순서와 독립적인 시각적 토너먼트 트리다.
 * 각 중첩 배열의 인접한 두 경기가 다음 라운드의 한 경기로 합류한다.
 */
export const bracketLayout = Object.freeze({
  roundOf32: Object.freeze([[73,75],[74,77],[83,84],[81,82],[76,78],[79,80],[86,88],[85,87]].map(Object.freeze)),
  roundOf16: Object.freeze([[90,89],[93,94],[91,92],[95,96]].map(Object.freeze)),
  quarterFinal: Object.freeze([[97,98],[99,100]].map(Object.freeze)),
  semiFinal: Object.freeze([[101,102]].map(Object.freeze)),
  final: Object.freeze([104]),
});

const flattenLayout = (roundId) => Object.freeze(bracketLayout[roundId].flat());
export const tournamentRounds = Object.freeze([
  Object.freeze({roundId:'roundOf32',label:'32강',matchIds:flattenLayout('roundOf32')}),
  Object.freeze({roundId:'roundOf16',label:'16강',matchIds:flattenLayout('roundOf16')}),
  Object.freeze({roundId:'quarterFinal',label:'8강',matchIds:flattenLayout('quarterFinal')}),
  Object.freeze({roundId:'semiFinal',label:'준결승',matchIds:flattenLayout('semiFinal')}),
  Object.freeze({roundId:'final',label:'결승전',matchIds:bracketLayout.final,auxiliaryMatchIds:Object.freeze([103])}),
]);
