/**
 * StartingLineup 도메인 (Contracts v1).
 *
 * 모든 함수는 순수 함수다. 입력 StartingLineup을 변경하지 않고 새 객체를 반환한다.
 * lineup 내부에 전역 상태나 singleton을 만들지 않는다 — 저장은 app state의 책임이다.
 *
 * StartingLineup = {
 *   formationId, assignments[{ slotId, playerId, role, x, z }],
 *   substituteIds[], captainId, goalkeeperId
 * }
 */

import {
  COORD_MAX,
  COORD_MIN,
  LINEUP_SIZE,
  getNormalizedSlots,
  getSlot,
  resolveFormationId,
} from '../formations.js';
import { positionOf, selectionScore, roleAtX } from './roles.js';

/** 정규화 좌표를 허용 범위 안으로 잘라낸다. 범위 밖 값은 버리지 않고 경계로 붙인다. */
function clampCoord(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(COORD_MAX, Math.max(COORD_MIN, value));
}

/**
 * 선수 조회기를 하나의 형태로 통일한다.
 * roster의 findById 함수, Map, 선수 배열을 모두 받는다.
 * @returns {(playerId: string) => object|null}
 */
export function createLookup(playerCatalog) {
  if (typeof playerCatalog === 'function') return (id) => playerCatalog(id) ?? null;
  if (playerCatalog instanceof Map) return (id) => playerCatalog.get(id) ?? null;
  if (Array.isArray(playerCatalog)) {
    const map = new Map(playerCatalog.map((p) => [p.id, p]));
    return (id) => map.get(id) ?? null;
  }
  if (playerCatalog && typeof playerCatalog === 'object') {
    return (id) => playerCatalog[id] ?? null;
  }
  return () => null;
}

/**
 * 자리의 역할은 좌표에서 파생한다. 포메이션 슬롯 역할은 시작값일 뿐이고,
 * 감독이 카드를 다른 구역에 놓으면 그 구역의 역할이 된다.
 * 골키퍼 슬롯만 예외로, 어디에 놓아도 GK로 남는다.
 */
function roleFor(slot, x) {
  return slot.role === 'GK' ? 'GK' : roleAtX(x);
}

/**
 * 슬롯 정의와 선수 id로 assignment 하나를 만든다. 좌표는 값으로 복사한다.
 * 감독이 직접 옮긴 좌표(coord)가 있으면 범위 안에서 그 값을 쓴다.
 */
function toAssignment(slot, playerId, coord = null) {
  const x = clampCoord(coord?.x, slot.x);
  return {
    slotId: slot.slotId,
    playerId: playerId ?? null,
    role: roleFor(slot, x),
    x,
    z: clampCoord(coord?.z, slot.z),
  };
}

/**
 * 임의 입력을 StartingLineup 형태로 정규화한다.
 * 슬롯 순서와 역할은 항상 현재 포메이션 정의를 기준으로 다시 채운다.
 * 좌표는 감독이 보드에서 옮긴 결과이므로 유지하되, 범위를 벗어난 값은
 * 그대로 신뢰하지 않고 [-0.5, 0.5] 경계로 잘라낸다.
 */
export function createStartingLineup({
  formationId,
  assignments = [],
  substituteIds = [],
  captainId = null,
  goalkeeperId = null,
} = {}) {
  const resolvedId = resolveFormationId(formationId);
  const slots = getNormalizedSlots(resolvedId);
  const bySlot = new Map(assignments.filter((a) => a && a.slotId).map((a) => [a.slotId, a]));

  const next = slots.map((slot) => {
    const prev = bySlot.get(slot.slotId);
    return toAssignment(slot, prev?.playerId ?? null, prev);
  });
  const starters = new Set(next.map((a) => a.playerId).filter(Boolean));

  return {
    formationId: resolvedId,
    assignments: next,
    substituteIds: [...new Set(substituteIds.filter((id) => typeof id === 'string' && !starters.has(id)))],
    captainId: captainId ?? null,
    goalkeeperId: goalkeeperId ?? next.find((a) => a.role === 'GK')?.playerId ?? null,
  };
}

/** 선발 명단에 실제로 배치된 선수 id (빈 슬롯 제외). */
export function startingPlayerIds(lineup) {
  return lineup.assignments.map((a) => a.playerId).filter(Boolean);
}

export function getAssignment(lineup, slotId) {
  return lineup.assignments.find((a) => a.slotId === slotId) ?? null;
}

/**
 * 슬롯을 보드 위 임의의 좌표로 옮긴다.
 * 포메이션 정의는 시작 배치일 뿐이고 최종 배치는 감독이 정한다.
 * 옮긴 자리가 다른 구역이면 역할도 그 구역을 따라간다 (예: 윙어를 뒤로 내리면 수비수).
 *
 * @param {object} startingLineup
 * @param {string} slotId
 * @param {{x: number, z: number}} coord 정규화 좌표. 범위를 벗어나면 경계로 잘린다.
 * @returns {object} 새 StartingLineup (입력은 변경하지 않는다)
 */
export function moveAssignment(startingLineup, slotId, coord) {
  const target = getAssignment(startingLineup, slotId);
  if (!target || !coord) return startingLineup;

  const x = clampCoord(coord.x, target.x);
  const z = clampCoord(coord.z, target.z);
  if (x === target.x && z === target.z) return startingLineup;

  const slot = getSlot(startingLineup.formationId, slotId);
  const role = slot ? roleFor(slot, x) : target.role;

  return withDerivedGoalkeeper({
    ...startingLineup,
    assignments: startingLineup.assignments.map((a) => (a.slotId === slotId ? { ...a, role, x, z } : a)),
  });
}

/**
 * 감독이 옮긴 좌표를 버리고 현재 포메이션 기본 배치로 되돌린다. 선수 배정은 유지한다.
 * 좌표에서 파생한 역할도 함께 포메이션 정의로 돌아간다.
 */
export function resetPositions(startingLineup) {
  const bySlot = new Map(getNormalizedSlots(startingLineup.formationId).map((s) => [s.slotId, s]));
  return withDerivedGoalkeeper({
    ...startingLineup,
    assignments: startingLineup.assignments.map((a) => {
      const slot = bySlot.get(a.slotId);
      return slot ? { ...a, role: slot.role, x: slot.x, z: slot.z } : a;
    }),
  });
}

/**
 * 감독이 기본 배치에서 옮긴 슬롯만 골라 `{ slotId: {x, z} }`로 남긴다.
 * 포메이션을 바꿔도 이전 배치를 되살릴 수 있도록, 화면이 이 값을 포메이션별로 들고 있는다.
 */
export function capturePositions(startingLineup) {
  const bySlot = new Map(getNormalizedSlots(startingLineup.formationId).map((s) => [s.slotId, s]));
  const out = {};
  for (const a of startingLineup.assignments) {
    const slot = bySlot.get(a.slotId);
    if (slot && (a.x !== slot.x || a.z !== slot.z)) out[a.slotId] = { x: a.x, z: a.z };
  }
  return out;
}

/**
 * capturePositions로 남긴 좌표를 현재 포메이션 슬롯에 되돌린다.
 * 지금 포메이션에 없는 슬롯은 무시하고, 좌표에서 파생하는 역할도 함께 다시 맞춘다.
 */
export function applyPositions(startingLineup, positions) {
  if (!positions) return startingLineup;

  let changed = false;
  const assignments = startingLineup.assignments.map((a) => {
    const saved = positions[a.slotId];
    if (!saved) return a;
    const x = clampCoord(saved.x, a.x);
    const z = clampCoord(saved.z, a.z);
    if (x === a.x && z === a.z) return a;
    changed = true;
    const slot = getSlot(startingLineup.formationId, a.slotId);
    return { ...a, role: slot ? roleFor(slot, x) : a.role, x, z };
  });

  return changed ? withDerivedGoalkeeper({ ...startingLineup, assignments }) : startingLineup;
}

/** 기본 배치에서 옮겨진 슬롯이 하나라도 있는가. 화면의 '기본 배치' 버튼 활성화에 쓴다. */
export function hasCustomPositions(startingLineup) {
  const bySlot = new Map(getNormalizedSlots(startingLineup.formationId).map((s) => [s.slotId, s]));
  return startingLineup.assignments.some((a) => {
    const slot = bySlot.get(a.slotId);
    return slot ? a.x !== slot.x || a.z !== slot.z : false;
  });
}

/** GK 슬롯 선수를 goalkeeperId로 다시 맞춘다. 배치가 바뀔 때마다 호출한다. */
function withDerivedGoalkeeper(lineup) {
  const gk = lineup.assignments.find((a) => a.role === 'GK')?.playerId ?? null;
  return gk === lineup.goalkeeperId ? lineup : { ...lineup, goalkeeperId: gk };
}

/**
 * 슬롯 묶음에 선수를 배정한다. 팀 전체 값어치(selectionScore 합)를 최대로 만드는 것이 목표다.
 *
 * 슬롯을 순서대로 훑으며 그때그때 최고점을 고르면, 앞에 나온 슬롯이 뒷 슬롯의
 * 주인을 가로챈다. 센터백이 왼쪽 풀백 자리에서도 두 번째로 높은 점수를 받으면
 * 풀백 슬롯이 먼저 데려가 버리고, 정작 센터백 자리는 한참 낮은 선수가 채우는 식이다.
 *
 * 그래서 (선수, 슬롯) 조합 전체를 점수순으로 훑어 가장 좋은 짝부터 확정하고,
 * 마지막에 두 자리를 맞바꿔 합이 커지는 경우가 없어질 때까지 다듬는다.
 *
 * @param {ReadonlyArray<object>} slots 채울 슬롯
 * @param {ReadonlyArray<object>} pool 후보 선수
 * @returns {Map<string, string>} slotId → playerId
 */
function assignByValue(slots, pool) {
  const score = (player, slot) => (player ? selectionScore(player, slot.position) : -Infinity);

  // 1단계: 가장 좋은 짝부터 확정한다. 슬롯 순서가 결과를 좌우하지 않는다.
  const pairs = [];
  for (const slot of slots) for (const player of pool) pairs.push({ slot, player, value: score(player, slot) });
  pairs.sort((a, b) => b.value - a.value);

  const bySlot = new Map();
  const taken = new Set();
  for (const { slot, player } of pairs) {
    if (bySlot.has(slot.slotId) || taken.has(player.id)) continue;
    bySlot.set(slot.slotId, player);
    taken.add(player.id);
  }

  // 2단계: 두 자리를 맞바꿔 합이 커지면 바꾼다. 1단계가 놓친 엇갈림을 정리한다.
  // 슬롯 수가 11이라 모든 짝을 봐도 비용이 없다. 더 나아지지 않으면 즉시 멈춘다.
  const filled = slots.filter((s) => bySlot.has(s.slotId));
  for (let pass = 0; pass < filled.length; pass++) {
    let improved = false;
    for (let i = 0; i < filled.length; i++) {
      for (let j = i + 1; j < filled.length; j++) {
        const a = filled[i];
        const b = filled[j];
        const pa = bySlot.get(a.slotId);
        const pb = bySlot.get(b.slotId);
        if (score(pb, a) + score(pa, b) > score(pa, a) + score(pb, b)) {
          bySlot.set(a.slotId, pb);
          bySlot.set(b.slotId, pa);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return new Map([...bySlot].map(([slotId, player]) => [slotId, player.id]));
}

/**
 * 포지션 요구에 맞춰 풀에서 선발 11명을 자동으로 채운다.
 * 자리마다 세부 포지션 적합도와 능력치를 함께 보며, 팀 전체로 가장 좋은 조합을 찾는다.
 *
 * @param {string[]} playerIds 선택된 명단(SelectedSquad.playerIds)
 * @param {string} formationId
 * @param {*} playerCatalog roster의 findById 등 선수 조회기
 * @param {{captainId?: string|null}} [options]
 * @returns {object} StartingLineup
 */
export function autoLineup(playerIds = [], formationId, playerCatalog, options = {}) {
  const lookup = createLookup(playerCatalog);
  const resolvedId = resolveFormationId(formationId);
  const slots = getNormalizedSlots(resolvedId);

  const pool = [...new Set(playerIds)].map(lookup).filter(Boolean);
  const filled = assignByValue(slots, pool);

  const assignments = slots.map((slot) => toAssignment(slot, filled.get(slot.slotId) ?? null));
  const starters = new Set(filled.values());

  return withDerivedGoalkeeper({
    formationId: resolvedId,
    assignments,
    substituteIds: [...new Set(playerIds)].filter((id) => !starters.has(id) && lookup(id)),
    captainId: options.captainId ?? null,
    goalkeeperId: null,
  });
}

/**
 * 슬롯에 선수를 배치한다.
 * 이미 다른 슬롯에 있는 선수면 두 슬롯을 맞교환해 중복 배치를 만들지 않는다.
 * 밀려난 선수는 교체 명단으로 내려간다.
 */
export function assignPlayer(startingLineup, playerId, slotId) {
  const target = getAssignment(startingLineup, slotId);
  if (!target || !playerId) return startingLineup;
  if (target.playerId === playerId) return startingLineup;

  const source = startingLineup.assignments.find((a) => a.playerId === playerId);
  const displaced = target.playerId;

  const assignments = startingLineup.assignments.map((a) => {
    if (a.slotId === slotId) return { ...a, playerId };
    // 맞교환: 원래 그 선수가 있던 슬롯은 밀려난 선수가 받는다.
    if (source && a.slotId === source.slotId) return { ...a, playerId: displaced };
    return a;
  });

  const starters = new Set(assignments.map((a) => a.playerId).filter(Boolean));
  const substituteIds = startingLineup.substituteIds.filter((id) => id !== playerId && !starters.has(id));
  // 교환이 아니라 교체 투입이면 밀려난 선수를 교체 명단으로 보낸다.
  if (!source && displaced && !starters.has(displaced)) substituteIds.push(displaced);

  return withDerivedGoalkeeper({ ...startingLineup, assignments, substituteIds });
}

/** 두 슬롯의 선수를 맞바꾼다. 좌표와 역할은 슬롯에 남는다. */
export function swapAssignments(startingLineup, slotIdA, slotIdB) {
  if (slotIdA === slotIdB) return startingLineup;
  const a = getAssignment(startingLineup, slotIdA);
  const b = getAssignment(startingLineup, slotIdB);
  if (!a || !b) return startingLineup;

  const assignments = startingLineup.assignments.map((item) => {
    if (item.slotId === slotIdA) return { ...item, playerId: b.playerId };
    if (item.slotId === slotIdB) return { ...item, playerId: a.playerId };
    return item;
  });
  return withDerivedGoalkeeper({ ...startingLineup, assignments });
}

/**
 * 포메이션을 바꾸고 기존 선수를 새 슬롯에 재배치한다.
 * 같은 역할 슬롯을 우선 유지하고, 남는 선수는 적합도 순으로 빈 슬롯을 채운다.
 */
export function changeFormation(startingLineup, formationId, playerCatalog) {
  const resolvedId = resolveFormationId(formationId);
  if (resolvedId === startingLineup.formationId) return startingLineup;

  const lookup = createLookup(playerCatalog);
  const slots = getNormalizedSlots(resolvedId);
  const remaining = startingPlayerIds(startingLineup);
  const filled = new Map();

  const prevPositionOf = (id) => {
    const prev = startingLineup.assignments.find((a) => a.playerId === id);
    return prev ? positionOf(prev) : null;
  };

  // 1차: 이전 배치와 같은 세부 포지션이면 그 자리를 그대로 잇는다.
  // 포메이션이 바뀌어도 10번은 10번 자리, 윙백은 윙백 자리에 남는다.
  for (const slot of slots) {
    const index = remaining.findIndex((id) => prevPositionOf(id) === slot.position);
    if (index >= 0) filled.set(slot.slotId, remaining.splice(index, 1)[0]);
  }
  // 2차: 세부 포지션이 겹치지 않으면 같은 라인이던 선수로 잇는다.
  for (const slot of slots) {
    if (filled.get(slot.slotId)) continue;
    const index = remaining.findIndex((id) => {
      const prev = startingLineup.assignments.find((a) => a.playerId === id);
      return prev?.role === slot.role;
    });
    if (index >= 0) filled.set(slot.slotId, remaining.splice(index, 1)[0]);
  }
  // 3차: 남은 빈 슬롯은 자동 편성과 같은 방식으로 한 번에 배정한다.
  const empty = slots.filter((slot) => !filled.get(slot.slotId));
  if (empty.length) {
    const rest = assignByValue(empty, remaining.map(lookup).filter(Boolean));
    for (const [slotId, playerId] of rest) {
      filled.set(slotId, playerId);
      remaining.splice(remaining.indexOf(playerId), 1);
    }
  }

  return withDerivedGoalkeeper({
    ...startingLineup,
    formationId: resolvedId,
    assignments: slots.map((slot) => toAssignment(slot, filled.get(slot.slotId) ?? null)),
    // 슬롯 수는 포메이션이 달라도 11로 같지만, 남으면 교체 명단으로 보낸다.
    substituteIds: [...new Set([...startingLineup.substituteIds, ...remaining])],
  });
}

/** 명단이 바뀌었을 때 교체 선수 목록을 다시 계산한다. */
export function syncSubstitutes(startingLineup, squadPlayerIds = []) {
  const starters = new Set(startingPlayerIds(startingLineup));
  return {
    ...startingLineup,
    substituteIds: [...new Set(squadPlayerIds)].filter((id) => !starters.has(id)),
  };
}

/** 주장을 지정한다. 명단 밖 선수는 검증에서 걸러지므로 여기서는 값만 바꾼다. */
export function setCaptain(startingLineup, captainId) {
  return { ...startingLineup, captainId: captainId ?? null };
}

/** 선발이 모두 채워졌는지 (빠른 UI 판단용). 정식 검증은 validateStartingLineup을 쓴다. */
export function isComplete(startingLineup) {
  return startingPlayerIds(startingLineup).length === LINEUP_SIZE;
}
