import { el } from '../../shared/index.js';

const NAV_ITEMS = Object.freeze([
  ['대회', '/tournament'],
  ['선수단', '/roster'],
  ['라인업', '/lineup'],
  ['전술', '/tactics'],
  ['경기', '/match'],
]);

export function withAppLayout(screen, activePath) {
  return (root, ctx, params) => {
    const outlet = el('div', { class: 'app-layout__outlet' });
    const navigation = el('nav', { class: 'top-navigation', 'aria-label': '기능 화면' }, [
      el('div', { class: 'top-navigation__inner' }, NAV_ITEMS.map(([label, path]) => {
        const active = path === activePath;
        return el('button', {
          class: `top-navigation__item${active ? ' is-active' : ''}`,
          type: 'button',
          text: label,
          'aria-current': active ? 'page' : null,
          onclick: () => ctx.navigate(path),
        });
      })),
    ]);

    root.append(el('div', { class: 'app-layout' }, [navigation, outlet]));
    const cleanup = screen(outlet, ctx, params);
    return typeof cleanup === 'function' ? cleanup : undefined;
  };
}
