/**
 * 선발 배치 편집기.
 * lineup 화면과 tactics 화면이 같은 UI·같은 도메인 규칙을 쓰도록 한 곳에 둔다.
 * 상태를 밖에 저장하지 않고, 변경될 때마다 onChange로 새 StartingLineup을 넘긴다.
 */

// 편집기가 만드는 노드(.pitch, .fcard, .lineup-row ...)의 스타일은 편집기와 함께 따라간다.
// lineup 화면과 tactics 화면 어디에 붙어도 같은 모양이 되도록 여기서 가져온다.
import './lineup.css';
import { el } from '../../shared/index.js';
import { FORMATION_KEYS, FORMATIONS } from '../formations.js';
import {
  applyPositions,
  assignPlayer,
  autoLineup,
  capturePositions,
  changeFormation,
  createLookup,
  getAssignment,
  hasCustomPositions,
  moveAssignment,
  resetPositions,
  setCaptain,
  syncSubstitutes,
} from '../domain/lineup.js';
import { validateStartingLineup } from '../domain/validation.js';
import {
  DEPTH_BANDS,
  ROLES,
  ROLE_LABEL,
  ROLE_ZONES,
  playerOverall,
  positionCode,
  selectionScore,
  positionName,
  positionOf,
  roleAtX,
  roleFits,
} from '../domain/roles.js';
import { createProjection } from './boardProjection.js';

// 잔디의 가로:세로. 실제 경기장(68 x 105)을 공격 방향이 위가 되게 세워 둔 비율이다.
const PITCH_RATIO = 105 / 68;
// 잔디가 보드 가로를 다 채우면 원근으로 넓어진 아래쪽 카드가 잘린다.
const PITCH_INSET = 0.78;
// 보드가 화면보다 길어지면 배치를 한눈에 볼 수 없다. 세로는 여기서 끊는다.
const PITCH_MAX_HEIGHT = 560;

/**
 * @param {object} options
 * @param {string[]} options.squadPlayerIds 선택된 출전 명단
 * @param {*} options.playerCatalog roster의 findById 등 선수 조회기
 * @param {object} options.lineup 초기 StartingLineup
 * @param {number} [options.width] 전술 폭. 보드 표시에만 쓴다 (0..1)
 * @param {Record<string, Record<string, {x: number, z: number}>>} [options.positionMemory]
 *   포메이션별로 감독이 옮겨 둔 좌표. 저장은 화면(app state)의 책임이다.
 * @param {(lineup: object, validation: object) => void} [options.onChange]
 * @param {(assignment: object|null) => void} [options.onSelect] 명단에서 고른 자리가 바뀔 때
 * @param {boolean} [options.lockRoster] 명단에서 선수를 바꾸지 못하게 한다.
 *   개인 전술처럼 '이 자리에 선 선수'만 다루는 화면은 자리를 고르는 용도로만 명단을 쓴다.
 */
export function createLineupEditor({
  squadPlayerIds = [],
  playerCatalog,
  lineup,
  width = 0.5,
  positionMemory = {},
  onChange = () => {},
  onSelect = () => {},
  lockRoster = false,
}) {
  const lookup = createLookup(playerCatalog);

  // 포메이션을 바꿨다가 돌아와도 감독이 만든 배치가 남도록 포메이션별로 기억한다.
  // 이 값은 편집기 안에서만 갱신되고, 저장·복원은 화면이 getPositionMemory()로 가져가 처리한다.
  const memory = { ...positionMemory };

  // 자동 배치로 다시 만들어진 라인업이라도 기억해 둔 배치가 있으면 그것으로 시작한다.
  let current = applyPositions(lineup, memory[lineup.formationId]);
  let boardWidth = width;
  let projection = null;

  // 명단에서 고른 자리. 개인 지시처럼 '한 명'을 다루는 화면이 이 값을 따라간다.
  // 주장이 있으면 주장부터 보여 준다 — 감독이 가장 먼저 볼 선수다.
  let selectedSlotId =
    current.assignments.find((a) => a.playerId && a.playerId === current.captainId)?.slotId ??
    current.assignments.find((a) => a.playerId)?.slotId ??
    null;

  const formationChips = el('div', { class: 'chips' });
  const descNode = el('p', { class: 'lead small' });

  // 구역은 잔디 위에 그린다. 잔디와 같은 원근을 타야 카드와 눈금이 어긋나지 않는다.
  // 잔디는 위쪽이 상대 골문이므로 ROLE_ZONES(자기 진영 → 상대 진영)를 뒤에서부터 읽는다.
  const zoneNodes = new Map(
    ROLE_ZONES.map((zone) => [
      zone.role,
      el(
        'div',
        {
          class: `pitch-zone ${zone.role}`,
          style: {
            // v = -x·h 이므로 잔디 위에서의 세로 위치는 (0.5 - x)이다.
            top: `${(0.5 - zone.to) * 100}%`,
            height: `${(zone.to - zone.from) * 100}%`,
          },
        },
        [
          el('span', { class: 'pitch-zone-tag', text: `${zone.role} · ${ROLE_LABEL[zone.role]}` }),
          // 라인 안의 깊이 띠도 함께 그린다. 어디까지가 수비형이고 어디부터
          // 공격형인지 보이지 않으면 감독은 카드를 감으로 놓게 된다.
          ...bandNodes(zone),
        ]
      ),
    ])
  );

  /** 한 라인 안의 깊이 띠 눈금. 띠가 하나뿐인 라인은 그리지 않는다. */
  function bandNodes(zone) {
    const bands = DEPTH_BANDS[zone.role] ?? [];
    if (bands.length < 2) return [];
    const height = zone.to - zone.from;
    let from = zone.from;
    return bands.map((band, index) => {
      const to = Math.min(band.to, zone.to);
      const node = el('span', {
        // 띠 배열은 자기 진영 → 상대 진영 순이다. 마지막 띠의 윗선은
        // 구역 자체의 경계선과 같은 자리라 겹쳐 그리지 않는다.
        class: `pitch-band${index === bands.length - 1 ? ' lead' : ''}`,
        text: band.band,
        style: {
          top: `${((zone.to - to) / height) * 100}%`,
          height: `${((to - from) / height) * 100}%`,
        },
      });
      from = to;
      return node;
    });
  }
  const zoneLayer = el('div', { class: 'pitch-zones' }, [...zoneNodes.values()]);
  const surface = el('div', { class: 'pitch-surface' }, [zoneLayer]);
  const cardLayer = el('div', { class: 'pitch-cards' });
  const board = el('div', { class: 'pitch' }, [surface, cardLayer]);
  const slotList = el('div', { class: 'lineup-list' });
  const errorsNode = el('ul', { class: 'lineup-errors' });
  const subsNode = el('div', { class: 'lineup-subs' });

  // 소집 명단 전체를 카드로 늘어놓는 판. 여기서 고른 선수가 보드의 자리로 들어간다.
  const squadTitle = el('b', { class: 'squad-title' });
  const squadGrid = el('div', { class: 'squad-grid' });
  const squadNode = el('div', { class: 'lineup-squad' }, [
    el('div', { class: 'squad-head' }, [
      squadTitle,
      el('span', {
        class: 'squad-guide',
        text: '선수를 누른 뒤 필드의 자리를 누르면 그 자리에 들어갑니다. 카드로 바로 끌어다 놓아도 됩니다.',
      }),
    ]),
    squadGrid,
  ]);

  const autoBtn = el('button', {
    class: 'ghost',
    type: 'button',
    text: '⇄ 자동 편성',
    onclick: () =>
      commit(
        setCaptain(
          autoLineup(squadPlayerIds, current.formationId, playerCatalog, { captainId: current.captainId }),
          current.captainId
        )
      ),
  });
  const resetBtn = el('button', {
    class: 'ghost',
    type: 'button',
    text: '기본 배치로',
    onclick: () => commit(resetPositions(current)),
  });
  const BOARD_HINT = '카드를 끌어 원하는 구역에 놓으세요. 놓인 구역이 그 선수의 역할이 됩니다.';
  const boardHint = el('span', { class: 'board-hint', text: BOARD_HINT });
  const boardTools = el('div', { class: 'board-tools' }, [
    boardHint,
    el('span', { class: 'board-actions' }, [resetBtn, autoBtn]),
  ]);

  // 세울 수 없는 자리에 놓았을 때 이유를 그 자리에서 알려 준다. 잠시 뒤 원래 안내로 돌아간다.
  let noticeTimer = 0;
  function notify(message) {
    clearTimeout(noticeTimer);
    boardHint.textContent = message;
    boardHint.classList.add('warn');
    noticeTimer = setTimeout(() => {
      boardHint.textContent = BOARD_HINT;
      boardHint.classList.remove('warn');
    }, 2600);
  }

  /** 슬롯 정의의 역할. 골키퍼 슬롯만 구역과 무관하게 GK로 남는다. */
  function slotRole(slotId) {
    return FORMATIONS[current.formationId].slots.find((s) => s.slotId === slotId)?.role ?? null;
  }

  /** 지금 좌표에 놓으면 어떤 역할이 되는가. 도메인의 파생 규칙과 같은 답을 내야 한다. */
  function roleIfDropped(slotId, x) {
    return slotRole(slotId) === 'GK' ? 'GK' : roleAtX(x);
  }

  /** 끌고 있는 카드가 어느 구역으로 들어가는지 잔디 위에 표시한다. */
  function highlightZone(role) {
    for (const [key, node] of zoneNodes) node.classList.toggle('hot', key === role);
  }

  // ---------- 명단 → 보드 ----------
  // 명단에서 고른 선수. 이 값이 있으면 보드의 자리를 누르는 순간 그 자리에 들어간다.
  let pickedPlayerId = null;

  /**
   * 그 선수를 그 자리에 세울 수 없는 이유. 세울 수 있으면 null.
   * 골키퍼만은 구역 규칙과 무관하게 자리를 지킨다 — validateStartingLineup이 같은 선을 긋는다.
   */
  function assignBlockReason(playerId, slotId) {
    const player = playerId ? lookup(playerId) : null;
    if (!player) return '명단에 없는 선수입니다.';
    const keeperSlot = slotRole(slotId) === 'GK';
    const keeper = roleFits(player, 'GK');
    if (keeperSlot && !keeper) return '골키퍼 자리에는 골키퍼만 세울 수 있습니다.';
    if (!keeperSlot && keeper) return '골키퍼는 골키퍼 자리에만 설 수 있습니다.';
    return null;
  }

  /** 선수를 자리에 세운다. 이미 다른 자리에 있던 선수면 도메인이 두 자리를 맞바꾼다. */
  function placePlayer(playerId, slotId) {
    const reason = assignBlockReason(playerId, slotId);
    if (reason) {
      notify(reason);
      return false;
    }
    pickedPlayerId = null;
    // 그 자리에 세운 선수를 바로 이어서 볼 수 있게 고른 자리도 옮긴다.
    selectedSlotId = slotId;
    commit(assignPlayer(current, playerId, slotId));
    onSelect(getAssignment(current, selectedSlotId));
    return true;
  }

  /**
   * 보드의 자리를 짚었을 때. 명단에서 고른 선수가 있으면 그 자리에 세우고,
   * 없으면 그 자리를 고르기만 한다. 배치를 바꿨으면 true.
   */
  function tapSlot(slotId) {
    if (!pickedPlayerId) {
      selectSlot(slotId);
      return false;
    }
    return placePlayer(pickedPlayerId, slotId);
  }

  /** 화면 좌표 → 놓을 자리. 카드 사이 빈 곳에 놓아도 가장 가까운 자리로 들어간다. */
  function slotAtPoint(clientX, clientY) {
    const rect = board.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const card of cardLayer.children) {
      const r = card.getBoundingClientRect();
      const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
      if (d < bestDistance) {
        bestDistance = d;
        best = card.dataset.slotId;
      }
    }
    return best;
  }

  /** 끌고 있는 선수가 어느 카드로 들어가는지(또는 못 들어가는지) 보드에 표시한다. */
  function highlightDrop(playerId, slotId) {
    for (const card of cardLayer.children) {
      const target = Boolean(slotId) && card.dataset.slotId === slotId;
      const blocked = target && Boolean(assignBlockReason(playerId, slotId));
      card.classList.toggle('drop', target && !blocked);
      card.classList.toggle('drop-blocked', blocked);
    }
  }

  /** 전술 폭은 좌우 배치를 넓히거나 좁힌다. 실제 월드 좌표 변환은 simulation이 한다. */
  const spreadOf = () => 0.8 + boardWidth * 0.5;

  /**
   * 포인터를 붙잡는다. 이미 손을 뗀 뒤라면 브라우저가 던지므로 삼킨다 —
   * 여기서 예외가 새어 나가면 드래그 시작만 하고 끝내지 못하는 상태로 굳는다.
   */
  function capturePointer(node, pointerId) {
    try {
      node.setPointerCapture(pointerId);
    } catch {
      /* 잡지 못해도 드래그 자체는 이어진다 — 이벤트가 노드 밖으로 새는 것만 감수한다 */
    }
  }

  /** 붙잡은 포인터를 놓는다. 잡은 적이 없으면 아무 일도 하지 않는다. */
  function releasePointer(node, pointerId) {
    try {
      if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    } catch {
      /* 이미 풀렸다 */
    }
  }

  /** 보드 크기가 정해져야 투영을 만들 수 있다. 레이아웃이 잡힌 뒤/리사이즈마다 다시 만든다. */
  function measure() {
    const outer = board.clientWidth;
    if (!outer) return false;

    // 가로에 맞춘 뒤, 세로가 한도를 넘으면 그 비율만큼 줄인다.
    // 원근 때문에 높이가 폭에 정비례하지 않으므로 한 번 더 맞춘다.
    let w = outer * PITCH_INSET;
    for (let i = 0; i < 2; i++) {
      const probe = createProjection({ width: w, height: w * PITCH_RATIO });
      if (probe.projectedHeight <= PITCH_MAX_HEIGHT) break;
      w *= PITCH_MAX_HEIGHT / probe.projectedHeight;
    }

    projection = createProjection({ width: w, height: w * PITCH_RATIO });
    board.style.height = `${Math.round(projection.projectedHeight)}px`;
    // 카드는 잔디 크기를 따라간다. 보드가 줄면 카드도 같이 줄어야 겹치지 않는다.
    board.style.setProperty('--card-w', `${Math.round(w * 0.21)}px`);
    surface.style.width = `${w}px`;
    surface.style.height = `${w * PITCH_RATIO}px`;
    surface.style.top = `${projection.originOffset}px`;
    return true;
  }

  /** 정규화 좌표 → 보드 안 화면 위치. 카드 배치와 드래그가 같은 식을 쓴다. */
  function place(assignment) {
    const { u, v } = projection.toLocal(assignment, spreadOf());
    const p = projection.project(u, v);
    return {
      left: `calc(50% + ${p.x}px)`,
      top: `${projection.originOffset + p.y}px`,
      scale: p.scale,
    };
  }

  /** 포인터 위치 → 정규화 좌표. place()의 역변환이다. */
  function toNormalized(event) {
    const rect = board.getBoundingClientRect();
    const local = projection.unproject(
      event.clientX - (rect.left + rect.width / 2),
      event.clientY - (rect.top + projection.originOffset)
    );
    return projection.toNormalized(local, spreadOf());
  }

  // 이 값보다 적게 움직이면 배치를 바꾸지 않는다. 잡기만 한 카드가 커서로 튀지 않게 한다.
  const DRAG_THRESHOLD = 0.004;

  /**
   * 카드 하나를 드래그 가능하게 만든다.
   * 드래그 중에는 style만 움직여 재렌더 없이 따라오게 하고, 손을 뗄 때 한 번만 commit한다.
   */
  function makeDraggable(card, slotId) {
    // 골키퍼는 골문을 지키는 자리다. 보드에서 끌어 올릴 수 있으면
    // 필드 플레이어와 구분이 없어지므로 자리 자체를 고정한다.
    // 자리는 고정이어도 그 자리에 설 선수는 바꿀 수 있어야 하므로 짚는 것까지 막지는 않는다.
    if (slotRole(slotId) === 'GK') {
      card.addEventListener('pointerup', () => tapSlot(slotId));
      return;
    }

    let origin = null; // 잡은 순간의 { x, z, grabX, grabZ }

    const positionOf = (e) => {
      const p = toNormalized(e);
      // 카드 중심이 커서로 순간이동하지 않도록 잡은 지점과의 간격을 유지한다.
      return {
        x: Math.min(0.5, Math.max(-0.5, p.x + origin.grabX)),
        z: Math.min(0.5, Math.max(-0.5, p.z + origin.grabZ)),
      };
    };

    card.addEventListener('pointerdown', (e) => {
      // 마우스는 주 버튼만. 터치·펜은 그대로 받는다.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const start = getAssignment(current, slotId);
      if (!start || !projection) return;
      const p = toNormalized(e);
      origin = { x: start.x, z: start.z, grabX: start.x - p.x, grabZ: start.z - p.z };
      capturePointer(card, e.pointerId);
      card.classList.add('dragging');
      e.preventDefault();
    });

    card.addEventListener('pointermove', (e) => {
      if (!origin) return;
      const next = positionOf(e);
      const pos = place(next);
      card.style.left = pos.left;
      card.style.top = pos.top;
      card.style.setProperty('--depth', pos.scale.toFixed(3));

      // 손을 떼기 전에 바뀔 역할을 미리 보여 준다. 카드와 구역이 함께 바뀐다.
      const role = roleIfDropped(slotId, next.x);
      highlightZone(role);
      for (const key of ROLES) card.classList.toggle(key, key === role);
      card.querySelector('.fcard-slot').textContent = positionCode(role, next.x, next.z);
    });

    const finish = (e) => {
      if (!origin) return;
      const next = positionOf(e);
      const moved =
        Math.abs(next.x - origin.x) > DRAG_THRESHOLD || Math.abs(next.z - origin.z) > DRAG_THRESHOLD;
      origin = null;
      card.classList.remove('dragging');
      highlightZone(null);
      releasePointer(card, e.pointerId);
      // 움직이지 않았으면 배치는 그대로다 — 짚은 것으로 보고 자리를 고르거나 선수를 세운다.
      if (moved) commit(moveAssignment(current, slotId, next));
      else if (!tapSlot(slotId)) drawBoard();
    };
    card.addEventListener('pointerup', finish);
    // 시스템이 포인터를 가져가도(스크롤 제스처 등) 마지막 위치는 잃지 않는다.
    card.addEventListener('pointercancel', finish);
  }

  function commit(next) {
    current = syncSubstitutes(next, squadPlayerIds);
    // 카드를 옮기든 기본 배치로 되돌리든, 지금 포메이션의 배치는 항상 여기서 한 번만 기억한다.
    memory[current.formationId] = capturePositions(current);
    // 포메이션을 바꾸면 슬롯 id가 통째로 달라진다. 고른 자리가 사라졌으면 다시 고른다 —
    // 그러지 않으면 개인 전술처럼 '고른 한 명'을 보는 화면이 빈 채로 남는다.
    const kept = getAssignment(current, selectedSlotId);
    if (!kept) {
      selectedSlotId = current.assignments.find((a) => a.playerId)?.slotId ?? null;
      onSelect(getAssignment(current, selectedSlotId));
    }
    render();
    onChange(current, validation());
  }

  function validation() {
    return validateStartingLineup(current, { playerIds: squadPlayerIds }, playerCatalog);
  }

  function selectSlot(slotId) {
    if (slotId === selectedSlotId) return;
    selectedSlotId = slotId;
    drawSlots();
    onSelect(getAssignment(current, selectedSlotId));
  }

  function drawFormations() {
    formationChips.replaceChildren(
      ...FORMATION_KEYS.map((key) =>
        el('button', {
          class: `chip${key === current.formationId ? ' on' : ''}`,
          type: 'button',
          text: FORMATIONS[key].label,
          // 그 포메이션에서 마지막으로 만들어 둔 배치가 있으면 기본 배치 대신 그것으로 돌아간다.
          onclick: () =>
            commit(applyPositions(changeFormation(current, key, playerCatalog), memory[key])),
        })
      )
    );
    descNode.textContent = FORMATIONS[current.formationId].description;
  }

  /** 카드에 적는 포지션 이름. 슬롯 이름이 아니라 지금 놓인 자리에서 파생한다. */
  function labelOf(assignment) {
    return positionOf(assignment);
  }

  function drawBoard() {
    if (!projection && !measure()) return;

    cardLayer.replaceChildren(
      ...current.assignments.map((a) => {
        const player = a.playerId ? lookup(a.playerId) : null;
        const pos = place(a);
        const captain = player && player.id === current.captainId;
        const label = labelOf(a);
        const fixed = slotRole(a.slotId) === 'GK';
        // 명단에서 선수를 고른 동안에는 그 선수를 받을 수 있는 자리와 아닌 자리를 구분해 보여 준다.
        const picked = pickedPlayerId
          ? assignBlockReason(pickedPlayerId, a.slotId)
            ? ' no-drop'
            : ' can-drop'
          : '';
        const card = el(
          'div',
          {
            class: `fcard ${a.role}${captain ? ' cap' : ''}${player ? '' : ' empty'}${fixed ? ' fixed' : ''}${picked}`,
            'data-slot-id': a.slotId,
            style: { left: pos.left, top: pos.top },
            title: pickedPlayerId
              ? `${lookup(pickedPlayerId)?.name ?? ''} 선수를 이 자리에 세우려면 누르세요`
              : player
                ? `${player.name} (${player.detail || player.pos}) · 현재 ${label} ${positionName(label)} OVR ${playerOverall(player)}${fixed ? ' · 골키퍼는 자리를 옮길 수 없습니다' : ' · 끌어서 이동'}`
                : `${label} ${positionName(label)} 빈 자리`,
          },
          [
            el('span', { class: 'fcard-top' }, [
              el('b', { class: 'fcard-ovr', text: player ? String(playerOverall(player)) : '–' }),
              el('span', { class: 'fcard-slot', text: label }),
            ]),
            el('span', { class: 'fcard-num', text: player ? String(player.num) : '·' }),
            el('span', { class: 'fcard-name', text: player ? player.name : '빈 자리' }),
          ]
        );
        // 커스텀 속성은 style 객체 할당으로 등록되지 않으므로 setProperty로 넣는다.
        card.style.setProperty('--depth', pos.scale.toFixed(3));
        makeDraggable(card, a.slotId);
        return card;
      })
    );
    resetBtn.disabled = !hasCustomPositions(current);
  }

  function drawSlots() {
    // 명단은 공격수부터 골키퍼 순으로 읽는다. 같은 라인이면 앞선부터, 같은 줄이면 왼쪽 자리부터.
    // 깊이를 먼저 보므로 공격형 미드필더가 수비형 미드필더보다 위에 온다.
    // 배치 자체의 순서(assignments)는 계약이므로 건드리지 않고 보기 순서만 바꾼다.
    const ordered = [...current.assignments].sort(
      (x, y) => ROLES.indexOf(y.role) - ROLES.indexOf(x.role) || y.x - x.x || x.z - y.z
    );

    slotList.replaceChildren(
      el('div', { class: 'lineup-row head' }, [
        el('span', { text: '포지션' }),
        el('span', { text: '선수명' }),
        el('span', { text: '능력치' }),
      ]),
      ...ordered.map((a) => {
        const player = a.playerId ? lookup(a.playerId) : null;
        const nameOf = (p) => `${p.name} · ${p.detail || p.pos}`;

        // 명단을 잠그면 누가 이 자리에 섰는지 읽기만 한다. 교체는 보드에서 한다.
        const nameNode = lockRoster
          ? el('span', { class: 'slot-name', text: player ? nameOf(player) : '빈 자리' })
          : buildSelect();

        function buildSelect() {
          const options = squadPlayerIds
            .map(lookup)
            .filter(Boolean)
            // 이 자리에 세웠을 때 값어치가 높은 선수가 목록 위로 오게 한다.
            .sort((x, y) => selectionScore(y, labelOf(a)) - selectionScore(x, labelOf(a)));

          const select = el('select', {
            class: 'slot-select',
            onchange: (e) => commit(assignPlayer(current, e.target.value, a.slotId)),
          });
          for (const option of options) {
            select.append(
              el('option', {
                value: option.id,
                selected: option.id === a.playerId,
                text: nameOf(option),
              })
            );
          }
          return select;
        }

        const rowClass = [
          'lineup-row',
          player && player.id === current.captainId ? 'cap' : '',
          a.slotId === selectedSlotId ? 'on' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return el(lockRoster ? 'div' : 'label', { class: rowClass, onpointerdown: () => selectSlot(a.slotId) }, [
          el('span', { class: `pos ${a.role}`, text: labelOf(a), title: positionName(labelOf(a)) }),
          nameNode,
          el('b', { class: 'ovr', text: player ? String(playerOverall(player)) : '–' }),
        ]);
      })
    );
  }

  // 명단 카드를 보드로 끌어 놓는 동안의 상태. 끄는 대상은 한 번에 하나뿐이다.
  let dragPlayerId = null;
  let dragStart = null;
  let dragGhost = null;

  function endGhost() {
    dragGhost?.remove();
    dragGhost = null;
    dragPlayerId = null;
    dragStart = null;
    highlightDrop(null, null);
  }

  /** 명단 카드를 보드로 끌어다 놓을 수 있게 한다. 끌지 않고 누르기만 하면 click이 고르기를 맡는다. */
  function makeSquadDraggable(chip, playerId) {
    // 끌어서 놓은 뒤에 따라오는 click은 "고르기"가 아니다 — 이 카드에서 한 번만 삼킨다.
    // 카드마다 따로 두는 이유는, 놓는 순간 판이 다시 그려져 이 카드가 사라지기 때문이다.
    let swallowClick = false;

    chip.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragPlayerId = playerId;
      dragStart = { x: e.clientX, y: e.clientY };
      swallowClick = false;
      capturePointer(chip, e.pointerId);
    });

    chip.addEventListener('pointermove', (e) => {
      if (dragPlayerId !== playerId) return;
      if (!dragGhost) {
        // 손가락이 살짝 흔들린 것까지 드래그로 보면 누르기가 사라진다.
        if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) < 6) return;
        dragGhost = el('div', { class: 'squad-ghost', text: lookup(playerId)?.name ?? '' });
        document.body.append(dragGhost);
        chip.classList.add('dragging');
      }
      dragGhost.style.left = `${e.clientX}px`;
      dragGhost.style.top = `${e.clientY}px`;
      highlightDrop(playerId, slotAtPoint(e.clientX, e.clientY));
    });

    const finishDrag = (e) => {
      if (dragPlayerId !== playerId) return;
      const dragged = Boolean(dragGhost);
      const slotId = dragged ? slotAtPoint(e.clientX, e.clientY) : null;
      releasePointer(chip, e.pointerId);
      chip.classList.remove('dragging');
      endGhost();
      if (!dragged) return; // 끌지 않았다 — click이 고르기를 맡는다
      swallowClick = true;
      if (slotId) placePlayer(playerId, slotId);
    };
    chip.addEventListener('pointerup', finishDrag);
    chip.addEventListener('pointercancel', finishDrag);

    // 키보드로도 고를 수 있도록 고르기는 click에 둔다.
    chip.addEventListener('click', () => {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      pickedPlayerId = pickedPlayerId === playerId ? null : playerId;
      drawSquad();
      drawBoard();
    });
  }

  function squadChip(player, assignment) {
    const chip = el(
      'button',
      {
        class: [
          'squad-chip',
          assignment ? 'on' : '',
          player.id === pickedPlayerId ? 'sel' : '',
          player.id === current.captainId ? 'cap' : '',
        ]
          .filter(Boolean)
          .join(' '),
        type: 'button',
        'aria-pressed': player.id === pickedPlayerId ? 'true' : 'false',
        title: assignment
          ? `${player.name} · 지금 ${positionOf(assignment)} ${positionName(positionOf(assignment))} — 다른 자리에 놓으면 그 자리 선수와 맞바꿉니다`
          : `${player.name} (${player.detail || player.pos}) · 대기 — 누른 뒤 필드의 자리를 누르거나 끌어다 놓으세요`,
      },
      [
        el('i', {
          class: `pos ${player.pos}`,
          text: assignment ? positionOf(assignment) : player.detail || player.pos,
        }),
        el('span', { class: 'squad-chip-name', text: player.name }),
        el('b', { text: String(playerOverall(player)) }),
      ]
    );
    makeSquadDraggable(chip, player.id);
    return chip;
  }

  /**
   * 소집 명단 전체를 보여 준다. 대기 선수를 먼저 두는 이유는
   * 이 판을 여는 목적이 "지금 안 뛰는 선수를 넣는 것"이기 때문이다.
   */
  function drawSquad() {
    const onField = new Map(current.assignments.filter((a) => a.playerId).map((a) => [a.playerId, a]));
    const players = [...new Set(squadPlayerIds)].map(lookup).filter(Boolean);
    const byOverall = (a, b) => playerOverall(b) - playerOverall(a);
    const bench = players.filter((p) => !onField.has(p.id)).sort(byOverall);
    const starters = players.filter((p) => onField.has(p.id)).sort(byOverall);

    squadTitle.textContent = `소집 명단 ${players.length}명 · 선발 ${starters.length} · 대기 ${bench.length}`;
    squadGrid.replaceChildren(
      el('span', { class: 'squad-group', text: `대기 ${bench.length}명` }),
      ...(bench.length
        ? bench.map((p) => squadChip(p, null))
        : [el('span', { class: 'squad-empty', text: '대기 중인 선수가 없습니다.' })]),
      el('span', { class: 'squad-group', text: `선발 ${starters.length}명` }),
      ...starters.map((p) => squadChip(p, onField.get(p.id)))
    );
  }

  function drawStatus() {
    const { errors } = validation();
    errorsNode.replaceChildren(...errors.map((e) => el('li', { text: e.message })));
    errorsNode.hidden = errors.length === 0;

    const subs = current.substituteIds.map(lookup).filter(Boolean);
    subsNode.replaceChildren(
      el('span', { class: 'subs-title', text: `교체 ${subs.length}명` }),
      ...subs.map((p) =>
        el('span', { class: 'sub-chip' }, [
          el('i', { class: `pos ${p.pos}`, text: p.pos }),
          el('span', { text: p.name }),
          el('b', { text: String(playerOverall(p)) }),
        ])
      )
    );
  }

  function render() {
    drawFormations();
    drawBoard();
    drawSlots();
    drawSquad();
    drawStatus();
  }

  render();

  // 보드는 화면 폭에 따라 크기가 변한다. 크기가 바뀌면 투영을 다시 만들고 카드를 새로 놓는다.
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          if (measure()) drawBoard();
        })
      : null;
  observer?.observe(board);

  // 편집기를 만든 시점에는 보드가 아직 화면에 붙지 않아 크기를 잴 수 없다.
  // ResizeObserver가 없는 환경에서도 첫 배치가 그려지도록 붙은 뒤 한 번 더 시도한다.
  let firstDraw = 0;
  const drawWhenSized = () => {
    if (projection || measure()) drawBoard();
    else if (firstDraw++ < 60) requestAnimationFrame(drawWhenSized);
  };
  requestAnimationFrame(drawWhenSized);

  return {
    formationChips,
    descNode,
    board,
    boardTools,
    slotList,
    errorsNode,
    subsNode,
    /** 소집 명단 판. 보드와 함께 붙이면 명단에서 고른 선수를 그 자리에 세울 수 있다. */
    squadNode,
    getLineup: () => current,
    /** 명단에서 지금 고른 자리. 없으면 null. */
    getSelectedAssignment: () => getAssignment(current, selectedSlotId),
    /** 포메이션별 배치 기억. 화면이 app state에 저장해 다음 방문에도 남긴다. */
    getPositionMemory: () => ({ ...memory }),
    getValidation: validation,
    setWidth(next) {
      boardWidth = next;
      drawBoard();
    },
    setLineup(next) {
      commit(next);
    },
    /** 화면이 사라질 때 호출한다. ResizeObserver도 끌던 카드도 남기지 않는다. */
    destroy() {
      observer?.disconnect();
      firstDraw = Infinity;
      clearTimeout(noticeTimer);
      endGhost();
    },
  };
}
