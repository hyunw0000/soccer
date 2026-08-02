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

  const next = el('button', {
    class: 'primary',
    type: 'button',
    text: '다음 →',
    onclick: () => {
      persist();
      ctx.navigate('tactics');
    },
  });
  const floatingNext = el('button', {
    class: 'primary lineup-floating-next',
    type: 'button',
    text: '다음 →',
    hidden: true,
    onclick: () => next.click(),
  });
  const hero = el('header', { class: 'topbar' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', text: 'SCOUTING · MATCH 54' }),
      el('h2', { class: 'h2', text: '상대 선수단을 확인하세요' }),
      el('p',{class:'topbar-description',text:'다음 상대의 포메이션과 핵심 선수를 분석해 경기 계획을 준비합니다.'}),
    ]),
    el('div', { class: 'topbar-right' }, [
      el('button', {
        class: 'ghost',
        type: 'button',
        text: '← 이전',
        onclick: () => {
          persist();
          ctx.navigate('squad');
        },
      }),
      next,
    ]),
  ]);

  root.append(
    el('div', { class: 'screen page' }, [
      hero,
      scouting.node,
    ])
  );

  document.querySelector('.top-navigation')?.append(floatingNext);
  const updateFloatingNext = () => {
    const navigationHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-navigation-height')) || 62;
    floatingNext.hidden = hero.getBoundingClientRect().bottom > navigationHeight;
  };
  window.addEventListener('scroll',updateFloatingNext,{passive:true});
  window.addEventListener('resize',updateFloatingNext);
  updateFloatingNext();

  // 화면을 떠날 때도 이번 라운드 상대를 잃지 않는다.
  return () => {
    window.removeEventListener('scroll',updateFloatingNext);
    window.removeEventListener('resize',updateFloatingNext);
    floatingNext.remove();
    persist();
  };
}
