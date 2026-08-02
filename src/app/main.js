import '../shared/styles/base.css';
import './layout/app-layout.css';
import { createRouter } from './router.js';
import managerScreen from './screens/managerName.js';
import {
  notFoundScreen,
  simulationPlaceholder,
  tournamentPlaceholder,
} from './screens/placeholders.js';
import { withAppLayout } from './layout/AppLayout.js';
import { state } from './public.js';
import { lineupScreen } from '../lineup/index.js';
import { rosterScreen } from '../roster/index.js';
import { tacticsScreen } from '../tactics/index.js';
import { matchScreen } from '../match/index.js';

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
    tournament: withAppLayout(tournamentPlaceholder, '/tournament'),
    lineup: withAppLayout(lineupScreen, '/lineup'),
    tactics: withAppLayout(tacticsScreen, '/tactics'),
    simulation: withAppLayout(simulationPlaceholder, '/simulation'),
    match: withAppLayout(matchScreen, '/match'),
    notFound: notFoundScreen,
  }, {
    canAccess: (_name, route) => route.public === true || state.hasCompletedSetup === true,
  });

  router.start();
  return router;
}
