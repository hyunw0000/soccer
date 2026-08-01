import './roster.css';
import { el } from '../../shared/index.js';
import { state, setState } from '../../app/public.js';
import { PLAYERS, byPos, overall } from '../data/index.js';

const POS_LABEL = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' };
const MIN_POOL = 14;
const MAX_POOL = 23;

/** 2단계: 소집 명단 + 주장 선택 */
export default function squadScreen(root, ctx) {
  let pool = new Set(state.poolIds);
  let captainId = state.captainId;
  let filter = 'ALL';

  const counter = el('span', { class: 'counter' });
  const warn = el('p', { class: 'error' });
  const listWrap = el('div', { class: 'roster-groups' });

  const next = el('button', {
    class: 'primary',
    text: '전술 짜러 가기 →',
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
      ctx.navigate('tactics');
    },
  });

  function refreshCounter() {
    counter.textContent = `${pool.size} / ${MAX_POOL}명`;
    counter.classList.toggle('warn', pool.size < MIN_POOL);
  }

  function toggle(p) {
    if (pool.has(p.id)) {
      pool.delete(p.id);
      if (captainId === p.id) captainId = [...pool][0] ?? null;
    } else {
      if (pool.size >= MAX_POOL) {
        warn.textContent = `최대 ${MAX_POOL}명까지 소집할 수 있습니다.`;
        return;
      }
      pool.add(p.id);
    }
    warn.textContent = '';
    render();
  }

  function card(p) {
    const on = pool.has(p.id);
    const isCap = captainId === p.id;
    return el(
      'button',
      {
        class: `pcard${on ? ' on' : ''}${isCap ? ' captain' : ''}`,
        type: 'button',
        onclick: () => toggle(p),
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
            if (!pool.has(p.id)) {
              if (pool.size >= MAX_POOL) {
                warn.textContent = `최대 ${MAX_POOL}명까지 소집할 수 있습니다.`;
                return;
              }
              pool.add(p.id);
            }
            captainId = p.id;
            warn.textContent = '';
            render();
          },
        }),
      ]
    );
  }

  /** 그룹 제목 + 카드 그리드(또는 빈 안내문)를 만든다. 소집 명단/후보 구분 표시에 쓰인다. */
  function groupSection(title, list, emptyText) {
    return el('section', { class: 'roster-group' }, [
      el('h3', { class: 'h3', text: title }),
      list.length
        ? el('div', { class: 'player-grid' }, list.map(card))
        : el('p', { class: 'lead', text: emptyText }),
    ]);
  }

  function render() {
    refreshCounter();
    const list = filter === 'ALL' ? PLAYERS : byPos(filter);
    const byOverall = (a, b) => overall(b) - overall(a);
    const called = list.filter((p) => pool.has(p.id)).sort(byOverall);
    const candidates = list.filter((p) => !pool.has(p.id)).sort(byOverall);
    listWrap.replaceChildren(
      groupSection(`소집 명단 (${called.length}/${MAX_POOL})`, called, '아직 소집한 선수가 없습니다.'),
      groupSection(`후보 선수 (${candidates.length}명)`, candidates, '해당 조건의 후보 선수가 없습니다.')
    );
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

  root.append(
    el('div', { class: 'screen page' }, [
      el('header', { class: 'topbar' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow', text: 'STEP 2 / 3' }),
          el('h2', { class: 'h2', text: '소집 명단과 주장을 정하세요' }),
        ]),
        el('div', { class: 'topbar-right' }, [
          counter,
          el('button', { class: 'ghost', text: '← 이름 다시', onclick: () => ctx.navigate('manager') }),
          next,
        ]),
      ]),
      el('p', { class: 'lead' }, [
        `감독 `,
        el('b', { text: state.managerName || '이름 없음' }),
        ` — 카드를 눌러 소집/제외(최대 ${MAX_POOL}명, 가득 차면 먼저 한 명을 빼야 합니다), ☆를 눌러 주장을 지정합니다.`,
      ]),
      filters,
      warn,
      listWrap,
    ])
  );

  render();
}
