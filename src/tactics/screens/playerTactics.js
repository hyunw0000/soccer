/**
 * `개인 전술` 탭의 조작판.
 *
 * 팀 전술 조작판과 같은 구조다 — 값을 들고 있지 않고 매번 `getSelection()`으로 읽어 다시 그린다.
 * 바뀐 값은 `onChange(slotId, tactics)`로 넘길 뿐이라 지시 목록의 소유권은 화면에 남는다.
 *
 * 지시는 자리에 붙는다. 선수 이름은 지금 그 자리에 누가 섰는지 알려 줄 뿐이다.
 */

import { el } from '../../shared/index.js';
import { positionOf } from '../../lineup/index.js';
import {
  PLAYER_TACTIC_MAX,
  createPlayerTactics,
  isDefaultPlayerTactics,
  playerTacticGroup,
  setPlayerField,
  stepPlayerField,
} from '../domain/playerTactics.js';

/**
 * @param {object} options
 * @param {() => {assignment: object|null, player: object|null, tactics: object|null}} options.getSelection
 * @param {(slotId: string, tactics: object) => void} options.onChange
 * @param {(field: object|null) => void} [options.onHint] 설명 상자에 띄울 항목
 */
export function createPlayerTacticsPanel({ getSelection, onChange, onHint = () => {} }) {
  // 자리마다 보여 줄 항목이 다르다. 축마다 줄을 한 번씩만 만들어 두고 필요한 것만 붙인다.
  const rows = new Map(); // key → { node, update, setField }

  const name = el('b', { class: 'pt-name' });
  const meta = el('span', { class: 'pt-meta' });
  const badge = el('span', { class: 'pt-badge', text: '기본값', hidden: true });
  const empty = el('p', {
    class: 'pt-empty',
    text: '왼쪽 명단에서 자리를 고르면 그 자리에 맞는 개인 지시가 나옵니다.',
  });

  const commit = (next) => {
    const { assignment } = getSelection();
    if (!assignment?.slotId) return;
    onChange(assignment.slotId, next);
    render();
  };

  const resetBtn = el('button', {
    class: 'ghost small',
    type: 'button',
    text: '자리 기본값으로',
    onclick: () => {
      const { assignment } = getSelection();
      if (assignment) commit(createPlayerTactics(assignment.role, assignment.z));
    },
  });

  /** ◀ ▶ 한 칸 이동. 팀 전술 조작판과 같은 모양을 쓰려고 클래스 이름도 같이 쓴다. */
  const arrow = (key, delta, label) =>
    el('button', {
      class: 'tt-arrow',
      type: 'button',
      'aria-label': label,
      text: delta < 0 ? '◀' : '▶',
      onclick: () => {
        const { tactics } = getSelection();
        if (tactics) commit(stepPlayerField(tactics, key, delta));
      },
    });

  /**
   * 축 하나의 줄. 같은 축이라도 자리에 따라 이름과 설명이 달라지므로
   * (풀백의 `오버랩` = 공격수의 `최전방 위치`) 항목 정의는 나중에 갈아 끼운다.
   */
  function levelRow(key) {
    let field = { key, label: '', hint: '' };

    const label = el('span', { class: 'tt-label' });
    const number = el('b', { class: 'tt-number' });
    const bar = el('div', {
      class: 'tt-bar',
      role: 'slider',
      tabindex: '0',
      'aria-valuemin': '1',
      'aria-valuemax': String(PLAYER_TACTIC_MAX),
      onkeydown: (e) => {
        const delta =
          e.key === 'ArrowRight' || e.key === 'ArrowUp'
            ? 1
            : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
              ? -1
              : 0;
        if (!delta) return;
        e.preventDefault();
        const { tactics } = getSelection();
        if (tactics) commit(stepPlayerField(tactics, key, delta));
      },
    });

    const cells = Array.from({ length: PLAYER_TACTIC_MAX }, (_, i) =>
      el('span', {
        class: 'tt-cell',
        title: `${i + 1}`,
        onclick: () => {
          const { tactics } = getSelection();
          if (tactics) commit(setPlayerField(tactics, key, i + 1));
        },
      })
    );
    bar.append(...cells);

    const down = arrow(key, -1, '낮추기');
    const up = arrow(key, 1, '올리기');
    const node = el(
      'div',
      {
        class: 'tt-row',
        onpointerenter: () => onHint(field),
        onfocusin: () => onHint(field),
      },
      [label, el('div', { class: 'tt-control level' }, [down, number, up, bar])]
    );

    return {
      node,
      setField(next) {
        field = next;
        label.textContent = next.label;
        bar.setAttribute('aria-label', `${next.label} 1부터 ${PLAYER_TACTIC_MAX}`);
        down.setAttribute('aria-label', `${next.label} 낮추기`);
        up.setAttribute('aria-label', `${next.label} 올리기`);
      },
      update(tactics) {
        const value = tactics[key];
        number.textContent = String(value);
        bar.setAttribute('aria-valuenow', String(value));
        cells.forEach((cell, i) => cell.classList.toggle('on', i < value));
      },
    };
  }

  const fieldsNode = el('div', { class: 'pt-fields' });
  let laidOut = null; // 지금 붙어 있는 지시 묶음

  /**
   * 그 자리가 쓰는 항목만, 정의된 순서대로 붙인다.
   * 값만 바뀔 때는 손대지 않는다 — 줄을 다시 붙이면 키보드로 만지던 칸이 포커스를 잃는다.
   */
  function layout(group) {
    if (group.key === laidOut) return;
    laidOut = group.key;
    for (const f of group.fields) {
      if (!rows.has(f.key)) rows.set(f.key, levelRow(f.key));
      rows.get(f.key).setField(f);
    }
    fieldsNode.replaceChildren(...group.fields.map((f) => rows.get(f.key).node));
  }

  const body = el('div', { class: 'pt-body' }, [fieldsNode, el('div', { class: 'pt-foot' }, [resetBtn])]);

  const node = el('div', { class: 'pt-panel' }, [
    el('div', { class: 'pt-head' }, [name, badge, meta]),
    empty,
    body,
  ]);

  function render() {
    const { assignment, player, tactics } = getSelection();
    const ready = Boolean(assignment?.playerId && tactics);

    empty.hidden = ready;
    body.hidden = !ready;
    if (!ready) {
      name.textContent = '자리 미선택';
      meta.textContent = '';
      badge.hidden = true;
      return;
    }

    const group = playerTacticGroup(assignment.role, assignment.z);
    layout(group);

    // 지시의 주인은 자리다. 자리를 크게 쓰고, 지금 그 자리에 선 선수는 곁들여 보여 준다.
    name.textContent = `${positionOf(assignment)} · ${group.label}`;
    meta.textContent = player ? `${player.num} ${player.name}` : '빈 자리';
    badge.hidden = !isDefaultPlayerTactics(tactics, assignment.role, assignment.z);

    for (const f of group.fields) rows.get(f.key).update(tactics);
    resetBtn.disabled = !badge.hidden;
  }

  render();
  return { node, render };
}
