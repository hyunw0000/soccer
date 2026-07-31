import { el } from '../ui/dom.js';
import { state } from '../state.js';
import { PARAMS } from '../engine/params.js';
import { Sim } from '../engine/sim.js';
import { RewindBuffer } from '../engine/rewind.js';
import { createMatchView } from '../render3d/matchView.js';
import { CAM_MODES } from '../render3d/cameraRig.js';
import { findById, toSimMeta } from '../data/players.js';

const REWIND_SECONDS = 8;
const REWIND_LIMIT = 3; // 감독의 '되감기'는 유한한 자원이다 — 이 서비스의 규칙

export default function matchScreen(root, ctx, params = {}) {
  const lineup = (params.lineupIds ?? state.poolIds.slice(0, 11)).map(findById).filter(Boolean).map(toSimMeta);

  const sim = new Sim({
    lineup,
    formation: state.formation,
    tactics: state.tactics,
    oppFormation: state.oppFormation,
  });
  const rewind = new RewindBuffer();

  const stage = el('div', { class: 'stage' });
  const scoreEl = el('div', { class: 'score', text: 'KOR 0 : 0 WLD' });
  const clockEl = el('b', { text: "0'" });
  const possEl = el('b', { text: '-' });
  const camEl = el('b', { text: CAM_MODES.broadcast });
  const fpsEl = el('b', { text: '-' });
  const rewindEl = el('b', { text: `${REWIND_LIMIT}회` });
  const feed = el('ul', { class: 'feed' });

  let paused = false;
  let rewindsLeft = REWIND_LIMIT;
  let acc = 0;
  let last = performance.now();
  let fpsT = 0;
  let fpsN = 0;
  let raf = 0;
  let renderedEvents = 0;

  // 렌더러는 stage가 DOM에 붙은 뒤에 만든다.
  // 붙기 전에 만들면 clientWidth/Height가 0이라 캔버스가 0x0으로 생성돼 화면이 검게 남는다.
  let view = null;

  const pauseBtn = el('button', { class: 'ctl', text: '⏸ 일시정지', onclick: () => setPaused(!paused) });
  const rewindBtn = el('button', {
    class: 'ctl warn',
    text: `↶ ${REWIND_SECONDS}초 되감기`,
    onclick: doRewind,
  });

  function setPaused(v) {
    paused = v;
    pauseBtn.textContent = paused ? '▶ 재개' : '⏸ 일시정지';
    pauseBtn.classList.toggle('on', paused);
    banner.classList.toggle('show', paused);
  }

  function doRewind() {
    if (rewindsLeft <= 0) return;
    const snap = rewind.rewind(REWIND_SECONDS);
    if (!snap) return;
    sim.restore(snap);
    rewindsLeft--;
    rewindEl.textContent = `${rewindsLeft}회`;
    rewindBtn.disabled = rewindsLeft <= 0;
    renderedEvents = Math.min(renderedEvents, sim.events.length);
    feed.replaceChildren(...[...sim.events].map(eventNode));
    view.sync(0);
    setPaused(true);
  }

  const banner = el('div', { class: 'banner' }, [
    el('b', { text: '일시정지 — 지금 지시를 바꿀 수 있습니다' }),
    el('span', { text: '되감은 시점부터 새 전술로 경기가 다시 흘러갑니다.' }),
  ]);

  // 경기 중 실시간 전술 변경
  const liveTactics = ['lineHeight', 'pressing', 'tempo', 'width'].map((key) => {
    const label = { lineHeight: '라인', pressing: '압박', tempo: '템포', width: '폭' }[key];
    return el('label', { class: 'live-slider' }, [
      el('span', { text: label }),
      el('input', {
        type: 'range',
        min: '0',
        max: '100',
        value: String(Math.round(sim.tactics[key] * 100)),
        oninput: (e) => sim.applyTactics({ [key]: Number(e.target.value) / 100 }),
      }),
    ]);
  });

  const camButtons = Object.entries(CAM_MODES).map(([k, label]) =>
    el('button', {
      class: `ctl${k === 'broadcast' ? ' on' : ''}`,
      text: label,
      onclick: (e) => {
        view.setCam(k);
        camEl.textContent = label;
        e.currentTarget.parentElement.querySelectorAll('.ctl').forEach((b) => b.classList.remove('on'));
        e.currentTarget.classList.add('on');
      },
    })
  );

  function eventNode(ev) {
    return el('li', { class: `ev ${ev.team}` }, [
      el('span', { class: 'evmin', text: `${ev.minute}'` }),
      el('span', { text: ev.text }),
    ]);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const real = (now - last) / 1000;
    last = now;

    if (!paused) {
      acc += Math.min(real, 0.1);
      while (acc >= PARAMS.dt) {
        sim.step();
        rewind.maybeRecord(sim);
        acc -= PARAMS.dt;
      }
      view.sync(real);
    }
    view.render();

    scoreEl.textContent = `KOR ${sim.score.home} : ${sim.score.away} WLD`;
    clockEl.textContent = `${sim.matchMinute}'`;
    const o = sim.playerByKey(sim.ball.ownerKey);
    possEl.textContent = o ? `${o.team === 'home' ? 'KOR' : 'WLD'} #${o.num} ${o.name}` : '경합 중';

    while (renderedEvents < sim.events.length) feed.prepend(eventNode(sim.events[renderedEvents++]));

    fpsN++;
    fpsT += real;
    if (fpsT >= 0.5) {
      fpsEl.textContent = String(Math.round(fpsN / fpsT));
      fpsN = 0;
      fpsT = 0;
    }
  }

  const onKey = (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      setPaused(!paused);
    }
    if (e.key.toLowerCase() === 'r') doRewind();
  };
  window.addEventListener('keydown', onKey);

  root.append(
    el('div', { class: 'screen match' }, [
      stage,
      banner,
      el('div', { class: 'hud' }, [
        scoreEl,
        el('div', { class: 'row' }, [el('span', { text: '경기 시간' }), clockEl]),
        el('div', { class: 'row' }, [el('span', { text: '공 소유' }), possEl]),
        el('div', { class: 'row' }, [el('span', { text: '카메라' }), camEl]),
        el('div', { class: 'row' }, [el('span', { text: '남은 되감기' }), rewindEl]),
        el('div', { class: 'row' }, [el('span', { text: 'FPS' }), fpsEl]),
      ]),
      el('div', { class: 'sidepanel' }, [
        el('b', { class: 'panel-title', text: `${state.managerName || '감독'}의 지시` }),
        ...liveTactics,
        el('b', { class: 'panel-title', text: '경기 기록' }),
        feed,
      ]),
      el('div', { class: 'controls' }, [
        ...camButtons,
        el('span', { class: 'sep' }),
        pauseBtn,
        rewindBtn,
        el('button', { class: 'ctl', text: '↺ 킥오프', onclick: () => { sim.kickoff(); view.sync(0); } }),
        el('button', { class: 'ctl', text: '전술 변경 ↩', onclick: () => ctx.go('tactics') }),
      ]),
      el('p', { class: 'hint' }, [
        el('span', { text: '탑뷰에서 드래그=회전 / 휠=줌 · Space=일시정지 · R=되감기' }),
      ]),
    ])
  );

  view = createMatchView(stage, sim, findById(state.captainId)?.num ?? null);
  view.sync(0);
  last = performance.now();
  raf = requestAnimationFrame(loop);

  // 화면을 떠날 때 반드시 루프와 WebGL 컨텍스트를 정리한다
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    view.dispose();
  };
}
