import './tactics.css';
import { el } from '../../shared/index.js';
import { state, setState } from '../../app/public.js';
import { findById } from '../../roster/index.js';
import { getNextOpponent } from '../../tournament/index.js';
import {
  autoLineup,
  createLineupEditor,
  createStartingLineup,
  resolveFormationId,
  setCaptain,
} from '../../lineup/index.js';
import { createPreset, toTactics } from '../domain/presets.js';
import {
  SET_KEYS,
  activePreset,
  loadBook,
  replaceActive,
  saveBook,
  selectPreset,
  selectSet,
} from '../domain/presetBook.js';
import { createMatchSetup, validateMatchSetupInput } from '../domain/matchSetup.js';
import { normalizePlayerTactics, slotTacticsOf } from '../domain/playerTactics.js';
import { createTeamTacticsPanel } from './teamTactics.js';
import { createPlayerTacticsPanel } from './playerTactics.js';
import { createMiniPitch } from './miniPitch.js';

const TABS = [
  { key: 'team', label: '팀 전술' },
  { key: 'formation', label: '포메이션' },
  { key: 'personal', label: '개인 전술' },
];

/**
 * `tactics` 화면 — 전술 목록(A/B/C × 10)에서 하나를 골라 다듬고 경기에 들고 나간다.
 *
 * 감독이 만지는 값은 프리셋(수비 스타일·폭·깊이 …)이고,
 * simulation이 읽는 Contracts v1 전술 네 값은 `toTactics()`로 파생시켜 상태에 넣는다.
 * 라인업 편집은 lineup 영역의 편집기를 그대로 쓴다.
 */
export default function tacticsScreen(root, ctx) {
  const squadPlayerIds = state.selectedSquad?.playerIds ?? state.poolIds ?? [];
  const captainId = state.selectedSquad?.captainId ?? state.captainId ?? null;
  const formationId = resolveFormationId(state.startingLineup?.formationId ?? state.formation);

  let book = loadBook();
  let tactics = toTactics(activePreset(book));

  // 저장된 라인업이 현재 명단과 어긋나면 자동 배치로 다시 만든다.
  const saved = state.startingLineup ? createStartingLineup({ ...state.startingLineup, formationId }) : null;
  const usable = saved && saved.assignments.every((a) => a.playerId && squadPlayerIds.includes(a.playerId));
  const initial = setCaptain(
    usable ? saved : autoLineup(squadPlayerIds, formationId, findById, { captainId }),
    captainId
  );
  const formationStatus = el('span',{class:'counter',text:`현재 포메이션 · ${formationId}`});

  const editor = createLineupEditor({
    squadPlayerIds,
    playerCatalog: findById,
    lineup: initial,
    width: tactics.width,
    positionMemory: state.lineupPositions ?? {},
    onChange: () => {
      formationStatus.textContent = `현재 포메이션 · ${editor.getLineup().formationId}`;
      drawMiniPitch();
      updateKickoff();
      playerPanel.render();
      // 보드에서 카드를 옮긴 순간 바로 저장한다. 다음 경기가 옛 배치로 시작하지 않게 한다.
      persist();
    },
    onSelect: () => playerPanel.render(),
    // 개인 전술은 자리에 주는 지시다. 명단은 자리를 고르는 데만 쓰고,
    // 선수 교체는 포메이션 탭(보드)에만 둔다.
    lockRoster: true,
  });

  // ---------- 개인 전술 ----------
  // 지시는 자리(slotId)로 들고 있다. 그 자리에 누가 서든 자리의 지시로 뛴다.
  let slotBook = { ...(state.slotTactics ?? {}) };

  const playerPanel = createPlayerTacticsPanel({
    getSelection: () => {
      const assignment = editor.getSelectedAssignment();
      return {
        assignment,
        player: assignment?.playerId ? findById(assignment.playerId) : null,
        tactics: slotTacticsOf(slotBook, assignment),
      };
    },
    onChange: (slotId, next) => {
      slotBook = { ...slotBook, [slotId]: normalizePlayerTactics(next) };
      // 팀 전술과 같게, 값을 만진 즉시 남는다.
      persist();
    },
    onHint: (field) => personalHint.show(field),
  });

  // ---------- 오른쪽 설명 상자 + 미니 배치도 ----------
  // 탭마다 자기 설명 상자를 가진다. 숨은 탭의 상자에 글을 써 봐야 아무도 못 본다.
  function createHintBox() {
    const title = el('b', { class: 'tac-hint-title' });
    const text = el('p', { class: 'tac-hint-text' });
    const show = (field) => {
      title.textContent = field?.label ?? '';
      text.textContent = field?.hint ?? '항목에 마우스를 올리면 설명이 나옵니다.';
    };
    show(null);
    return { node: el('div', { class: 'tac-hint' }, [title, text]), show };
  }

  const teamHint = createHintBox();
  const personalHint = createHintBox();
  const miniPitch = createMiniPitch();

  // ---------- 팀 전술 조작판 ----------
  const teamPanel = createTeamTacticsPanel({
    getPreset: () => activePreset(book),
    onChange: (preset) => applyPreset(replaceActive(book, preset)),
    onHint: teamHint.show,
  });

  // ---------- 전술 목록(사이드바) ----------
  const setTabs = el('div', { class: 'tac-sets' });
  const presetList = el('ol', { class: 'tac-presets' });

  function drawSidebar() {
    setTabs.replaceChildren(
      ...SET_KEYS.map((key) =>
        el('button', {
          class: `tac-set${key === book.activeSet ? ' on' : ''}`,
          type: 'button',
          text: key,
          onclick: () => applyPreset(selectSet(book, key)),
        })
      )
    );

    const set = book.sets[book.activeSet];
    const at = book.selected[book.activeSet];
    presetList.replaceChildren(
      ...set.map((preset, i) =>
        el('li', {}, [
          el('button', {
            class: `tac-preset${i === at ? ' on' : ''}`,
            type: 'button',
            onclick: () => applyPreset(selectPreset(book, i)),
          }, [
            // 목록 번호는 FIFA 방식으로 10번째를 0으로 읽는다.
            el('span', { class: 'tac-preset-no', text: String((i + 1) % 10) }),
            el('span', { class: 'tac-preset-name', text: preset.name }),
          ]),
        ])
      )
    );
  }

  // ---------- 프리셋 이름 ----------
  const titleText = el('b', { class: 'tac-title-text' });
  const titleInput = el('input', {
    class: 'tac-title-input',
    maxlength: '12',
    hidden: true,
    onkeydown: (e) => {
      if (e.key === 'Enter') e.target.blur();
      if (e.key === 'Escape') {
        e.target.value = activePreset(book).name;
        e.target.blur();
      }
    },
    onblur: (e) => {
      const name = e.target.value.trim();
      titleInput.hidden = true;
      titleText.hidden = false;
      if (name && name !== activePreset(book).name) {
        applyPreset(replaceActive(book, { ...activePreset(book), name: name.slice(0, 12) }));
      }
    },
  });
  const renameBtn = el('button', {
    class: 'tac-rename',
    type: 'button',
    text: '✎',
    'aria-label': '전술 이름 바꾸기',
    onclick: () => {
      titleInput.value = activePreset(book).name;
      titleText.hidden = true;
      titleInput.hidden = false;
      titleInput.focus();
      titleInput.select();
    },
  });

  // ---------- 탭 ----------
  const panes = {
    team: el('div', { class: 'tac-pane team' }, [
      teamPanel.node,
      el('aside', { class: 'tac-side' }, [teamHint.node, miniPitch.node]),
    ]),
    formation: el('div', { class: 'tac-pane formation' }, [
      editor.formationChips,
      editor.descNode,
      editor.board,
      editor.boardTools,
    ]),
    // 왼쪽에서 자리를 고르고 오른쪽에서 그 자리에 지시를 준다.
    personal: el('div', { class: 'tac-pane personal' }, [
      el('div', { class: 'pt-squad' }, [
        el('p', {
          class: 'pt-squad-hint',
          text: '포지션을 눌러 그 자리 선수의 개인 지시를 조정하세요. 선수 교체는 포메이션 탭에서 합니다.',
        }),
        editor.slotList,
        editor.errorsNode,
        editor.subsNode,
      ]),
      el('aside', { class: 'tac-side' }, [playerPanel.node, personalHint.node]),
    ]),
  };

  let activeTab = 'team';
  const tabBar = el('div', { class: 'tac-tabs' });
  function drawTabs() {
    tabBar.replaceChildren(
      ...TABS.map((tab) =>
        el('button', {
          class: `tac-tab${tab.key === activeTab ? ' on' : ''}`,
          type: 'button',
          text: tab.label,
          onclick: () => selectTab(tab.key),
        })
      )
    );
  }

  function selectTab(key) {
    activeTab = key;
    drawTabs();
    for (const [paneKey, pane] of Object.entries(panes)) pane.hidden = paneKey !== activeTab;
    // 전술 목록·이름·초기화/저장은 팀 전술 프리셋을 다루는 UI다. 다른 탭에서는 자리만 차지한다.
    consoleNode.classList.toggle('no-preset', activeTab !== 'team');
    consoleNode.classList.toggle('board-only', activeTab === 'formation');
    if (activeTab === 'personal') playerPanel.render();
    // 보드는 숨겨진 동안 크기를 잴 수 없다. 다시 보일 때 한 번 더 그리게 한다.
    if (activeTab === 'formation') editor.setWidth(tactics.width);
  }

  // ---------- 하단 액션 ----------
  const setupNote = el('p', { class: 'tactics-setup-note' });
  const saveNote = el('span', { class: 'tac-saved', text: '저장되었습니다' , hidden: true });
  let saveTimer = 0;

  const resetBtn = el('button', {
    class: 'ghost',
    type: 'button',
    text: '초기화',
    onclick: () => applyPreset(replaceActive(book, createPreset(book.selected[book.activeSet]))),
  });
  const saveBtn = el('button', {
    class: 'ghost',
    type: 'button',
    text: '전체 저장 ✓',
    onclick: () => {
      persist();
      saveNote.hidden = false;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveNote.hidden = true;
      }, 1600);
    },
  });
  const kickoffBtn = el('button', {
    class: 'primary',
    text: '킥오프 ⚽',
    onclick: () => {
      persist();
      ctx.navigate('match');
    },
  });

  // 팀 전술 탭이 아니면 프리셋 UI를 감춘다(`no-preset`).
  // 포메이션 탭은 거기서 한 걸음 더 나아가 보드가 폭을 다 쓰게 한다(`board-only`).
  const consoleNode = el('div', { class: 'tac-console' }, [
    el('aside', { class: 'tac-list' }, [
      el('div', { class: 'tac-list-head' }, [el('b', { text: '전술 목록' }), setTabs]),
      presetList,
    ]),
    el('section', { class: 'tac-main' }, [
      el('div', { class: 'tac-main-head' }, [
        el('div', { class: 'tac-title' }, [titleText, titleInput, renameBtn]),
        tabBar,
      ]),
      el('div', { class: 'tac-body' }, [panes.team, panes.formation, panes.personal]),
      el('div', { class: 'tac-actions' }, [
        resetBtn,
        el('div', { class: 'tac-actions-mid' }, [setupNote, saveNote]),
        saveBtn,
      ]),
    ]),
  ]);

  // 상대는 tournament의 공개 API에서만 가져온다. 상대 데이터를 여기서 만들지 않는다.
  const opponent = state.currentOpponent ?? getNextOpponent(state.tournamentBracket ?? null);

  /**
   * 전술 목록이 바뀔 때 거치는 단 하나의 경로.
   * 파생 전술 값, 보드 폭, 미니 배치도, 저장까지 여기서 한 번에 맞춘다.
   */
  function applyPreset(nextBook) {
    book = nextBook;
    const preset = activePreset(book);
    tactics = toTactics(preset);

    titleText.textContent = preset.name;
    drawSidebar();
    teamPanel.render();
    editor.setWidth(tactics.width);
    drawMiniPitch();
    // 감독이 만진 전술은 화면을 떠나도 남아야 한다. 버튼의 `전체 저장`은 확인용이다.
    saveBook(book);
    updateKickoff();
    // 전술 값도 바뀐 즉시 경기 설정에 반영한다.
    persist();
  }

  function drawMiniPitch() {
    miniPitch.update(editor.getLineup().assignments, activePreset(book), tactics.width);
  }

  /** 상대와 라인업이 모두 유효할 때만 MatchSetup을 만든다. */
  function buildMatchSetup() {
    if (!opponent) return { matchSetup: null, note: '상대가 아직 결정되지 않았습니다.' };

    const input = {
      selectedSquad: { playerIds: squadPlayerIds, captainId, isConfirmed: true },
      startingLineup: editor.getLineup(),
      tactics,
      slotTactics: slotBook,
      opponent,
      tournamentRef: state.currentTournamentRef ?? null,
      playerCatalog: findById,
    };
    const check = validateMatchSetupInput(input);
    if (!check.ok) return { matchSetup: null, note: check.errors.map((e) => e.message).join(' / ') };
    return { matchSetup: createMatchSetup(input), note: '' };
  }

  function persist() {
    const lineup = editor.getLineup();
    const { matchSetup } = buildMatchSetup();
    saveBook(book);
    setState({
      formation: lineup.formationId,
      startingLineup: lineup,
      // 포메이션을 오가도 감독이 만든 배치가 남도록 함께 저장한다.
      lineupPositions: editor.getPositionMemory(),
      slotTactics: slotBook,
      tactics,
      currentOpponent: opponent,
      // 경기 화면은 이 값만 읽는다. 만들지 못했으면 지워서 옛 설정으로 시작하지 않게 한다.
      pendingMatchSetup: matchSetup ?? null,
    });
  }

  function updateKickoff() {
    const { ok, errors } = editor.getValidation();
    kickoffBtn.disabled = !ok;
    kickoffBtn.title = ok ? '' : '선발 11명이 유효해야 경기를 시작할 수 있습니다.';
    if (!ok) {
      setupNote.textContent = errors[0]?.message ?? '';
      return;
    }
    setupNote.textContent = buildMatchSetup().note;
  }

  root.append(
    el('div', { class: 'screen page' }, [
      el('header', { class: 'topbar' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow', text: 'MATCH PLAN · SOUTH AFRICA' }),
          el('h2', { class: 'h2', text: '승부를 바꿀 전술' }),
        ]),
        el('div', { class: 'topbar-right' }, [
          formationStatus,
          el('button', {
            class: 'ghost',
            type: 'button',
            text: '← 명단 수정',
            onclick: () => {
              persist();
              ctx.navigate('squad');
            },
          }),
          kickoffBtn,
        ]),
      ]),
      el('div', { class: 'scout' }, [
        el('b', { text: '상대 스카우팅 리포트' }),
        el('span', {
          text: opponent
            ? `${opponent.name} · ${opponent.lineup.formationId} · ${opponent.style}`
            : '상대가 아직 결정되지 않았습니다.',
        }),
      ]),
      consoleNode,
    ])
  );

  selectTab(activeTab);
  applyPreset(book);

  // 경기로 넘어가지 않고 화면을 떠나도 편집 결과는 남긴다.
  return () => {
    clearTimeout(saveTimer);
    persist();
    editor.destroy();
  };
}
