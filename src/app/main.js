import '../shared/styles/base.css';
import './layout/app-layout.css';
import { createRouter } from './router.js';
import managerScreen from './screens/managerName.js';
import {
  notFoundScreen,
  simulationPlaceholder,
} from './screens/placeholders.js';
import { withAppLayout } from './layout/AppLayout.js';
import { retryKoreaMatch, state } from './public.js';
import { lineupScreen } from '../lineup/index.js';
import { rosterScreen } from '../roster/index.js';
import { tacticsScreen } from '../tactics/index.js';
import { championshipDemoScreen, matchScreen } from '../match/index.js';
import { tournamentScreen } from '../tournament/index.js';

/**
 * 앱의 유일한 조립 지점.
 * 기능 영역은 공개 index.js로만 가져오고, 화면 선택과 생명주기는 router가 관리한다.
 */
export function startApp(root = document.getElementById('app')) {
  if (!root) throw new Error('app root not found');

  const router = createRouter(root, {
    start: managerScreen,
    setup: managerScreen,
    roster: withAppLayout(rosterScreen, '/roster'),
    tournament: withAppLayout((outlet, ctx) => tournamentScreen(outlet, ctx, {
      bracket: state.tournamentBracket,
      groupAFinalResult: state.groupAFinalResult,
      knockoutResults: state.knockoutResults,
      // 다시 시도 = 그 경기를 치르기 직전으로 되돌리고 화면을 새 상태로 다시 그린다.
      onRetry: (matchId) => {
        retryKoreaMatch(matchId);
        ctx.navigate('tournament', { retriedAt: Date.now() }, { replace: true });
      },
    }), '/tournament'),
    lineup: withAppLayout(lineupScreen, '/lineup'),
    tactics: withAppLayout(tacticsScreen, '/tactics'),
    simulation: withAppLayout(simulationPlaceholder, '/simulation'),
    match: withAppLayout(matchScreen, '/match'),
    championDemo: withAppLayout(championshipDemoScreen, '/champion-demo'),
    notFound: notFoundScreen,
  }, {
    canAccess: (_name, route) => route.public === true || state.hasCompletedSetup === true,
  });

  router.start();
  return router;
}
