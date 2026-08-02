import './roster.css';
import { el } from '../../shared/index.js';
import { state, setState } from '../../app/public.js';
import { PLAYERS, byPos, overall } from '../data/index.js';

const POS_LABEL = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' };
const MIN_POOL = 14;
const MAX_POOL = 26;

/**
 * 2단계: 소집 명단 + 주장 선택.
 * 왼쪽(소집 명단) / 오른쪽(후보)을 두고, 가운데 화살표로 선택한 선수를 옮긴다.
 * 카드 클릭은 "선택"일 뿐이고 실제 이동은 화살표(또는 더블클릭)로만 일어난다.
 */
export default function squadScreen(root, ctx) {
  let pool = new Set(state.poolIds);
  let captainId = state.captainId;
  let filter = 'ALL';
  /** 화살표로 옮길 대상. 좌/우 목록별로 따로 들고 있다가 이동 후 비운다. */
  const picked = { called: new Set(), bench: new Set() };

  const counter = el('span', { class: 'counter' });
  const warn = el('p', { class: 'error' });

  const calledTitle = el('h3', { class: 'h3' });
  const benchTitle = el('h3', { class: 'h3' });
  const calledBody = el('div', { class: 'transfer-body' });
  const benchBody = el('div', { class: 'transfer-body' });

  const toCalled = el('button', {
    class: 'move-btn',
    type: 'button',
    title: '선택한 후보를 소집 명단으로',
    'aria-label': '선택한 후보를 소집 명단으로 이동',
    onclick: () => move('bench'),
  }, [el('span', { class: 'move-arrow', text: '◀' }), el('span', { class: 'move-label', text: '소집' })]);

  const toBench = el('button', {
    class: 'move-btn',
    type: 'button',
    title: '선택한 선수를 명단에서 제외',
    'aria-label': '선택한 선수를 후보로 이동',
    onclick: () => move('called'),
  }, [el('span', { class: 'move-arrow', text: '▶' }), el('span', { class: 'move-label', text: '제외' })]);

  const next = el('button', {
    class: 'primary',
    text: '다음 →',
    onclick: () => {
      if (pool.size < MIN_POOL) {
        warn.textContent = `최소 ${MIN_POOL}명은 뽑아야 합니다. (현재 ${pool.size}명)`;
        return;
      }
      if (!pool.has(captainId)) {
        warn.textContent = '주장은 소집 명단 안에서 골라야 합니다.';
        return;
      }
      const needs = { GK: 1, DF: 3, MF: 3, FW: 2 };
      for (const [pos, n] of Object.entries(needs)) {
        const have = [...pool].filter((id) => PLAYERS.find((p) => p.id === id)?.pos === pos).length;
        if (have < n) {
          warn.textContent = `${POS_LABEL[pos]}가 부족합니다. 최소 ${n}명 필요 (현재 ${have}명)`;
          return;
        }
      }
      setState({ poolIds: [...pool], captainId });
      ctx.navigate('lineup');
    },
  });

  function refreshCounter() {
    counter.textContent = `${pool.size} / ${MAX_POOL}명`;
    counter.classList.toggle('warn', pool.size < MIN_POOL);
  }

  /** 소집 명단에 넣는다. 정원이 차면 false. */
  function call(id) {
    if (pool.has(id)) return true;
    if (pool.size >= MAX_POOL) return false;
    pool.add(id);
    return true;
  }

  /** 명단에서 뺀다. 주장이 빠지면 남은 선수 중 첫 명으로 넘긴다. */
  function drop(id) {
    pool.delete(id);
    if (captainId === id) captainId = [...pool][0] ?? null;
  }

  /** @param {'called'|'bench'} from 선택된 쪽을 반대편으로 옮긴다 */
  function move(from) {
    const ids = [...picked[from]];
    if (!ids.length) {
      warn.textContent = from === 'bench' ? '옮길 후보를 먼저 선택하세요.' : '제외할 선수를 먼저 선택하세요.';
      return;
    }
    let full = 0;
    for (const id of ids) {
      if (from === 'bench') {
        if (!call(id)) full++;
      } else {
        drop(id);
      }
    }
    picked[from].clear();
    warn.textContent = full ? `최대 ${MAX_POOL}명까지 소집할 수 있어 ${full}명은 옮기지 못했습니다.` : '';
    render();
  }

  function togglePick(side, id) {
    const set = picked[side];
    if (set.has(id)) set.delete(id);
    else set.add(id);
    warn.textContent = '';
    render();
  }

  /** @param {'called'|'bench'} side 카드가 놓인 목록 */
  function card(p, side) {
    const sel = picked[side].has(p.id);
    const isCap = captainId === p.id;
    return el(
      'button',
      {
        class: `pcard${side === 'called' ? ' on' : ''}${sel ? ' sel' : ''}${isCap ? ' captain' : ''}`,
        type: 'button',
        'aria-pressed': sel,
        onclick: () => togglePick(side, p.id),
        // 한 명만 옮길 때는 더블클릭이 빠르다
        ondblclick: () => {
          picked[side].clear();
          picked[side].add(p.id);
          move(side);
        },
      },
      [
        el('span', { class: `pos ${p.pos}`, text: p.detail || p.pos }),
        el('span', { class: 'pname', text: p.name }),
        el('span', { class: 'pclub', text: p.club }),
        el('span', { class: 'povr', text: String(overall(p)) }),
        p.squad2026 ? el('span', { class: 'tag', text: '26' }) : null,
        el('span', {
          class: 'cap-btn',
          title: '주장으로 지정',
          text: isCap ? '★' : '☆',
          onclick: (e) => {
            e.stopPropagation();
            if (!call(p.id)) {
              warn.textContent = `최대 ${MAX_POOL}명까지 소집할 수 있습니다.`;
              return;
            }
            captainId = p.id;
            warn.textContent = '';
            render();
          },
        }),
      ]
    );
  }

  /** 스크롤 위치를 지키면서 목록 본문만 갈아끼운다 */
  function fill(body, list, side, emptyText) {
    const top = body.scrollTop;
    body.replaceChildren(
      list.length
        ? el('div', { class: 'player-grid' }, list.map((p) => card(p, side)))
        : el('p', { class: 'lead', text: emptyText })
    );
    body.scrollTop = top;
  }

  function render() {
    refreshCounter();
    const list = filter === 'ALL' ? PLAYERS : byPos(filter);
    const byOverall = (a, b) => overall(b) - overall(a);
    const called = list.filter((p) => pool.has(p.id)).sort(byOverall);
    const bench = list.filter((p) => !pool.has(p.id)).sort(byOverall);

    // 필터에 걸러진 선수도 선택 상태로 남으면 헷갈리므로 보이는 목록 기준으로 정리한다
    const visible = new Set(list.map((p) => p.id));
    for (const side of ['called', 'bench']) {
      for (const id of picked[side]) {
        if (!visible.has(id) || pool.has(id) !== (side === 'called')) picked[side].delete(id);
      }
    }

    calledTitle.textContent = `소집 명단 ${pool.size}/${MAX_POOL}${
      picked.called.size ? ` · 선택 ${picked.called.size}명` : ''
    }`;
    benchTitle.textContent = `후보 선수 ${bench.length}명${picked.bench.size ? ` · 선택 ${picked.bench.size}명` : ''}`;

    fill(calledBody, called, 'called', '아직 소집한 선수가 없습니다.');
    fill(benchBody, bench, 'bench', '해당 조건의 후보 선수가 없습니다.');

    // 정원이 찼을 때도 버튼은 살려둔다 — 눌러야 "왜 안 되는지" 안내가 뜬다
    toCalled.disabled = picked.bench.size === 0;
    toBench.disabled = picked.called.size === 0;
  }

  const filters = el(
    'div',
    { class: 'chips' },
    ['ALL', 'GK', 'DF', 'MF', 'FW'].map((f) =>
      el('button', {
        class: `chip${filter === f ? ' on' : ''}`,
        text: f === 'ALL' ? '전체' : POS_LABEL[f],
        onclick: (e) => {
          filter = f;
          e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
          e.currentTarget.classList.add('on');
          render();
        },
      })
    )
  );

  const panel = (title, body, cls) =>
    el('section', { class: `transfer-panel ${cls}` }, [title, body]);

  root.append(
    el('div', { class: 'screen page' }, [
      el('header', { class: 'topbar' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow', text: 'KOREA REPUBLIC · NATIONAL SQUAD' }),
          el('h2', { class: 'h2', text: '역사를 바꿀 26인' }),
        ]),
        el('div', { class: 'topbar-right' }, [
          counter,
          el('button', { class: 'ghost', text: '← 이전', onclick: () => ctx.navigate('tournament') }),
          next,
        ]),
      ]),
      el('p', { class: 'lead' }, [
        `대한민국의 운명을 함께할 선수단입니다. 감독 `,
        el('b', { text: state.managerName || '이름 없음' }),
        ` — 선수를 골라 가운데 화살표로 옮깁니다(더블클릭하면 바로 이동). 최대 ${MAX_POOL}명, ☆를 눌러 주장을 지정합니다.`,
      ]),
      filters,
      warn,
      el('div', { class: 'transfer' }, [
        panel(calledTitle, calledBody, 'is-called'),
        el('div', { class: 'transfer-arrows' }, [toCalled, toBench]),
        panel(benchTitle, benchBody, 'is-bench'),
      ]),
    ])
  );

  render();
}
