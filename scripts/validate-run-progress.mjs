/**
 * 대회 진행 규칙 검증.
 * 남아공전은 승리 또는 무승부 시 진출하고, 토너먼트는 승리해야 진출한다.
 */
import {
  KOREA_RUN,
  applyKoreaMatchResult,
  clearKoreaMatchResult,
  createGameProgress,
} from '../src/tournament/domain/gameProgress.js';

const errors = [];
const check = (label, actual, expected) => {
  if (actual !== expected) errors.push(`${label}: ${actual}, 예상 ${expected}`);
};

// 저장값을 쌓아 가며 경기를 치르는 헬퍼 (점수는 항상 우리 팀 관점)
const play = (saved, matchId, koreaScore, opponentScore) =>
  applyKoreaMatchResult(saved, { matchId, koreaScore, opponentScore });

// 1. 경기 전
const initial = createGameProgress();
check('경기 전 status', initial.status, 'playing');
check('경기 전 진출 상태', initial.qualificationStatus, 'pending');
check('경기 전 다음 경기', initial.nextStep?.matchId, 54);
check('경기 전 상대', initial.nextStep?.opponentTeamId, 'RSA');

// 2. 남아공전 무승부 → A조 2위로 32강 진출
const drawn = createGameProgress(play({}, 54, 1, 1));
check('무승부 status', drawn.status, 'playing');
check('무승부 진출 상태', drawn.qualificationStatus, 'qualified');
check('무승부 다음 경기', drawn.nextStep?.matchId, 73);
check('무승부 다음 상대', drawn.nextStep?.opponentTeamId, 'CAN');
check('무승부 조 순위', drawn.group.standings.find((r) => r.teamId === 'KOR')?.position, 2);
check('무승부 Match 73 상태', drawn.bracket.matches.find((m) => m.matchId === 73)?.status, 'playable');

// 3. 남아공전 패배 → 탈락
const lost = createGameProgress(play({}, 54, 0, 2));
check('패배 status', lost.status, 'eliminated');
check('패배 진출 상태', lost.qualificationStatus, 'eliminated');

// 4. 남아공전 승리 → A조 2위로 32강, 상대는 캐나다
const savedWin = play({}, 54, 2, 0);
check('승리 저장값 home(남아공)', savedWin.groupAFinalResult.homeScore, 0);
check('승리 저장값 away(대한민국)', savedWin.groupAFinalResult.awayScore, 2);
const won = createGameProgress(savedWin);
check('승리 status', won.status, 'playing');
check('승리 진출 상태', won.qualificationStatus, 'qualified');
check('승리 후 조 순위', won.group.standings.find((r) => r.teamId === 'KOR')?.position, 2);
check('승리 후 다음 경기', won.nextStep?.matchId, 73);
check('승리 후 다음 상대', won.nextStep?.opponentTeamId, 'CAN');
const match73 = won.bracket.matches.find((m) => m.matchId === 73);
check('Match 73 홈', match73?.homeTeamId, 'KOR');
check('Match 73 원정', match73?.awayTeamId, 'CAN');
check('Match 73 상태', match73?.status, 'playable');

// 5. 다시 시도 → 남아공전 직전으로
const retried = createGameProgress(clearKoreaMatchResult(play({}, 54, 1, 1), 54));
check('다시 시도 status', retried.status, 'playing');
check('다시 시도 다음 경기', retried.nextStep?.matchId, 54);

// 6. 캐나다전 패배 → 32강 탈락, 대진표에는 캐나다가 올라간다
const lostR32 = createGameProgress(play(savedWin, 73, 0, 1));
check('32강 패배 status', lostR32.status, 'eliminated');
check('32강 패배 다시 시도 대상', lostR32.activeStep?.matchId, 73);
check('32강 패배 Match 73 승자', lostR32.bracket.matches.find((m) => m.matchId === 73)?.winnerTeamId, 'CAN');
check('32강 패배 Match 90 홈', lostR32.bracket.matches.find((m) => m.matchId === 90)?.homeTeamId, 'CAN');

// 7. 32강 무승부도 탈락
check('32강 무승부 status', createGameProgress(play(savedWin, 73, 2, 2)).status, 'eliminated');

// 8. 32강 다시 시도 → 조별리그 결과는 남고 32강만 지워진다
const retriedR32 = clearKoreaMatchResult(play(savedWin, 73, 0, 1), 73);
check('32강 다시 시도 조별 결과 유지', retriedR32.groupAFinalResult?.awayScore, 2);
check('32강 다시 시도 남은 결과 수', retriedR32.knockoutResults.length, 0);
check('32강 다시 시도 다음 경기', createGameProgress(retriedR32).nextStep?.matchId, 73);

// 9. 결승까지 전승 → 우승
let saved = savedWin;
for (const step of KOREA_RUN.slice(1)) saved = play(saved, step.matchId, 2, 1);
const champion = createGameProgress(saved);
check('전승 status', champion.status, 'champion');
check('전승 다음 경기', champion.nextStep, null);
check('전승 결승 승자', champion.bracket.matches.find((m) => m.matchId === 104)?.winnerTeamId, 'KOR');
check('전승 경기 수', champion.played.length, KOREA_RUN.length);

// 10. 준결승에서 지면 그 뒤 결과는 없다
const lostSemi = createGameProgress(play(saved, 101, 0, 3));
check('준결승 패배 status', lostSemi.status, 'eliminated');
check('준결승 패배 마지막 경기', lostSemi.lastPlayed?.matchId, 101);
check('준결승 패배 결승 상태', lostSemi.bracket.matches.find((m) => m.matchId === 104)?.homeTeamId, 'ESP');

if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`대회 진행 규칙 검증 통과 · 조별리그 승/무 진출 · 토너먼트 승리 진출 · 다시 시도 · 전승 우승 (${KOREA_RUN.length}경기 경로)`);
