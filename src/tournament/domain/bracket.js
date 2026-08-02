import { officialTournamentMatches, tournamentRounds } from '../data/bracket.js';
import { countries } from '../../shared/data/countries.js';

export const QUALIFICATION_STATUSES = Object.freeze(['pending','qualified','eliminated']);
const clone = (value) => structuredClone(value);
const team = (teamId) => ({ type:'TEAM', teamId });
const winner = (matchId) => ({ type:'WINNER', matchId });
const loser = (matchId) => ({ type:'LOSER', matchId });
const dynamicIds = new Set([73,90,97,101,103,104]);

export function createOfficialBracket() {
  return { version:2, tournamentId:'world-championship-2026', timeline:'official', qualificationStatus:'eliminated', matches:clone(officialTournamentMatches) };
}

function resolveSource(source, matches) {
  if (!source) return null;
  if (source.type === 'TEAM') return source.teamId;
  if (!['WINNER','LOSER'].includes(source.type)) return null;
  const match = matches.find((item) => item.matchId === source.matchId);
  if (!match || match.status !== 'completed') return null;
  if (source.type === 'WINNER') return match.winnerTeamId;
  return match.winnerTeamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
}

/** 조별리그 결과와 시간선 미리 보기를 분리해 Match 73의 홈 슬롯을 결정한다. */
export function resolveMatch73HomeTeam(qualificationStatus = 'pending') {
  if (!QUALIFICATION_STATUSES.includes(qualificationStatus)) throw new TypeError(`알 수 없는 진출 상태: ${qualificationStatus}`);
  if (qualificationStatus === 'qualified') return { teamId:'KOR', source:team('KOR'), slotLabel:null, status:'playable' };
  return {
    teamId:null,
    source:{ type:'GROUP_POSITION', groupId:'A', position:2, label:'A조 2위' },
    slotLabel:'A조 2위',
    status:'waiting',
  };
}

function resolveGameMatches(matches) {
  return matches.map((match) => {
    if (!dynamicIds.has(match.matchId) || match.status === 'completed') return match;
    const homeTeamId = resolveSource(match.homeSource, matches);
    const awayTeamId = resolveSource(match.awaySource, matches);
    return { ...match, homeTeamId, awayTeamId, status: homeTeamId && awayTeamId ? 'playable' : 'waiting' };
  });
}

export function createGameTimelineBracket({ qualificationStatus = 'pending' } = {}) {
  const match73Home = resolveMatch73HomeTeam(qualificationStatus);
  const pathState = qualificationStatus === 'qualified' ? 'confirmed' : 'preview';
  const dynamic = {
    73:{roundId:'roundOf32',homeSource:match73Home.source,homeSlotLabel:match73Home.slotLabel,awaySource:team('CAN'),nextMatchId:90},
    90:{roundId:'roundOf16',homeSource:winner(73),awaySource:team('MAR'),nextMatchId:97},
    97:{roundId:'quarterFinal',homeSource:team('FRA'),awaySource:winner(90),nextMatchId:101},
    101:{roundId:'semiFinal',homeSource:winner(97),awaySource:team('ESP'),nextMatchId:104},
    103:{roundId:'thirdPlace',homeSource:loser(101),awaySource:loser(102),nextMatchId:null},
    104:{roundId:'final',homeSource:winner(101),awaySource:winner(102),nextMatchId:null},
  };
  let matches = clone(officialTournamentMatches).map((match) => dynamicIds.has(match.matchId) ? {
    matchId:match.matchId, ...dynamic[match.matchId], homeTeamId:null, awayTeamId:null, homeScore:null, awayScore:null,
    homePenaltyScore:null, awayPenaltyScore:null, winnerTeamId:null, resultType:null, status:'waiting', source:'GAME_TIMELINE',
    historyChanged:qualificationStatus==='qualified', pathState,
  } : match);
  matches = resolveGameMatches(matches);
  return { version:2, tournamentId:'world-championship-2026', timeline:'game', qualificationStatus, matches };
}

export function createInitialBracket({qualificationStatus='pending'}={}) {
  if (!QUALIFICATION_STATUSES.includes(qualificationStatus)) throw new TypeError(`알 수 없는 진출 상태: ${qualificationStatus}`);
  return createGameTimelineBracket({ qualificationStatus });
}
export function applyKoreaQualification(_bracket,status) { return createGameTimelineBracket({qualificationStatus:status}); }

export function validateBracket(bracket) {
  const errors=[];
  if (!bracket || bracket.version!==2 || !Array.isArray(bracket.matches)) return {valid:false,errors:['TournamentBracket version 2가 아닙니다.']};
  const ids=new Set(bracket.matches.map((m)=>m.matchId));
  if (bracket.matches.length!==32 || ids.size!==32) errors.push('토너먼트는 3위 결정전을 포함한 중복 없는 32경기여야 합니다.');
  for (const match of bracket.matches) {
    for (const id of [match.homeTeamId,match.awayTeamId,match.winnerTeamId].filter(Boolean)) if (!countries[id]) errors.push(`Match ${match.matchId}: 알 수 없는 팀 ${id}`);
    if (match.nextMatchId!=null && !ids.has(match.nextMatchId)) errors.push(`Match ${match.matchId}: 다음 경기가 없습니다.`);
    if (match.status==='completed' && ![match.homeTeamId,match.awayTeamId].includes(match.winnerTeamId)) errors.push(`Match ${match.matchId}: 승자가 올바르지 않습니다.`);
    if (match.resultType==='PENALTIES' && (!Number.isInteger(match.homePenaltyScore)||!Number.isInteger(match.awayPenaltyScore))) errors.push(`Match ${match.matchId}: 승부차기 결과가 없습니다.`);
  }
  for (const round of tournamentRounds) if ([...round.matchIds,...(round.auxiliaryMatchIds??[])].some((id)=>!ids.has(id))) errors.push(`${round.label} 구성이 불완전합니다.`);
  return {valid:!errors.length,errors};
}

export function recordMatchResult(bracket,result) {
  const check=validateBracket(bracket); if(!check.valid) throw new Error(check.errors.join(' '));
  if (bracket.timeline!=='game' || !dynamicIds.has(result?.matchId)) throw new Error('공식 대회 원본 결과는 변경할 수 없습니다.');
  const matches=clone(bracket.matches); const index=matches.findIndex((m)=>m.matchId===result.matchId); const match=matches[index];
  if (!match || match.status!=='playable') throw new Error('아직 진행할 수 없는 경기입니다.');
  const homeScore=Number(result.homeScore), awayScore=Number(result.awayScore);
  if (![match.homeTeamId,match.awayTeamId].includes(result.winnerTeamId)||!Number.isInteger(homeScore)||!Number.isInteger(awayScore)||homeScore<0||awayScore<0) throw new Error('유효하지 않은 경기 결과입니다.');
  matches[index]={...match,status:'completed',homeScore,awayScore,winnerTeamId:result.winnerTeamId,resultType:result.resultType??'REGULATION',homePenaltyScore:result.homePenaltyScore??null,awayPenaltyScore:result.awayPenaltyScore??null};
  return {...bracket,matches:resolveGameMatches(matches)};
}
export function getCurrentRound(bracket) { return tournamentRounds.find((round)=>round.matchIds.some((id)=>bracket.matches.find((m)=>m.matchId===id)?.status!=='completed'))??tournamentRounds.at(-1); }
export function getTournamentNextOpponent(bracket,teamId) { const match=bracket?.matches?.find((m)=>m.status!=='completed'&&[m.homeTeamId,m.awayTeamId].includes(teamId)); return match ? (match.homeTeamId===teamId?match.awayTeamId:match.homeTeamId) : null; }
