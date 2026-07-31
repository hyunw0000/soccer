/**
 * 아주 얇은 DOM 헬퍼.
 * innerHTML 을 쓰지 않는 것이 규칙이다 — 감독 이름처럼 사용자가 입력한 문자열이
 * 화면에 다시 나오므로, 전부 textContent 로만 넣어 XSS 경로를 원천 차단한다.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export const frag = (children) => {
  const f = document.createDocumentFragment();
  [].concat(children).forEach((c) => c && f.append(c));
  return f;
};
