import { el } from '../../shared/index.js';

function placeholder(title, description, actions = []) {
  return (root, ctx) => {
    root.append(el('main', { class: 'screen center' }, [
      el('section', { class: 'card center-card' }, [
        el('p', { class: 'eyebrow', text: 'REWIND' }),
        el('h1', { class: 'title', text: title }),
        el('p', { class: 'lead', text: description }),
        ...actions.map(([label, route]) => el('button', {
          class: route === 'roster' ? 'primary' : 'ghost',
          type: 'button',
          text: label,
          onclick: () => ctx.navigate(route),
        })),
      ]),
    ]));
  };
}

export const tournamentPlaceholder = placeholder('대회', '대회 화면은 기능 담당자의 공개 화면을 기다리고 있습니다.');
export const lineupPlaceholder = placeholder('라인업', '라인업 화면은 기능 담당자의 공개 화면을 기다리고 있습니다.');
export const simulationPlaceholder = placeholder('시뮬레이션', '시뮬레이션 화면은 기능 담당자의 공개 화면을 기다리고 있습니다.');

export function notFoundScreen(root, ctx) {
  return placeholder('페이지를 찾을 수 없습니다', '요청한 주소가 존재하지 않습니다.', [['선수단으로', '/roster']])(root, ctx);
}
