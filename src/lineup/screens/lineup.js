import './lineup.css';
import { el } from '../../shared/index.js';
import { state, setState } from '../../app/public.js';
import { findById } from '../../roster/index.js';
import { getNextOpponent } from '../../tournament/index.js';
import { autoLineup, createStartingLineup, setCaptain } from '../domain/lineup.js';
import { createLineupEditor } from './lineupEditor.js';
import { createOpponentScouting } from './opponentScouting.js';
import { resolveFormationId } from '../formations.js';

/**
 * `lineup` 화면 — 선발 11명과 포메이션을 정한다.
 * 전술 값은 다루지 않고 다음 화면(tactics)으로 넘긴다.
 *
 * 라우트 등록과 진입 guard는 담당자 1이 소유한다.
 * 이 화면은 mount 함수만 공개하고 다른 화면을 직접 렌더링하지 않는다.
 */
export default function lineupScreen(root, ctx) {
  const squadPlayerIds = state.selectedSquad?.playerIds ?? state.poolIds ?? [];
  const captainId = state.selectedSquad?.captainId ?? state.captainId ?? null;
  const formationId = resolveFormationId(state.startingLineup?.formationId ?? state.formation);

  // 저장된 라인업이 현재 명단과 맞지 않으면 자동 배치로 다시 만든다.
  const saved = state.startingLineup
    ? createStartingLineup({ ...state.startingLineup, formationId })
    : null;
  const usable =
    saved && saved.assignments.every((a) => a.playerId && squadPlayerIds.includes(a.playerId));
  const initial = setCaptain(
    usable ? saved : autoLineup(squadPlayerIds, formationId, findById, { captainId }),
    captainId
  );
  const lineupStatus = el('span',{class:'counter'});

  const editor = createLineupEditor({
    squadPlayerIds,
    playerCatalog: findById,
    lineup: initial,
    positionMemory: state.lineupPositions ?? {},
    onChange: () => {
      updateNext();
      // 배치를 바꾼 즉시 저장한다. 다음 화면으로 넘어가지 않아도 남는다.
      persist();
    },
  });

  // 상대 스카우팅. 상대 데이터는 tournament의 공개 API에서만 가져온다.
  // 고른 상대가 다음 화면(전술·경기)이 쓰는 상대가 된다.
  let opponent = state.currentOpponent ?? getNextOpponent(state.tournamentBracket ?? null);
  const scouting = createOpponentScouting({
    stage: opponent.stage,
    onSelect: (team) => {
      opponent = getNextOpponent(team.stage);
      setState({ currentOpponent: opponent });
    },
  });

  const nextBtn = el('button', {
    class: 'primary',
    text: '전술 설정 →',
    onclick: () => {
      persist();
      ctx.navigate('tactics');
    },
  });

  function persist() {
    const lineup = editor.getLineup();
    setState({
      formation: lineup.formationId,
      startingLineup: lineup,
      lineupPositions: editor.getPositionMemory(),
      // 전술·경기 화면이 이 라운드의 상대를 그대로 이어받게 한다.
      currentOpponent: opponent,
    });
  }

  function updateNext() {
    const { ok } = editor.getValidation();
    const selected = editor.getLineup().assignments.filter(({playerId})=>playerId).length;
    lineupStatus.textContent = `${selected}/11 · ${ok?'준비 완료':'선택 중'}`;
    lineupStatus.classList.toggle('warn',!ok);
    nextBtn.disabled = !ok;
    nextBtn.title = ok ? '' : '선발 11명이 유효해야 다음 단계로 넘어갈 수 있습니다.';
  }

  root.append(
    el('div', { class: 'screen page' }, [
      el('header', { class: 'topbar' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow', text: 'STARTING XI · MATCH 54' }),
          el('h2', { class: 'h2', text: '남아공전에 나설 선발 명단' }),
        ]),
        el('div', { class: 'topbar-right' }, [
          lineupStatus,
          el('button', {
            class: 'ghost',
            type: 'button',
            text: '← 명단 수정',
            onclick: () => {
              persist();
              ctx.navigate('squad');
            },
          }),
          el('button', {
            class: 'ghost',
            type: 'button',
            text: '자동 배치',
            onclick: () =>
              editor.setLineup(
                setCaptain(
                  autoLineup(squadPlayerIds, editor.getLineup().formationId, findById, { captainId }),
                  captainId
                )
              ),
          }),
          nextBtn,
        ]),
      ]),
      el('div', { class: 'tactics-grid' }, [
        el('section', { class: 'panel' }, [
          el('h3', { class: 'h3', text: '포메이션' }),
          editor.formationChips,
          editor.descNode,
          editor.board,
          editor.boardTools,
        ]),
        el('section', { class: 'panel' }, [
          el('h3', { class: 'h3', text: '선발 11인' }),
          editor.slotList,
          editor.errorsNode,
          editor.subsNode,
        ]),
      ]),
      scouting.node,
    ])
  );

  updateNext();
  // 화면을 떠날 때도 편집 결과를 잃지 않고, 편집기 관찰자도 남기지 않는다.
  return () => {
    persist();
    editor.destroy();
  };
}
