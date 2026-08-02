import './lineup.css';
import { el } from '../../shared/index.js';
import { state, setState } from '../../app/public.js';
import { getNextOpponent } from '../../tournament/index.js';
import { createOpponentScouting } from './opponentScouting.js';

/**
 * `lineup` 화면 — 이번 라운드 상대의 선수단과 포메이션을 확인한다.
 * 우리 선발 구성은 다음 화면(tactics)에서 한다.
 *
 * 보여 주는 상대는 대진표가 정하는 "지금 치를 상대" 하나뿐이다 —
 * 위로 올라가야 다음 상대가 드러나므로 여기서 뒤 라운드를 미리 고르지 않는다.
 *
 * 라우트 등록과 진입 guard는 담당자 1이 소유한다.
 * 이 화면은 mount 함수만 공개하고 다른 화면을 직접 렌더링하지 않는다.
 */
export default function lineupScreen(root, ctx) {
  const opponent = state.currentOpponent ?? getNextOpponent(state.tournamentBracket ?? null);
  const scouting = createOpponentScouting({ stage: opponent.stage });

  function persist() {
    // 전술·경기 화면이 이 라운드의 상대를 그대로 이어받게 한다.
    setState({ currentOpponent: opponent });
  }

  root.append(
    el('div', { class: 'screen page' }, [
      el('header', { class: 'topbar' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow', text: 'SCOUTING · MATCH 54' }),
          el('h2', { class: 'h2', text: '상대 선수단을 확인하세요' }),
        ]),
        el('div', { class: 'topbar-right' }, [
          el('span',{class:'counter',text:opponent?.name?`다음 상대 · ${opponent.name}`:'다음 상대 확인 중'}),
          el('button', {
            class: 'ghost',
            type: 'button',
            text: '← 이전',
            onclick: () => {
              persist();
              ctx.navigate('squad');
            },
          }),
          el('button', {
            class: 'primary',
            type: 'button',
            text: '다음 →',
            onclick: () => {
              persist();
              ctx.navigate('tactics');
            },
          }),
        ]),
      ]),
      scouting.node,
    ])
  );

  // 화면을 떠날 때도 이번 라운드 상대를 잃지 않는다.
  return persist;
}
