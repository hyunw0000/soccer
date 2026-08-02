import './tactics.css';
import { el } from '../../shared/index.js';
import { toTactics } from '../domain/presets.js';
import { activePreset, loadBook, replaceActive, saveBook, selectPreset } from '../domain/presetBook.js';
import { createTeamTacticsPanel } from './teamTactics.js';

/**
 * 경기 중에 여는 팀 전술 조작판.
 *
 * 전술 화면과 **같은 전술 목록**(localStorage의 전술 book)을 읽고 쓴다 — 경기 중에 바꾼 값이
 * 그대로 남아 다음 경기의 출발점이 된다. 감독이 값을 만지는 순간 `onApply`가 불리고,
 * 경기 화면은 그걸 그대로 시뮬레이션에 넣는다. 즉 "적용" 버튼이 따로 없다.
 *
 * 이 패널은 경기를 모른다. 시뮬레이션을 건드리는 일은 전부 호출자(match 화면)가 한다.
 *
 * @param {object} options
 * @param {(tactics: object, preset: object) => void} options.onApply 파생된 Tactics 네 값(0..1)
 * @param {() => void} [options.onClose] 닫기 버튼
 */
export function createLiveTacticsPanel({ onApply, onClose = () => {} }) {
  let book = loadBook();

  const nameEl = el('b', { class: 'lt-name' });
  const derivedEl = el('div', { class: 'lt-derived' });
  const presetRow = el('div', { class: 'lt-presets' });

  const teamPanel = createTeamTacticsPanel({
    getPreset: () => activePreset(book),
    onChange: (preset) => commit(replaceActive(book, preset)),
  });

  const pct = (n) => `${Math.round(n * 100)}`;

  /** 전술 목록이 바뀌는 단 하나의 경로 — 저장·표시·적용을 여기서 한 번에 한다. */
  function commit(nextBook) {
    book = nextBook;
    saveBook(book);
    render();
    const preset = activePreset(book);
    onApply(toTactics(preset), preset);
  }

  function drawPresets() {
    const set = book.sets[book.activeSet];
    const at = book.selected[book.activeSet];
    presetRow.replaceChildren(
      ...set.map((preset, i) =>
        el('button', {
          class: `lt-preset${i === at ? ' on' : ''}`,
          type: 'button',
          text: preset.name,
          title: preset.name,
          onclick: () => commit(selectPreset(book, i)),
        })
      )
    );
  }

  function render() {
    const preset = activePreset(book);
    const t = toTactics(preset);
    nameEl.textContent = preset.name;
    derivedEl.textContent = `라인 ${pct(t.lineHeight)} · 압박 ${pct(t.pressing)} · 템포 ${pct(t.tempo)} · 폭 ${pct(t.width)}`;
    drawPresets();
    teamPanel.render();
  }

  const node = el('aside', { class: 'live-tactics', hidden: true }, [
    el('div', { class: 'lt-head' }, [
      el('div', {}, [el('span', { class: 'lt-eyebrow', text: '경기 중 전술 지시' }), nameEl]),
      el('button', { class: 'lt-close', type: 'button', text: '✕', 'aria-label': '전술 창 닫기', onclick: () => onClose() }),
    ]),
    presetRow,
    el('div', { class: 'lt-body' }, [teamPanel.node]),
    el('div', { class: 'lt-foot' }, [
      derivedEl,
      el('span', { class: 'lt-note', text: '바꾸는 즉시 그라운드에 반영됩니다' }),
    ]),
  ]);

  render();

  return {
    node,
    render,
    get isOpen() {
      return !node.hidden;
    },
    /** 현재 선택된 전술의 계약 값. 되감기 후 다시 적용할 때 쓴다. */
    currentTactics: () => toTactics(activePreset(book)),
    open() {
      node.hidden = false;
      render();
    },
    close() {
      node.hidden = true;
    },
    /** @returns {boolean} 연 상태인지 */
    toggle() {
      node.hidden = !node.hidden;
      if (!node.hidden) render();
      return !node.hidden;
    },
  };
}
