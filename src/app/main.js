import '../shared/styles/base.css';
import { createRouter } from './router.js';
import managerScreen from './screens/managerName.js';
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
    manager: managerScreen,
    squad: rosterScreen,
    tactics: tacticsScreen,
    match: matchScreen,
  });

  // 저장된 감독명이 있어도 타이틀 화면에서 새 게임을 시작한다.
  router.navigate('manager', undefined, { replace: true });
  return router;
}
