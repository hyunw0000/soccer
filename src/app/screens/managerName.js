import { el } from '../../shared/index.js';
import { resetState, state, setState } from '../public.js';
import './opening.css';

export const OPENING_MATCH = Object.freeze({
  competition: 'WORLD CHAMPIONSHIP 2026',
  stage: 'GROUP STAGE · MATCHDAY 3',
  venue: 'NORTH AMERICA · STADIUM 07',
  home: { code: 'RSA', name: '남아프리카공화국', score: 1 },
  away: { code: 'KOR', name: '대한민국', score: 0 },
});

const STAGES = Object.freeze({
  DEFEAT: 'defeat',
  OFFER: 'offer',
  REWINDING: 'rewinding',
  MANAGER_SETUP: 'managerSetup',
  MISSION: 'mission',
});

const isReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function flag(type) {
  return el('span', { class: `op-flag op-flag--${type}`, 'aria-hidden': 'true' });
}

function teamRow(side, team) {
  return el('div', { class: `op-team op-team--${side}` }, [
    flag(side === 'home' ? 'rsa' : 'kor'),
    el('div', { class: 'op-team__name' }, [
      el('b', { text: team.code }),
      el('span', { text: team.name }),
    ]),
    el('strong', { class: 'op-score', text: team.score }),
  ]);
}

function scoreboard(match) {
  return el('section', { class: 'op-scoreboard', 'aria-label': `${match.home.name} ${match.home.score} 대 ${match.away.score} ${match.away.name}` }, [
    el('div', { class: 'op-scoreboard__meta' }, [
      el('span', { text: match.stage }),
      el('b', { class: 'op-clock', text: '90:00' }),
      el('span', { text: match.venue }),
    ]),
    el('div', { class: 'op-final-tag' }, [
      el('i', { 'aria-hidden': 'true' }),
      el('strong', { text: '경기 종료' }),
      el('i', { 'aria-hidden': 'true' }),
    ]),
    el('div', { class: 'op-scoreboard__teams' }, [
      teamRow('home', match.home),
      el('span', { class: 'op-score-divider', text: ':' }),
      teamRow('away', match.away),
    ]),
  ]);
}

function stadiumScene() {
  return el('div', { class: 'op-stadium', 'aria-hidden': 'true' }, [
    el('div', { class: 'op-floodlights' }),
    el('div', { class: 'op-stands' }),
    el('div', { class: 'op-pitch' }),
    el('div', { class: 'op-players' }, [
      el('i', { class: 'op-player op-player--1' }),
      el('i', { class: 'op-player op-player--2' }),
      el('i', { class: 'op-player op-player--3' }),
    ]),
  ]);
}

function resetButton(onReset) {
  return el('button', {
    class: 'op-reset',
    type: 'button',
    text: '오프닝 다시 보기',
    'aria-label': '게임 진행 상태를 초기화하고 오프닝 다시 보기',
    onclick: onReset,
  });
}

/** 2026 대회 탈락 직후부터 시작하는 게임 오프닝. */
export default function managerNameScreen(root, ctx) {
  let stage = STAGES.DEFEAT;
  let managerName = state.managerName;
  let stageTimer = null;
  let rewindTimer = null;
  let destroyed = false;

  const screen = el('main', {
    class: 'screen op-screen',
    'data-stage': stage,
    'aria-live': 'polite',
  });

  const clearTimers = () => {
    window.clearTimeout(stageTimer);
    window.clearInterval(rewindTimer);
  };

  const render = () => {
    if (destroyed) return;
    clearTimers();
    screen.dataset.stage = stage;
    screen.replaceChildren();

    const onReset = () => {
      resetState();
      managerName = '';
      stage = STAGES.DEFEAT;
      render();
    };

    const chrome = el('header', { class: 'op-header' }, [
      el('a', { class: 'op-brand', href: '/', 'aria-label': 'REWIND FC 홈' }, [
        el('span', { text: 'REWIND' }),
        el('b', { text: 'FC' }),
      ]),
      el('div', { class: 'op-tournament' }, [
        el('span', { text: 'GLOBAL FOOTBALL' }),
        el('strong', { text: OPENING_MATCH.competition }),
      ]),
      resetButton(onReset),
    ]);

    const progress = el('div', { class: 'op-progress', 'aria-label': '오프닝 진행 단계' }, [
      ...['경기 종료', '결정', '되감기', '감독 등록', '첫 임무'].map((label, index) =>
        el('span', { class: index <= Object.values(STAGES).indexOf(stage) ? 'is-active' : '', text: label })),
    ]);

    const shell = el('div', { class: 'op-shell' }, [stadiumScene(), chrome, progress]);
    screen.append(shell);

    if (stage === STAGES.DEFEAT) {
      const content = el('div', { class: 'op-content op-content--defeat' }, [
        el('p', { class: 'op-kicker', text: 'FULL TIME · GROUP STAGE EXIT' }),
        scoreboard(OPENING_MATCH),
        el('div', { class: 'op-eliminated' }, [
          el('span', { text: '대한민국' }),
          el('h1', { text: '32강 진출 실패' }),
          el('p', { text: '모든 경우의 수가 끝났습니다. 대한민국의 2026년 여정이 여기서 멈춥니다.' }),
        ]),
      ]);
      shell.append(content);
      stageTimer = window.setTimeout(() => {
        stage = STAGES.OFFER;
        render();
      }, isReducedMotion() ? 900 : 3300);
    }

    if (stage === STAGES.OFFER) {
      const rewindButton = el('button', {
        class: 'op-primary op-primary--rewind',
        type: 'button',
        'aria-label': '시간을 되감아 대한민국의 감독이 되기',
        onclick: () => {
          stage = STAGES.REWINDING;
          render();
        },
      }, [el('span', { 'aria-hidden': 'true', text: '«' }), '시간을 되감기']);

      shell.append(el('section', { class: 'op-content op-offer', 'aria-labelledby': 'offer-title' }, [
        el('p', { class: 'op-kicker', text: 'ONE MORE CHANCE' }),
        el('h1', { id: 'offer-title' }, [
          el('span', { text: '대한민국의 감독이 되어' }),
          el('strong', { text: '새 역사를 쓰시겠습니까?' }),
        ]),
        el('p', { text: '끝난 경기를 되돌릴 단 한 번의 선택.' }),
        rewindButton,
      ]));
      window.requestAnimationFrame(() => rewindButton.focus({ preventScroll: true }));
    }

    if (stage === STAGES.REWINDING) {
      const clock = el('strong', { class: 'op-rewind-clock', text: '90:00' });
      const homeScore = el('b', { text: OPENING_MATCH.home.score });
      const awayScore = el('b', { text: OPENING_MATCH.away.score });
      shell.append(el('section', { class: 'op-content op-rewinding', 'aria-label': '경기 시간을 되감는 중' }, [
        el('p', { class: 'op-kicker', text: 'TIMELINE OVERRIDE' }),
        el('div', { class: 'op-rewind-icon', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i')]),
        clock,
        el('div', { class: 'op-rewind-score' }, [
          el('span', { text: 'RSA' }), homeScore, el('i', { text: ':' }), awayScore, el('span', { text: 'KOR' }),
        ]),
        el('h1', { text: '결과를 되돌리는 중' }),
        el('div', { class: 'op-rewind-track' }, [el('i')]),
        el('p', { text: '운명이 갈라지기 전으로 돌아갑니다.' }),
      ]));

      const duration = isReducedMotion() ? 650 : 2600;
      const startedAt = performance.now();
      rewindTimer = window.setInterval(() => {
        const progressValue = Math.min(1, (performance.now() - startedAt) / duration);
        const seconds = Math.round(5400 * (1 - progressValue));
        clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        if (progressValue > 0.38) homeScore.textContent = '1';
        if (progressValue > 0.68) {
          homeScore.textContent = '0';
          awayScore.textContent = '0';
        }
      }, 40);
      stageTimer = window.setTimeout(() => {
        stage = STAGES.MANAGER_SETUP;
        render();
      }, duration);
    }

    if (stage === STAGES.MANAGER_SETUP) {
      const input = el('input', {
        id: 'manager-name',
        class: 'op-input',
        type: 'text',
        maxlength: 20,
        value: managerName,
        placeholder: '감독 이름',
        autocomplete: 'name',
        spellcheck: 'false',
        'aria-label': '대한민국 대표팀 감독 이름',
        'aria-describedby': 'manager-help manager-error',
      });
      const error = el('p', { id: 'manager-error', class: 'op-error', role: 'alert' });
      const submit = () => {
        const name = input.value.trim();
        if (!name) {
          error.textContent = '감독 이름을 한 글자 이상 입력해 주세요.';
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        managerName = name;
        setState({ managerName: name, hasCompletedSetup: true });
        stage = STAGES.MISSION;
        render();
      };
      input.addEventListener('input', () => {
        error.textContent = '';
        input.removeAttribute('aria-invalid');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') submit();
      });

      shell.append(el('section', { class: 'op-content op-setup', 'aria-labelledby': 'setup-title' }, [
        el('p', { class: 'op-kicker', text: 'NEW TIMELINE · 00:00' }),
        el('h1', { id: 'setup-title' }, [
          el('span', { text: '역사를 바꿀' }),
          el('strong', { text: '새로운 감독' }),
        ]),
        el('p', { id: 'manager-help', class: 'op-lead', text: '대한민국 대표팀을 이끌 감독의 이름을 입력하세요.' }),
        el('div', { class: 'op-form' }, [
          el('label', { for: 'manager-name', text: '감독 이름' }),
          el('div', { class: 'op-input-wrap' }, [input, el('span', { text: 'MANAGER' })]),
          error,
          el('button', { class: 'op-primary', type: 'button', text: '감독으로 부임하기', onclick: submit }),
        ]),
      ]));
      window.requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }

    if (stage === STAGES.MISSION) {
      const prepare = el('button', {
        class: 'op-primary',
        type: 'button',
        text: '남아공전 준비하기',
        'aria-label': '남아프리카공화국전 전술 준비 화면으로 이동',
        onclick: () => ctx.navigate('/tactics'),
      });
      shell.append(el('section', { class: 'op-content op-mission', 'aria-labelledby': 'mission-title' }, [
        el('div', { class: 'op-badge', text: 'KFA' }),
        el('p', { class: 'op-kicker', text: 'APPOINTMENT CONFIRMED' }),
        el('h1', { id: 'mission-title' }, [
          el('strong', { text: managerName }),
          el('span', { text: ' 감독님의 첫 번째 임무입니다.' }),
        ]),
        el('p', { class: 'op-lead', text: '대한민국의 운명이 걸린 남아프리카공화국전을 준비하십시오.' }),
        el('article', { class: 'op-fixture' }, [
          el('span', { text: 'GROUP STAGE · MATCHDAY 3' }),
          el('div', {}, [flag('kor'), el('b', { text: 'KOR' }), el('i', { text: 'VS' }), el('b', { text: 'RSA' }), flag('rsa')]),
          el('p', { text: '킥오프까지 D-1 · 전술 브리핑 대기 중' }),
        ]),
        prepare,
      ]));
      window.requestAnimationFrame(() => prepare.focus({ preventScroll: true }));
    }
  };

  root.append(screen);
  render();
  return () => {
    destroyed = true;
    clearTimers();
  };
}
