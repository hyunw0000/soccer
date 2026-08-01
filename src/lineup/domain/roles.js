/**
 * 슬롯 역할과 선수 포지션을 연결하는 순수 헬퍼.
 * 선수 원본 데이터는 roster가 소유하므로 여기서는 읽기만 한다.
 */

export const ROLES = Object.freeze(['GK', 'DF', 'MF', 'FW']);

export const ROLE_LABEL = Object.freeze({
  GK: '골키퍼',
  DF: '수비수',
  MF: '미드필더',
  FW: '공격수',
});

export function isRole(value) {
  return ROLES.includes(value);
}

/** 선수의 주 포지션이 슬롯 역할과 일치하는가. */
export function roleFits(player, role) {
  return Boolean(player) && player.pos === role;
}

/**
 * 슬롯 역할 기준 적합도. 정렬에만 쓰는 값이며 경기 결과에 영향을 주지 않는다.
 * 주 포지션 일치 > 인접 라인 > 그 외 순으로 점수를 준다.
 */
export function roleFitScore(player, role) {
  if (!player) return -1;
  if (player.pos === role) return 2;
  const line = ROLES.indexOf(player.pos);
  const target = ROLES.indexOf(role);
  if (line < 0 || target < 0) return 0;
  // GK는 필드 플레이어와 호환되지 않는다고 본다.
  if (player.pos === 'GK' || role === 'GK') return 0;
  return Math.abs(line - target) === 1 ? 1 : 0;
}

/** 능력치는 roster가 소유하므로 없으면 0으로 낮춘다. */
export function playerOverall(player) {
  return Number(player?.stats?.overall) || 0;
}

/**
 * 배치 보드의 구역. x는 진영 방향(자기 골문 -0.5 → 상대 골문 +0.5)이고
 * 카드를 놓은 x가 어느 구역에 들어가느냐로 그 자리의 역할이 정해진다.
 *
 * `from`은 포함, `to`는 미포함이다. 배열 순서는 자기 진영 → 상대 진영이다.
 * 포메이션 기본 좌표는 모두 자기 역할 구역 안에 들어가도록 경계를 잡았다.
 */
export const ROLE_ZONES = Object.freeze([
  Object.freeze({ role: 'GK', from: -0.5, to: -0.38 }),
  Object.freeze({ role: 'DF', from: -0.38, to: -0.2 }),
  Object.freeze({ role: 'MF', from: -0.2, to: 0.05 }),
  Object.freeze({ role: 'FW', from: 0.05, to: 0.5 }),
]);

/**
 * 진영 좌표가 속한 구역의 역할.
 * @param {number} x 정규화 좌표 [-0.5, 0.5]
 * @param {{allowGk?: boolean}} [options] 골키퍼 슬롯이 아니면 GK 구역도 수비로 읽는다.
 */
export function roleAtX(x, { allowGk = false } = {}) {
  const value = Number.isFinite(x) ? x : 0;
  const zone = ROLE_ZONES.find((z) => value < z.to) ?? ROLE_ZONES[ROLE_ZONES.length - 1];
  // 필드 플레이어를 골문 앞에 놓아도 골키퍼가 되지는 않는다. 최종 수비로 본다.
  if (zone.role === 'GK' && !allowGk) return 'DF';
  return zone.role;
}

// 좌우 위치를 이름으로 읽는 기준. 안쪽부터 바깥쪽 순으로 훑는다.
const LATERAL_LABELS = Object.freeze({
  DF: Object.freeze([
    { to: -0.2, label: 'LB' },
    { to: -0.06, label: 'LCB' },
    { to: 0.06, label: 'CB' },
    { to: 0.2, label: 'RCB' },
    { to: Infinity, label: 'RB' },
  ]),
  MF: Object.freeze([
    { to: -0.24, label: 'LM' },
    { to: -0.06, label: 'LCM' },
    { to: 0.06, label: 'CM' },
    { to: 0.24, label: 'RCM' },
    { to: Infinity, label: 'RM' },
  ]),
  FW: Object.freeze([
    { to: -0.14, label: 'LW' },
    { to: 0.14, label: 'ST' },
    { to: Infinity, label: 'RW' },
  ]),
});

/**
 * 지금 놓인 자리에서 읽히는 포지션 이름 (LB, CM, ST ...).
 * 포메이션 슬롯 이름이 아니라 실제 좌표에서 파생하므로, 카드를 옮기면 이름도 따라 바뀐다.
 */
export function positionLabel(role, z) {
  if (role === 'GK') return 'GK';
  const table = LATERAL_LABELS[role];
  if (!table) return role;
  const value = Number.isFinite(z) ? z : 0;
  return table.find((entry) => value < entry.to).label;
}
