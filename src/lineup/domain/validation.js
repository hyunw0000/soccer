/**
 * StartingLineup 검증. 저장하지 않고 호출할 때마다 계산한다.
 *
 * 반환은 항상 { ok, errors: [{ code, message, slotId?, playerId? }] } 형태다.
 * 화면은 errors를 그대로 표시하고, MatchSetup 생성은 ok가 아니면 중단한다.
 */

import { COORD_MAX, COORD_MIN, LINEUP_SIZE, getFormation } from '../formations.js';
import { createLookup, startingPlayerIds } from './lineup.js';
import { isRole, roleAtX, roleFits } from './roles.js';

const inRange = (n) => Number.isFinite(n) && n >= COORD_MIN && n <= COORD_MAX;

function fail(errors) {
  return { ok: errors.length === 0, errors };
}

/**
 * @param {object} startingLineup
 * @param {object} [selectedSquad] roster의 SelectedSquad. 주면 명단 소속까지 검사한다.
 * @param {*} [playerCatalog] 주면 존재하지 않는 선수 id까지 검사한다.
 */
export function validateStartingLineup(startingLineup, selectedSquad = null, playerCatalog = null) {
  const errors = [];
  const push = (code, message, extra = {}) => errors.push({ code, message, ...extra });

  if (!startingLineup || typeof startingLineup !== 'object') {
    push('lineup/missing', '라인업이 없습니다.');
    return fail(errors);
  }

  const formation = getFormation(startingLineup.formationId);
  if (!formation) {
    push('formation/unknown', `알 수 없는 포메이션입니다: ${startingLineup.formationId}`);
    return fail(errors);
  }

  const assignments = Array.isArray(startingLineup.assignments) ? startingLineup.assignments : [];
  if (assignments.length !== formation.slots.length) {
    push(
      'lineup/slot-count',
      `포메이션 슬롯 ${formation.slots.length}개와 배치 ${assignments.length}개가 일치하지 않습니다.`
    );
  }

  const slotById = new Map(formation.slots.map((s) => [s.slotId, s]));
  const seenSlots = new Set();
  const seenPlayers = new Set();
  const lookup = playerCatalog ? createLookup(playerCatalog) : null;

  for (const a of assignments) {
    const slot = slotById.get(a?.slotId);
    if (!slot) {
      push('slot/unknown', `포메이션에 없는 슬롯입니다: ${a?.slotId}`, { slotId: a?.slotId });
      continue;
    }
    if (seenSlots.has(a.slotId)) {
      push('slot/duplicate', `슬롯이 중복되었습니다: ${slot.label}`, { slotId: a.slotId });
    }
    seenSlots.add(a.slotId);

    if (!a.playerId) {
      push('slot/empty', `${slot.label} 자리가 비어 있습니다.`, { slotId: a.slotId });
      continue;
    }
    if (seenPlayers.has(a.playerId)) {
      push('player/duplicate', `같은 선수가 두 자리에 배치되었습니다: ${a.playerId}`, {
        slotId: a.slotId,
        playerId: a.playerId,
      });
    }
    seenPlayers.add(a.playerId);

    // 역할은 포메이션 정의가 아니라 카드를 놓은 구역에서 파생한다.
    // 감독이 윙어를 수비 구역에 내리면 그 자리는 수비수가 된다 — 오류가 아니다.
    // 다만 골키퍼 자리만은 구역과 무관하게 GK로 고정한다.
    if (!isRole(a.role)) {
      push('slot/role-unknown', `${slot.label} 슬롯의 역할이 올바르지 않습니다: ${a.role}`, { slotId: a.slotId });
    } else if (slot.role === 'GK' || a.role === 'GK') {
      if (slot.role !== a.role) {
        push('slot/gk-role', `${slot.label} 슬롯은 골키퍼 자리와 바꿔 쓸 수 없습니다.`, { slotId: a.slotId });
      }
    } else if (inRange(a.x) && a.role !== roleAtX(a.x)) {
      push('slot/role-zone', `${slot.label} 슬롯의 역할이 배치된 구역과 다릅니다.`, { slotId: a.slotId });
    }
    if (!inRange(a.x) || !inRange(a.z)) {
      push('slot/coord-range', `${slot.label} 좌표가 ${COORD_MIN}~${COORD_MAX} 범위를 벗어났습니다.`, {
        slotId: a.slotId,
      });
    }
    if (lookup && !lookup(a.playerId)) {
      push('player/unknown', `존재하지 않는 선수입니다: ${a.playerId}`, { playerId: a.playerId });
    }
    if (selectedSquad?.playerIds && !selectedSquad.playerIds.includes(a.playerId)) {
      push('player/not-in-squad', `출전 명단에 없는 선수가 배치되었습니다: ${a.playerId}`, {
        playerId: a.playerId,
      });
    }
  }

  const starters = startingPlayerIds({ assignments });
  if (starters.length !== LINEUP_SIZE) {
    push('lineup/incomplete', `선발은 ${LINEUP_SIZE}명이어야 합니다. 현재 ${starters.length}명.`);
  }

  // 골키퍼
  const gkAssignment = assignments.find((a) => a?.role === 'GK');
  if (!gkAssignment?.playerId) {
    push('gk/missing', '골키퍼가 배치되지 않았습니다.');
  } else if (startingLineup.goalkeeperId && startingLineup.goalkeeperId !== gkAssignment.playerId) {
    push('gk/mismatch', 'goalkeeperId가 GK 슬롯 선수와 다릅니다.');
  } else if (lookup) {
    // 필드 플레이어를 GK 슬롯에 넣는 것은 다른 슬롯의 포지션 변경과 달리 허용하지 않는다.
    const gkPlayer = lookup(gkAssignment.playerId);
    if (gkPlayer && !roleFits(gkPlayer, 'GK')) {
      push('gk/not-goalkeeper', `골키퍼가 아닌 선수가 GK 자리에 있습니다: ${gkPlayer.name ?? gkPlayer.id}`, {
        slotId: gkAssignment.slotId,
        playerId: gkAssignment.playerId,
      });
    }
  }

  // 주장
  const captainId = startingLineup.captainId ?? null;
  if (captainId) {
    if (selectedSquad?.playerIds && !selectedSquad.playerIds.includes(captainId)) {
      push('captain/not-in-squad', '주장이 출전 명단에 없습니다.', { playerId: captainId });
    }
    const subs = Array.isArray(startingLineup.substituteIds) ? startingLineup.substituteIds : [];
    if (!starters.includes(captainId) && !subs.includes(captainId)) {
      push('captain/not-in-lineup', '주장이 선발과 교체 명단 어디에도 없습니다.', { playerId: captainId });
    }
  }

  // 교체 명단
  const subs = Array.isArray(startingLineup.substituteIds) ? startingLineup.substituteIds : [];
  for (const id of subs) {
    if (starters.includes(id)) {
      push('sub/also-starter', `선발 선수가 교체 명단에도 있습니다: ${id}`, { playerId: id });
    }
    if (selectedSquad?.playerIds && !selectedSquad.playerIds.includes(id)) {
      push('sub/not-in-squad', `출전 명단에 없는 교체 선수입니다: ${id}`, { playerId: id });
    }
  }
  if (new Set(subs).size !== subs.length) push('sub/duplicate', '교체 명단에 중복된 선수가 있습니다.');

  return fail(errors);
}

/** 화면과 로그에서 쓰는 한 줄 요약. */
export function formatErrors(errors = []) {
  return errors.map((e) => e.message).join(' / ');
}
