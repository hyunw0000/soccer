import { el } from '../../shared/index.js';

/**
 * 준비 단계의 순서. 감독이 실제로 밟는 절차 그대로다 —
 * 대회를 보고 → 선수단을 확인하고 → 라인업을 짜고 → 전술을 정하고 → 경기에 들어간다.
 *
 * 예전에는 이게 그냥 탭이라 어느 단계로든 바로 건너뛸 수 있었다. 이제 순서가 곧 절차다:
 * 여기서는 "지금 어디까지 왔는지"만 보여 주고, 실제 이동은 각 화면 하단의 다음/이전
 * 버튼으로 한다(roster.js·lineup.js·tactics.js 등이 이미 그 버튼을 갖고 있다) — 위쪽에
 * 따로 이동 버튼을 또 두면 같은 일을 하는 버튼이 화면에 두 벌 있게 된다.
 */
const NAV_STEPS = Object.freeze([
  ['대회', '/tournament'],
  ['선수단', '/roster'],
  ['라인업', '/lineup'],
  ['전술', '/tactics'],
  ['경기', '/match'],
]);

export function withAppLayout(screen, activePath) {
  return (root, ctx, params) => {
    const outlet = el('div', { class: 'app-layout__outlet' });
    const index = NAV_STEPS.findIndex(([, path]) => path === activePath);

    const navigation = el('nav', { class: 'top-navigation', 'aria-label': '진행 단계' }, [
      el('div', { class: 'top-navigation__inner' }, [
        el(
          'ol',
          { class: 'top-navigation__steps' },
          NAV_STEPS.map(([label, path], i) =>
            el('li', {
              class: `top-navigation__item${path === activePath ? ' is-active' : ''}${
                index >= 0 && i < index ? ' is-done' : ''
              }`,
              text: label,
              'aria-current': path === activePath ? 'step' : null,
            })
          )
        ),
      ]),
    ]);

    root.append(el('div', { class: 'app-layout' }, [navigation, outlet]));
    const cleanup = screen(outlet, ctx, params);
    return typeof cleanup === 'function' ? cleanup : undefined;
  };
}
