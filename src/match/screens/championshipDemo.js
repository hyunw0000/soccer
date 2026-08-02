import { CountryFlag, countries, el } from '../../shared/index.js';
import { state } from '../../app/public.js';

const COLORS = ['#f7d774', '#ef3345', '#1877c9', '#fff1c1'];

function confettiPieces() {
  return Array.from({ length: 52 }, (_, index) => el('i', {
    class: 'championship-confetti__piece',
    style: `--confetti-x:${(index * 37 + 7) % 100}%;--confetti-delay:${((index * 17) % 90) / 100}s;--confetti-duration:${3.2 + ((index * 13) % 22) / 10}s;--confetti-drift:${((index % 9) - 4) * 13}px;--confetti-size:${5 + (index % 5) * 2}px;--confetti-color:${COLORS[index % COLORS.length]}`,
  }));
}

function fireworkPieces() {
  return [
    ['12%', '14%', '0s', '#f7d774'],
    ['86%', '18%', '.3s', '#ef3345'],
    ['50%', '5%', '.55s', '#fff1ad'],
    ['6%', '48%', '.8s', '#1877c9'],
    ['94%', '45%', '1.05s', '#f7d774'],
  ].map(([left, top, delay, color]) => el('i', {
    class: 'championship-firework',
    style: `--firework-x:${left};--firework-y:${top};--firework-delay:${delay};--firework-color:${color}`,
  }));
}

export default function championshipDemoScreen(root, ctx) {
  const opponentTeamId = 'ARG';
  let effectTimer = 0;
  let animationFrame = 0;

  const confetti = el('div', { class: 'championship-confetti', 'aria-hidden': 'true' });
  const fireworks = el('div', { class: 'championship-fireworks', 'aria-hidden': 'true' });
  const recordBtn = el('button', {
    class: 'championship-button championship-button--primary',
    type: 'button',
    text: '대회 화면으로 →',
    onclick: () => ctx.navigate('tournament'),
  });
  const replayBtn = el('button', {
    class: 'championship-button',
    type: 'button',
    text: '축하 연출 다시 보기',
    onclick: replay,
  });
  const managerLine = state.managerName
    ? el('p', { class: 'championship-manager', text: `${state.managerName} 감독이 대한민국의 새로운 역사를 완성했습니다.` })
    : null;
  const dialog = el('dialog', {
    class: 'championship-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'championship-demo-title',
  }, [
    fireworks,
    confetti,
    el('section', { class: 'championship-card' }, [
      el('header', { class: 'championship-header' }, [
        el('p', { class: 'championship-eyebrow', text: 'FINAL · MATCH 104 · DEMO' }),
        el('b', { class: 'championship-world', text: 'WORLD CHAMPIONS' }),
      ]),
      el('div', { class: 'championship-trophy', 'aria-hidden': 'true' }, [
        el('span', { class: 'championship-trophy__cup' }),
        el('span', { class: 'championship-trophy__stem' }),
        el('span', { class: 'championship-trophy__base' }),
      ]),
      el('h2', { id: 'championship-demo-title', text: '역사를 다시 썼습니다' }),
      el('div', { class: 'championship-winner' }, [
        CountryFlag({ teamId: 'KOR', size: 'large' }),
        el('div', {}, [
          el('strong', { text: '대한민국' }),
          el('span', { text: '2026 월드 챔피언' }),
        ]),
      ]),
      el('div', { class: 'championship-scoreboard' }, [
        el('div', { class: 'championship-team' }, [
          CountryFlag({ teamId: 'KOR', size: 'medium' }),
          el('span', { text: '대한민국' }),
        ]),
        el('strong', { class: 'championship-score', text: '2 : 0' }),
        el('div', { class: 'championship-team' }, [
          CountryFlag({ teamId: opponentTeamId, size: 'medium' }),
          el('span', { text: countries[opponentTeamId]?.nameKo ?? opponentTeamId }),
        ]),
      ]),
      el('p', { class: 'championship-copy' }, [
        el('span', { text: '조별리그 탈락의 운명을 되돌리고' }),
        el('strong', { text: '대한민국이 세계 정상에 올랐습니다.' }),
      ]),
      managerLine,
      el('div', { class: 'championship-actions' }, [recordBtn, replayBtn]),
    ]),
  ]);

  function clearEffects() {
    window.clearTimeout(effectTimer);
    window.cancelAnimationFrame(animationFrame);
    effectTimer = 0;
    animationFrame = 0;
    confetti.replaceChildren();
    fireworks.replaceChildren();
    dialog.classList.remove('is-celebrating');
  }

  function replay() {
    clearEffects();
    confetti.replaceChildren(...confettiPieces());
    fireworks.replaceChildren(...fireworkPieces());
    animationFrame = window.requestAnimationFrame(() => dialog.classList.add('is-celebrating'));
    effectTimer = window.setTimeout(clearEffects, 6000);
  }

  function openDemo() {
    if (!dialog.isConnected) document.body.append(dialog);
    if (!dialog.open) dialog.showModal();
    dialog.classList.add('is-visible');
    replay();
    recordBtn.focus();
  }

  const trapFocus = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === recordBtn) {
      event.preventDefault();
      replayBtn.focus();
    } else if (!event.shiftKey && document.activeElement === replayBtn) {
      event.preventDefault();
      recordBtn.focus();
    }
  };
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('keydown', trapFocus);

  root.append(el('section', { class: 'screen championship-demo-screen' }, [
    el('p', { class: 'championship-demo-screen__eyebrow', text: 'TEMPORARY PRESENTATION TOOL' }),
    el('h1', { text: '우승 연출 데모' }),
    el('p', { text: '실제 대회 기록을 변경하지 않고 Match 104 우승 화면을 확인합니다.' }),
    el('button', { class: 'primary', type: 'button', text: '우승 연출 보기 →', onclick: openDemo }),
  ]));

  const openTimer = window.setTimeout(openDemo, 250);
  return () => {
    window.clearTimeout(openTimer);
    clearEffects();
    dialog.removeEventListener('keydown', trapFocus);
    dialog.remove();
  };
}
