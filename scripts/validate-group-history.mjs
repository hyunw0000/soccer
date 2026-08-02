import { createGroupAState, getMatchesForTeam } from '../src/tournament/domain/groupStandings.js';

const state=createGroupAState();
const expected={MEX:[1,28,53],KOR:[2,28,54],CZE:[2,25,53],RSA:[1,25,54]};
const errors=[];

for(const [teamId,matchIds] of Object.entries(expected)){
  const matches=getMatchesForTeam(state.matches,teamId);
  const actualIds=matches.map(({matchId})=>matchId);
  if(matches.length!==3) errors.push(`${teamId}: 경기 수 ${matches.length}, 예상 3`);
  if(actualIds.join(',')!==matchIds.join(',')) errors.push(`${teamId}: 경기 ${actualIds.join(',')}, 예상 ${matchIds.join(',')}`);
}

const finalMatch=getMatchesForTeam(state.matches,'KOR').find(({matchId})=>matchId===54);
if(finalMatch?.status!=='scheduled') errors.push('M54는 경기 전 상태여야 합니다.');
if(finalMatch?.homeScore!=null||finalMatch?.awayScore!=null) errors.push('M54에 경기 전 점수가 있으면 안 됩니다.');
if(getMatchesForTeam(state.matches,'XXX').length!==0) errors.push('알 수 없는 팀은 빈 경기 목록을 반환해야 합니다.');

if(errors.length){ console.error(errors.join('\n')); process.exitCode=1; }
else console.log('A조 경기 내역 검증 통과 · MEX 3 · KOR 3 · CZE 3 · RSA 3');
