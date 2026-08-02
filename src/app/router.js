import { ROUTES, ROUTE_ALIASES, routeNameFromPath, routePath } from './routes.js';

export function createRouter(root, screens, { canAccess = () => true } = {}) {
  let cleanup = null;
  let currentName = null;
  let currentParams = null;

  const resolveName = (name) => {
    if (typeof name === 'string' && name.startsWith('/')) return routeNameFromPath(name);
    return ROUTE_ALIASES[name] ?? name;
  };

  function guardedName(name) {
    const resolved = resolveName(name);
    if (resolved === 'notFound') return resolved;
    if (!ROUTES[resolved]) return 'notFound';
    // 루트 진입은 저장된 진행 상태와 관계없이 항상 오프닝부터 시작한다.
    if (resolved === 'start') return 'setup';
    if (!canAccess(resolved, ROUTES[resolved])) return 'setup';
    return resolved;
  }

  function render(name, params) {
    if (currentName === name && currentParams === params) return;
    cleanup?.();
    cleanup = null;
    root.replaceChildren();
    currentName = name;
    currentParams = params;
    const nextCleanup = (screens[name] ?? screens.notFound)(root, ctx, params);
    cleanup = typeof nextCleanup === 'function' ? nextCleanup : null;
  }

  function navigate(name, params, { replace = false, fromHistory = false } = {}) {
    const requested = resolveName(name);
    const resolved = guardedName(requested);
    const guarded = resolved !== requested;
    const path = routePath(resolved) ?? window.location.pathname;

    if (!fromHistory && typeof window !== 'undefined') {
      const method = replace || guarded ? 'replaceState' : 'pushState';
      window.history[method]({ route: resolved, params: params ?? null }, '', path);
    } else if (fromHistory && guarded && typeof window !== 'undefined') {
      window.history.replaceState({ route: resolved, params: null }, '', path);
    }
    render(resolved, params);
  }

  const onPopState = (event) => {
    const name = event.state?.route ?? routeNameFromPath(window.location.pathname);
    navigate(name, event.state?.params ?? undefined, { fromHistory: true });
  };

  const onDocumentClick = (event) => {
    const link = event.target.closest?.('a[data-route]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(link.dataset.route);
  };

  window.addEventListener('popstate', onPopState);
  document.addEventListener('click', onDocumentClick);

  const ctx = {
    navigate,
    get current() { return currentName; },
    destroy() {
      cleanup?.();
      cleanup = null;
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onDocumentClick);
    },
  };

  ctx.start = () => navigate(routeNameFromPath(window.location.pathname), undefined, { replace: true });
  return ctx;
}
