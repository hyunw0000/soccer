import { el } from '../ui/dom.js';
import { state, setState } from '../state.js';
import { FORMATIONS, FORMATION_KEYS, positionNeeds, slotPosition } from '../engine/formations.js';
import { FIELD } from '../engine/params.js';
import { autoLineup, findById, overall } from '../data/players.js';

const SLIDERS = [
  { key: 'lineHeight', label: '수비 라인', lo: '내려선다', hi: '끌어올린다' },
  { key: 'pressing', label: '압박 강도', lo: '지역 방어', hi: '전방 압박' },
  { key: 'tempo', label: '공격 템포', lo: '점유·안정', hi: '직선·속공' },
  { key: 'width', label: '진영 폭', lo: '좁게', hi: '넓게' },
];

/** 3단계: 상대 전술을 보고 포메이션·라인업·전술을 정한다 */
export default function tacticsScreen(root, ctx) {
  let formation = FORMATIONS[state.formation] ? state.formation : '4-3-3';
  let tactics = { ...state.tactics };
  let lineup = autoLineup(state.poolIds, positionNeeds(formation)); // 선수 객체 11

  const board = el('div', { class: 'board' });
  const slotList = el('div', { class: 'slot-list' });
  const desc = el('p', { class: 'lead small' });

  function rebuildLineup() {
    lineup = autoLineup(state.poolIds, positionNeeds(formation));
  }

  function drawBoard() {
    desc.textContent = FORMATIONS[formation].desc;
    const nodes = lineup.map((p, i) => {
      const s = slotPosition(formation, i, 'home', tactics.width);
      // 월드 좌표 → 보드 퍼센트 (홈은 왼쪽 진영이므로 x를 그대로 쓰되 0~100으로)
      const left = ((s.x + FIELD.L / 2) / FIELD.L) * 100;
      const top = ((s.z + FIELD.W / 2) / FIELD.W) * 100;
      return el(
        'div',
        {
          class: `dot ${s.role}${p.id === state.captainId ? ' cap' : ''}`,
          style: { left: `${left}%`, top: `${top}%` },
          title: `${p.name} (${p.detail || p.pos}) OVR ${overall(p)}`,
        },
        [el('b', { text: String(p.num) }), el('span', { text: p.name })]
      );
    });
    board.replaceChildren(...nodes);
  }

  function drawSlots() {
    const needs = positionNeeds(formation);
    const roleOf = FORMATIONS[formation].slots.map((s) => s.role);
    slotList.replaceChildren(
      ...lineup.map((p, i) => {
        const role = roleOf[i];
        const options = state.poolIds
          .map(findById)
          .filter(Boolean)
          .sort((a, b) => Number(b.pos === role) - Number(a.pos === role) || overall(b) - overall(a));
        const sel = el('select', {
          class: 'slot-select',
          onchange: (e) => {
            const picked = findById(e.target.value);
            if (!picked) return;
            const dup = lineup.findIndex((x) => x.id === picked.id);
            if (dup >= 0 && dup !== i) lineup[dup] = p; // 자리 맞교환
            lineup[i] = picked;
            drawBoard();
            drawSlots();
          },
        });
        for (const o of options) {
          sel.append(
            el('option', {
              value: o.id,
              selected: o.id === p.id,
              text: `${o.pos === role ? '' : '△ '}${o.name} · ${o.detail || o.pos} · ${overall(o)}`,
            })
          );
        }
        return el('label', { class: 'slot-row' }, [el('span', { class: `pos ${role}`, text: role }), sel]);
      })
    );
    void needs;
  }

  const sliderNodes = SLIDERS.map((s) => {
    const out = el('output', { class: 'sval', text: pct(tactics[s.key]) });
    const input = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      value: String(Math.round(tactics[s.key] * 100)),
      oninput: (e) => {
        tactics[s.key] = Number(e.target.value) / 100;
        out.textContent = pct(tactics[s.key]);
        if (s.key === 'width') drawBoard();
      },
    });
    return el('div', { class: 'slider' }, [
      el('div', { class: 'slider-head' }, [el('b', { text: s.label }), out]),
      input,
      el('div', { class: 'slider-ends' }, [el('span', { text: s.lo }), el('span', { text: s.hi })]),
    ]);
  });

  const formChips = el(
    'div',
    { class: 'chips' },
    FORMATION_KEYS.map((k) =>
      el('button', {
        class: `chip${k === formation ? ' on' : ''}`,
        text: k,
        onclick: (e) => {
          formation = k;
          e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
          e.currentTarget.classList.add('on');
          rebuildLineup();
          drawBoard();
          drawSlots();
        },
      })
    )
  );

  root.append(
    el('div', { class: 'screen page' }, [
      el('header', { class: 'topbar' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow', text: 'STEP 3 / 3' }),
          el('h2', { class: 'h2', text: '상대를 보고 전술을 짜세요' }),
        ]),
        el('div', { class: 'topbar-right' }, [
          el('button', { class: 'ghost', text: '← 명단 수정', onclick: () => ctx.go('squad') }),
          el('button', {
            class: 'primary',
            text: '킥오프 ⚽',
            onclick: () => {
              setState({ formation, tactics });
              ctx.go('match', { lineupIds: lineup.map((p) => p.id) });
            },
          }),
        ]),
      ]),
      el('div', { class: 'scout' }, [
        el('b', { text: '상대 스카우팅 리포트' }),
        el('span', { text: `WORLD XI · ${state.oppFormation} · 두 줄 블록 후 측면 역습` }),
      ]),
      el('div', { class: 'tactics-grid' }, [
        el('section', { class: 'panel' }, [
          el('h3', { class: 'h3', text: '포메이션' }),
          formChips,
          desc,
          board,
        ]),
        el('section', { class: 'panel' }, [
          el('h3', { class: 'h3', text: '전술 지시' }),
          ...sliderNodes,
          el('h3', { class: 'h3', text: '선발 11인' }),
          slotList,
        ]),
      ]),
    ])
  );

  drawBoard();
  drawSlots();
}

const pct = (v) => `${Math.round(v * 100)}`;
