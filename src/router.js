/**
 * 최소 화면 전환기.
 * 각 화면은 mount(root, ctx) 을 export 하고, 정리 함수를 반환한다.
 * 이전 화면의 정리(리스너 해제, WebGL dispose)를 강제하는 것이 이 파일의 존재 이유다.
 */
export function createRouter(root, screens) {
  let cleanup = null;
  let currentName = null;

  const ctx = {
    go(name, params) {
      if (!screens[name]) throw new Error(`unknown screen: ${name}`);
      if (cleanup) cleanup();
      cleanup = null;
      root.replaceChildren();
      currentName = name;
      cleanup = screens[name](root, ctx, params) ?? null;
    },
    get current() {
      return currentName;
    },
  };
  return ctx;
}
