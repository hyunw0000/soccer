import { el } from '../ui/dom.js';
import { state, setState } from '../state.js';

/** 1단계: 감독 이름 입력 */
export default function managerNameScreen(root, ctx) {
  const input = el('input', {
    class: 'field',
    type: 'text',
    maxlength: 20,
    placeholder: '예: 홍길동 감독',
    value: state.managerName,
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const error = el('p', { class: 'error', text: '' });

  const submit = () => {
    const name = input.value.trim();
    if (name.length < 1) {
      error.textContent = '이름을 입력해 주세요.';
      input.focus();
      return;
    }
    setState({ managerName: name });
    ctx.go('squad');
  };

  const card = el('div', { class: 'card center-card' }, [
    el('p', { class: 'eyebrow', text: 'STEP 1 / 3' }),
    el('h1', { class: 'title', text: '감독 이름을 설정해 주세요' }),
    el('p', {
      class: 'lead',
      text: '이 이름으로 벤치에 섭니다. 선수 선발부터 경기 중 지시, 되감기까지 전부 당신의 결정입니다.',
    }),
    input,
    error,
    el('button', { class: 'primary lg', text: '명단 짜러 가기 →', onclick: submit }),
    el('a', {
      class: 'ghost-link',
      href: 'legacy/prototype-3d.html',
      target: '_blank',
      rel: 'noopener noreferrer',
      text: '초기 3D 프로토타입(단일 HTML) 보기',
    }),
  ]);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  root.append(el('div', { class: 'screen center' }, [card]));
  input.focus();
}
