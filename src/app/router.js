/**
 * 중앙 화면 전환기.
 * 각 화면은 mount(root, ctx, params) 함수를 export하고 정리 함수를 반환한다.
 * navigate()만 공개해 화면이 서로를 직접 렌더링하지 않도록 한다.
 *
 * history state에 route를 기록하므로 뒤로가기/앞으로가기를 지원한다.
 * URL path는 바꾸지 않아 기존 정적 배포와 직접 접속 동작은 그대로 유지한다.
 */
export function createRouter(root, screens) {
  let cleanup = null;
  let currentName = null;

  function render(name, params) {
    if (!screens[name]) throw new Error(`unknown screen: ${name}`);
    if (cleanup) cleanup();
    cleanup = null;
    root.replaceChildren();
    currentName = name;
    cleanup = screens[name](root, ctx, params) ?? null;
  }

  function navigate(name, params, { replace = false, fromHistory = false } = {}) {
    render(name, params);
    if (fromHistory || typeof window === 'undefined') return;

    const historyState = { screen: name, params: params ?? null };
    if (replace) window.history.replaceState(historyState, '');
    else window.history.pushState(historyState, '');
  }

  const onPopState = (event) => {
    const route = event.state;
    if (route?.screen && screens[route.screen]) {
      navigate(route.screen, route.params ?? undefined, { fromHistory: true });
    }
  };

  if (typeof window !== 'undefined') window.addEventListener('popstate', onPopState);

  const ctx = {
    navigate,
    get current() {
      return currentName;
    },
    destroy() {
      if (cleanup) cleanup();
      cleanup = null;
      if (typeof window !== 'undefined') window.removeEventListener('popstate', onPopState);
    },
  };
  return ctx;
}
