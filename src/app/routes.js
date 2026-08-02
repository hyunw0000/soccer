export const ROUTES = Object.freeze({
  start: { path: '/', public: true },
  setup: { path: '/setup', public: true },
  roster: { path: '/roster' },
  tournament: { path: '/tournament' },
  lineup: { path: '/lineup' },
  tactics: { path: '/tactics' },
  simulation: { path: '/simulation' },
  match: { path: '/match' },
});

// 기존 기능 모듈이 사용하는 화면 이름을 유지한다.
export const ROUTE_ALIASES = Object.freeze({ manager: 'setup', squad: 'roster' });

export function routePath(name) {
  const resolved = ROUTE_ALIASES[name] ?? name;
  return ROUTES[resolved]?.path;
}

export function routeNameFromPath(pathname) {
  const normalized = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  return Object.keys(ROUTES).find((name) => ROUTES[name].path === normalized) ?? 'notFound';
}
