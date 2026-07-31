import { el } from '../../shared/index.js';
import { state, setState } from '../public.js';

const playerDots = [
  ['home', 8, 74], ['home', 20, 57], ['home', 28, 33], ['home', 39, 25],
  ['home', 42, 68], ['home', 53, 48], ['home', 62, 20], ['home', 70, 65],
  ['away', 13, 45], ['away', 27, 23], ['away', 45, 70], ['away', 63, 30],
  ['away', 72, 13], ['away', 82, 56], ['away', 91, 34], ['away', 95, 64],
  ['target', 98, 50],
];

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of children) node.append(child);
  return node;
}

function brand() {
  return el('div', { class: 'start-brand', 'aria-label': 'REWIND' }, [
    el('span', { text: 'REWIND' }),
    el('b', { text: '◀◀', 'aria-hidden': 'true' }),
  ]);
}

function gameIntroDialog(onClose) {
  const flow = [
    ['01', '감독 취임', '감독명을 정하고 대한민국 대표팀의 지휘봉을 잡습니다.'],
    ['02', '선수단 구성', '55명의 선수 풀에서 최대 23명을 소집하고 주장을 선택합니다.'],
    ['03', '전술 설계', '상대를 분석해 포메이션, 선발 11인, 압박·템포·수비 라인을 정합니다.'],
    ['04', '3D 경기 지휘', '경기를 관전하며 실시간으로 전술을 바꾸고 결정적 순간을 되감습니다.'],
  ];

  const modal = el('section', {
    class: 'intro-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'intro-title',
    hidden: true,
  }, [
    el('div', { class: 'intro-panel' }, [
      el('div', { class: 'intro-panel-head' }, [
        el('div', {}, [
          el('span', { class: 'intro-kicker', text: '3D FOOTBALL TACTICS' }),
          el('h2', { id: 'intro-title', text: '게임 소개' }),
        ]),
        el('button', {
          class: 'intro-close',
          type: 'button',
          text: '×',
          'aria-label': '게임 소개 닫기',
          onclick: onClose,
        }),
      ]),
      el('p', { class: 'intro-lead' }, [
        '전술을 짜고, 3D로 경기를 지켜보고, ',
        el('strong', { text: '되감아서 다시 지시하는' }),
        ' 축구 감독 시뮬레이터입니다.',
      ]),
      el('p', { class: 'intro-quote', text: '“내가 감독이었다면?” 그 아쉬운 순간으로 돌아가 결과를 바꿔보세요.' }),
      el('div', { class: 'intro-flow' }, flow.map(([number, title, description]) =>
        el('article', { class: 'intro-step' }, [
          el('b', { text: number }),
          el('div', {}, [
            el('h3', { text: title }),
            el('p', { text: description }),
          ]),
        ]))),
      el('div', { class: 'intro-details' }, [
        el('article', { class: 'intro-feature' }, [
          el('span', { text: '핵심 시스템' }),
          el('h3', { text: '8초 되감기 · 경기당 3회' }),
          el('p', { text: '과거 상태로 복원한 뒤 새로운 전술로 다른 경기 흐름을 만듭니다.' }),
        ]),
        el('article', { class: 'intro-feature' }, [
          el('span', { text: '경기 관전' }),
          el('h3', { text: '방송캠 · 탑뷰 · 공 추적' }),
          el('p', { text: '세 가지 카메라로 22명의 움직임과 체력 변화를 확인합니다.' }),
        ]),
        el('article', { class: 'intro-feature' }, [
          el('span', { text: '전술 선택' }),
          el('h3', { text: '4-3-3 · 4-4-2 · 3-4-3' }),
          el('p', { text: '상대 스카우팅 정보를 바탕으로 선발과 세부 전술을 직접 구성합니다.' }),
        ]),
      ]),
      el('div', { class: 'intro-shortcuts' }, [
        el('span', { text: '경기 단축키' }),
        el('kbd', { text: 'SPACE' }),
        el('b', { text: '일시정지' }),
        el('kbd', { text: 'R' }),
        el('b', { text: '8초 되감기' }),
      ]),
      el('p', { class: 'intro-note', text: '회원가입과 별도 설치 없이 브라우저에서 바로 플레이할 수 있습니다.' }),
    ]),
  ]);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) onClose();
  });
  return modal;
}

function tacticsBoard() {
  const board = el('div', { class: 'start-pitch', 'aria-label': '공격 전술 시뮬레이션' });

  for (const [index, [team, x, y]] of playerDots.entries()) {
    const dot = el('i', { class: `start-dot ${team}`, 'aria-hidden': 'true' });
    dot.style.left = `${x}%`;
    dot.style.top = `${y}%`;
    dot.style.setProperty('--move-x', `${((index * 13) % 35) - 17}px`);
    dot.style.setProperty('--move-y', `${((index * 17) % 29) - 14}px`);
    dot.style.setProperty('--move-x-back', `${((index * 11) % 25) - 12}px`);
    dot.style.setProperty('--move-y-back', `${((index * 7) % 21) - 10}px`);
    dot.style.setProperty('--move-duration', `${5 + (index % 6) * 0.5}s`);
    dot.style.setProperty('--move-delay', `${-(index % 7) * 0.65}s`);
    board.append(dot);
  }

  board.append(
    svgEl('svg', {
      class: 'start-run',
      viewBox: '0 0 1000 500',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
    }, [
      svgEl('defs', {}, [
        svgEl('linearGradient', { id: 'run-gradient', x1: '0%', y1: '0%', x2: '100%', y2: '0%' }, [
          svgEl('stop', { offset: '0%', 'stop-color': '#75ff45' }),
          svgEl('stop', { offset: '55%', 'stop-color': '#f7f04b' }),
          svgEl('stop', { offset: '100%', 'stop-color': '#ff3434' }),
        ]),
      ]),
      svgEl('path', {
        d: 'M 90 370 C 250 350, 280 310, 340 220 S 430 100, 500 135 S 650 220, 720 245 S 850 275, 950 245',
        fill: 'none',
        stroke: 'url(#run-gradient)',
        'stroke-width': '5',
        'stroke-linecap': 'round',
        'stroke-dasharray': '11 7',
      }),
      svgEl('path', {
        d: 'M 934 231 L 957 245 L 935 258',
        fill: 'none',
        stroke: '#ff3434',
        'stroke-width': '6',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ]),
  );

  return el('section', { class: 'start-analysis' }, [
    el('div', { class: 'analysis-corner', 'aria-hidden': 'true' }),
    board,
    el('div', { class: 'success-box' }, [
      el('span', { text: '공격 성공 확률' }),
      el('strong', { text: '23%' }),
    ]),
    el('div', { class: 'probability' }, [
      el('span', { text: '공격 성공 확률 변화' }),
      el('div', { class: 'probability-line' }, [el('i'), el('b')]),
      el('div', { class: 'probability-values' }, [
        el('b', { text: '12%' }),
        el('b', { text: '23%' }),
        el('b', { text: '8%' }),
      ]),
    ]),
  ]);
}

/** 시작 화면: 감독 이름 입력 */
export default function managerNameScreen(root, ctx) {
  const input = el('input', {
    class: 'start-input',
    type: 'text',
    maxlength: 20,
    placeholder: '홍길동',
    value: state.managerName,
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': '감독명',
  });

  const error = el('p', { class: 'start-error', text: '', role: 'alert' });

  const submit = () => {
    const name = input.value.trim();
    if (!name) {
      error.textContent = '감독명을 입력해 주세요.';
      input.focus();
      return;
    }
    setState({ managerName: name });
    ctx.navigate('squad');
  };

  let introButton;
  let introModal;
  const closeIntro = () => {
    introModal.hidden = true;
    introButton?.focus();
  };
  introModal = gameIntroDialog(closeIntro);
  introButton = el('button', {
    type: 'button',
    text: '게임 소개',
    'aria-haspopup': 'dialog',
    onclick: () => {
      introModal.hidden = false;
      introModal.querySelector('.intro-close')?.focus();
    },
  });

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && !introModal.hidden) closeIntro();
  };
  document.addEventListener('keydown', onKeyDown);

  const screen = el('main', { class: 'screen start-screen' }, [
    el('header', { class: 'start-header' }, [
      brand(),
      el('nav', { class: 'start-nav', 'aria-label': '시작 메뉴' }, [
        introButton,
        el('span', { 'aria-hidden': 'true' }),
        el('button', { type: 'button', text: '설정' }),
      ]),
    ]),
    el('div', { class: 'start-layout' }, [
      el('section', { class: 'start-hero' }, [
        el('h1', {}, [
          el('span', { class: 'start-title-line', text: '대한민국의 역사를' }),
          el('span', { class: 'start-title-line' }, [
            el('strong', { text: '다시' }),
            ' 쓰세요',
          ]),
        ]),
        el('div', { class: 'start-rule', 'aria-hidden': 'true' }),
        el('p', { class: 'start-subtitle' }, [
          el('b', { text: '당신' }),
          '은 대한민국 감독입니다',
        ]),
        el('div', { class: 'start-form' }, [
          el('label', { for: 'manager-name', text: '감독명을 입력하세요' }),
          el('div', { class: 'start-input-wrap' }, [
            el('span', { class: 'manager-icon', 'aria-hidden': 'true' }),
            input,
          ]),
          error,
          el('button', {
            class: 'career-button',
            type: 'button',
            text: '감독 커리어 시작',
            onclick: submit,
          }),
        ]),
        el('div', { class: 'rewind-message' }, [
          el('b', { text: '↶', 'aria-hidden': 'true' }),
          el('p', {}, [
            '결정적인 순간, ',
            el('em', { text: '시간을 되돌려' }),
            ' 전술을 바꾸세요.',
          ]),
        ]),
      ]),
      tacticsBoard(),
    ]),
    introModal,
  ]);

  input.id = 'manager-name';
  input.addEventListener('input', () => { error.textContent = ''; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  root.append(screen);
  input.focus();
  return () => document.removeEventListener('keydown', onKeyDown);
}
