/**
 * `팀 전술` 탭의 조작판.
 *
 * 프리셋 값을 직접 들고 있지 않고, 매번 `getPreset()`으로 읽어 다시 그린다.
 * 값이 바뀌면 새 프리셋을 `onChange`로 넘길 뿐이므로 전술 목록의 소유권은 화면에 남는다.
 */

import { el } from '../../shared/index.js';
import { MENTALITIES, TACTIC_FIELDS, setField, setMentality, stepField } from '../domain/presets.js';

const GROUPS = [
  { key: 'defense', title: '수비' },
  { key: 'attack', title: '공격' },
];

/**
 * @param {object} options
 * @param {() => object} options.getPreset 현재 프리셋을 돌려주는 함수
 * @param {(preset: object) => void} options.onChange 값이 바뀐 새 프리셋
 * @param {(field: object|null) => void} [options.onHint] 설명 상자에 띄울 항목
 */
export function createTeamTacticsPanel({ getPreset, onChange, onHint = () => {} }) {
  const node = el('div', { class: 'tt-panel' });
  const rows = new Map(); // key → 다시 그릴 때 쓸 갱신 함수

  const commit = (next) => {
    onChange(next);
    render();
  };

  /** ◀ ▶ 한 칸 이동 버튼. 양끝에서는 비활성으로 보여 준다. */
  const arrow = (key, delta, label) =>
    el('button', {
      class: 'tt-arrow',
      type: 'button',
      'aria-label': label,
      text: delta < 0 ? '◀' : '▶',
      onclick: () => commit(stepField(getPreset(), key, delta)),
    });

  function optionRow(field) {
    const value = el('span', { class: 'tt-option-value' });
    const control = el('div', { class: 'tt-control option' }, [
      arrow(field.key, -1, `${field.label} 이전`),
      value,
      arrow(field.key, 1, `${field.label} 다음`),
    ]);
    return {
      node: control,
      update: (preset) => {
        value.textContent = preset[field.key];
      },
    };
  }

  function levelRow(field) {
    const number = el('b', { class: 'tt-number' });
    const bar = el('div', {
      class: 'tt-bar',
      role: 'slider',
      tabindex: '0',
      'aria-label': `${field.label} 1부터 ${field.max}`,
      'aria-valuemin': '1',
      'aria-valuemax': String(field.max),
      onkeydown: (e) => {
        const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        commit(stepField(getPreset(), field.key, delta));
      },
    });

    const cells = Array.from({ length: field.max }, (_, i) =>
      el('span', {
        class: 'tt-cell',
        title: `${i + 1}`,
        onclick: () => commit(setField(getPreset(), field.key, i + 1)),
      })
    );
    bar.append(...cells);

    const control = el('div', { class: 'tt-control level' }, [
      arrow(field.key, -1, `${field.label} 낮추기`),
      number,
      arrow(field.key, 1, `${field.label} 올리기`),
      bar,
    ]);

    return {
      node: control,
      update: (preset) => {
        const value = preset[field.key];
        number.textContent = String(value);
        bar.setAttribute('aria-valuenow', String(value));
        cells.forEach((cell, i) => cell.classList.toggle('on', i < value));
      },
    };
  }

  for (const group of GROUPS) {
    node.append(el('h3', { class: 'tt-group', text: group.title }));

    for (const field of TACTIC_FIELDS.filter((f) => f.group === group.key)) {
      const built = field.type === 'option' ? optionRow(field) : levelRow(field);
      const row = el(
        'div',
        {
          class: 'tt-row',
          onpointerenter: () => onHint(field),
          onfocusin: () => onHint(field),
        },
        [el('span', { class: 'tt-label', text: field.label }), built.node]
      );
      node.append(row);
      rows.set(field.key, built.update);
    }
  }

  // ---------- 팀 성향 ----------
  const mentalityName = el('span', { class: 'tt-ment-name' });
  const mentalityDots = el('div', { class: 'tt-ment-dots' });
  const dots = MENTALITIES.map((label, i) =>
    el('button', {
      class: 'tt-ment-dot',
      type: 'button',
      'aria-label': label,
      onclick: () => commit(setMentality(getPreset(), i)),
    })
  );
  mentalityDots.append(...dots);

  const mentalityStep = (delta) =>
    el('button', {
      class: 'tt-arrow',
      type: 'button',
      'aria-label': delta < 0 ? '팀 성향 수비적으로' : '팀 성향 공격적으로',
      text: delta < 0 ? '◀' : '▶',
      onclick: () => commit(setMentality(getPreset(), getPreset().mentality + delta)),
    });

  node.append(
    el('h3', { class: 'tt-group', text: '팀 성향' }),
    el('div', { class: 'tt-mentality' }, [
      el('div', { class: 'tt-ment-label' }, [mentalityName]),
      el('div', { class: 'tt-ment-line' }, [mentalityStep(-1), mentalityDots, mentalityStep(1)]),
    ])
  );

  function render() {
    const preset = getPreset();
    for (const update of rows.values()) update(preset);

    mentalityName.textContent = MENTALITIES[preset.mentality];
    // 이름표는 선택된 점 위에 놓아 어느 쪽으로 치우쳤는지 한눈에 보이게 한다.
    mentalityName.style.left = `${((preset.mentality + 0.5) / MENTALITIES.length) * 100}%`;
    dots.forEach((dot, i) => dot.classList.toggle('on', i === preset.mentality));
  }

  render();
  return { node, render };
}
