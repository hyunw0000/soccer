import './styles/base.css';
import { createRouter } from './router.js';
import { state } from './state.js';
import manager from './screens/managerName.js';
import squad from './screens/squad.js';
import tactics from './screens/tactics.js';
import match from './screens/match.js';

const root = document.getElementById('app');
const router = createRouter(root, { manager, squad, tactics, match });

// 이름을 이미 넣어둔 감독은 명단 화면부터 시작
router.go(state.managerName ? 'squad' : 'manager');
