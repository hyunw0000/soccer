import './styles/base.css';
import { createRouter } from './router.js';
import manager from './screens/managerName.js';
import squad from './screens/squad.js';
import tactics from './screens/tactics.js';
import match from './screens/match.js';

const root = document.getElementById('app');
const router = createRouter(root, { manager, squad, tactics, match });

// 저장된 감독명이 있어도 타이틀 화면에서 새 게임을 시작한다.
router.go('manager');
