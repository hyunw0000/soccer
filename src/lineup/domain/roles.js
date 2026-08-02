/**
 * 슬롯 역할과 선수 포지션을 연결하는 순수 헬퍼.
 * 선수 원본 데이터는 roster가 소유하므로 여기서는 읽기만 한다.
 *
 * 포지션은 두 층으로 나눈다.
 *  - 라인(role): GK / DF / MF / FW. 검증과 포메이션 요구 인원이 쓰는 굵은 단위.
 *  - 세부 포지션(position code): CB, LWB, CDM, CAM, LF, ST ... 카드에 적히는 이름.
 * 세부 포지션은 깊이(x)와 좌우(z)를 **함께** 읽어 정해진다. 좌우만 보면
 * 중앙에 놓인 카드가 깊이와 상관없이 전부 ST로 읽히는 문제가 생긴다.
 *
 * 세부 포지션 격자 (위가 상대 골문 쪽):
 *
 *   FW  ST 줄            LW   LS   ST   RS   RW
 *   FW  포워드 줄        LW   LF   CF   RF   RW
 *   MF  AM 줄      LWB  LM   LAM  CAM  RAM  RM  RWB
 *   MF  CM 줄      LWB  LM   LCM  CM   RCM  RM  RWB
 *   MF  DM 줄      LWB  LM   LDM  CDM  RDM  RM  RWB
 *   DF  수비 줄         LB   LCB  CB   RCB  RB
 *   GK                            GK
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

/**
 * 세부 포지션 사전. 화면 표기와 적합도 계산의 단일 출처다.
 *  - role: 속한 라인
 *  - family: 같은 성격의 자리 묶음. 적합도는 이 값으로 비교한다.
 *  - side: 'L' | 'C' | 'R'. 좌우 발/측면 선호를 반영한다.
 */
export const POSITIONS = Object.freeze({
  GK: { role: 'GK', family: 'GK', side: 'C', label: '골키퍼' },

  LB: { role: 'DF', family: 'FB', side: 'L', label: '왼쪽 풀백' },
  LCB: { role: 'DF', family: 'CB', side: 'L', label: '왼쪽 센터백' },
  CB: { role: 'DF', family: 'CB', side: 'C', label: '센터백' },
  RCB: { role: 'DF', family: 'CB', side: 'R', label: '오른쪽 센터백' },
  RB: { role: 'DF', family: 'FB', side: 'R', label: '오른쪽 풀백' },

  LWB: { role: 'MF', family: 'WB', side: 'L', label: '왼쪽 윙백' },
  LDM: { role: 'MF', family: 'DM', side: 'L', label: '왼쪽 수비형 미드필더' },
  CDM: { role: 'MF', family: 'DM', side: 'C', label: '수비형 미드필더' },
  RDM: { role: 'MF', family: 'DM', side: 'R', label: '오른쪽 수비형 미드필더' },
  RWB: { role: 'MF', family: 'WB', side: 'R', label: '오른쪽 윙백' },

  LM: { role: 'MF', family: 'WM', side: 'L', label: '왼쪽 미드필더' },
  LCM: { role: 'MF', family: 'CM', side: 'L', label: '왼쪽 중앙 미드필더' },
  CM: { role: 'MF', family: 'CM', side: 'C', label: '중앙 미드필더' },
  RCM: { role: 'MF', family: 'CM', side: 'R', label: '오른쪽 중앙 미드필더' },
  RM: { role: 'MF', family: 'WM', side: 'R', label: '오른쪽 미드필더' },

  LAM: { role: 'MF', family: 'AM', side: 'L', label: '왼쪽 공격형 미드필더' },
  CAM: { role: 'MF', family: 'AM', side: 'C', label: '공격형 미드필더' },
  RAM: { role: 'MF', family: 'AM', side: 'R', label: '오른쪽 공격형 미드필더' },

  LW: { role: 'FW', family: 'WG', side: 'L', label: '왼쪽 윙어' },
  LF: { role: 'FW', family: 'CF', side: 'L', label: '왼쪽 포워드' },
  CF: { role: 'FW', family: 'CF', side: 'C', label: '처진 공격수' },
  RF: { role: 'FW', family: 'CF', side: 'R', label: '오른쪽 포워드' },
  RW: { role: 'FW', family: 'WG', side: 'R', label: '오른쪽 윙어' },

  LS: { role: 'FW', family: 'ST', side: 'L', label: '왼쪽 스트라이커' },
  ST: { role: 'FW', family: 'ST', side: 'C', label: '스트라이커' },
  RS: { role: 'FW', family: 'ST', side: 'R', label: '오른쪽 스트라이커' },
});

export const POSITION_CODES = Object.freeze(Object.keys(POSITIONS));

export function isPosition(code) {
  return Object.hasOwn(POSITIONS, code);
}

/** 세부 포지션의 한국어 이름. 모르는 코드는 코드 그대로 돌려준다. */
export function positionName(code) {
  return POSITIONS[code]?.label ?? code;
}

/** 세부 포지션이 속한 라인. */
export function roleOfPosition(code) {
  return POSITIONS[code]?.role ?? null;
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
 * 선수 데이터의 detail 표기(CB, DM, AM, LW ...)를 세부 포지션 사전의 family/side로 읽는다.
 * roster가 쓰는 표기는 사전보다 거칠기 때문에(측면 구분 없는 DM 등) 여기서 한 번 번역한다.
 */
const DETAIL_MAP = Object.freeze({
  GK: { family: 'GK', side: 'C' },
  CB: { family: 'CB', side: 'C' },
  LB: { family: 'FB', side: 'L' },
  RB: { family: 'FB', side: 'R' },
  LWB: { family: 'WB', side: 'L' },
  RWB: { family: 'WB', side: 'R' },
  DM: { family: 'DM', side: 'C' },
  CM: { family: 'CM', side: 'C' },
  LM: { family: 'WM', side: 'L' },
  RM: { family: 'WM', side: 'R' },
  AM: { family: 'AM', side: 'C' },
  LW: { family: 'WG', side: 'L' },
  RW: { family: 'WG', side: 'R' },
  CF: { family: 'CF', side: 'C' },
  ST: { family: 'ST', side: 'C' },
  FW: { family: 'ST', side: 'C' },
});

/** detail이 없거나 모르는 표기면 라인만 아는 상태로 둔다. */
function playerProfile(player) {
  if (!player) return null;
  const mapped = DETAIL_MAP[player.detail] ?? POSITIONS[player.detail] ?? null;
  return { family: mapped?.family ?? null, side: mapped?.side ?? null };
}

/**
 * 가까운 자리 묶음. 서로 옮겨 세워도 크게 어색하지 않은 family를 이어 둔다.
 * 대칭이어야 하므로 한쪽만 적고 아래에서 양방향으로 펼친다.
 */
const NEIGHBOURS = [
  ['CB', 'FB'],
  ['CB', 'DM'],
  ['FB', 'WB'],
  ['FB', 'WM'],
  ['WB', 'WM'],
  ['WB', 'WG'],
  ['DM', 'CM'],
  ['CM', 'WM'],
  ['CM', 'AM'],
  ['WM', 'WG'],
  ['AM', 'WG'],
  ['AM', 'CF'],
  ['CF', 'ST'],
  ['WG', 'ST'],
];

const NEIGHBOUR_MAP = (() => {
  const map = new Map();
  const link = (a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  };
  for (const [a, b] of NEIGHBOURS) {
    link(a, b);
    link(b, a);
  }
  return map;
})();

/** 라인이 어긋날 때의 감점. 능력치 점수와 같은 단위다. */
const LINE_PENALTY = Object.freeze({ NEXT: 12, FAR: 25, GK: 50 });
/** 같은 라인 안에서 자리 성격이 어긋날 때의 감점. */
const FAMILY_PENALTY = Object.freeze({ NEAR: 5, OTHER: 9, UNKNOWN: 6 });
/** 측면 자리에 반대쪽 선수를 세울 때의 감점. */
const SIDE_PENALTY = 5;

/**
 * 자리에 맞지 않는 정도를 **능력치 점수 단위**로 환산한 감점.
 * 0이면 딱 맞는 자리이고, 값이 클수록 억지로 세운 자리다.
 *
 * 감점을 능력치와 같은 단위로 두면 "이 선수를 낯선 자리에 세우는 대신
 * 몇 점을 손해 보는가"로 바로 비교할 수 있다. 순위를 사전식으로 매기면
 * 아무리 뛰어난 선수도 자리가 어긋나는 순간 무조건 밀려난다.
 *
 * @param {object|null} player roster의 선수
 * @param {string} code 세부 포지션 코드 (CAM, LWB ...)
 * @returns {number} 감점. 선수가 없으면 Infinity.
 */
export function positionPenalty(player, code) {
  if (!player) return Infinity;
  const target = POSITIONS[code];
  if (!target) return LINE_PENALTY.FAR;

  const line = ROLES.indexOf(player.pos);
  const goal = ROLES.indexOf(target.role);
  // 골키퍼와 필드 플레이어는 서로 대신할 수 없다.
  if (player.pos === 'GK' || target.role === 'GK') {
    if (player.pos !== target.role) return LINE_PENALTY.GK;
  }

  const gap = line < 0 || goal < 0 ? 2 : Math.abs(line - goal);
  let penalty = gap === 0 ? 0 : gap === 1 ? LINE_PENALTY.NEXT : LINE_PENALTY.FAR;

  const profile = playerProfile(player);
  if (!profile?.family) penalty += FAMILY_PENALTY.UNKNOWN;
  else if (profile.family === target.family) penalty += 0;
  else if (NEIGHBOUR_MAP.get(profile.family)?.has(target.family)) penalty += FAMILY_PENALTY.NEAR;
  else penalty += FAMILY_PENALTY.OTHER;

  // 왼쪽 선수를 오른쪽에 세울 때만 감점한다. 중앙 성향(CB·CM·ST처럼 좌우 구분이
  // 없는 선수)은 LCB·RCB 같은 좌우 슬롯에 세워도 어색하지 않다 — 그 이름은
  // 짝의 어느 쪽인지를 가리킬 뿐 왼발·오른발을 요구하는 자리가 아니다.
  const sided = target.side !== 'C' && profile?.side && profile.side !== 'C';
  if (sided && profile.side !== target.side) penalty += SIDE_PENALTY;
  return penalty;
}

/**
 * 이 자리에 세웠을 때의 실질 값어치. 자동 편성과 목록 정렬이 함께 쓴다.
 * 능력치에서 자리 감점을 뺀 값이라, 자리가 조금 어긋나도 충분히 뛰어난 선수는 살아남는다.
 */
export function selectionScore(player, code) {
  if (!player) return -Infinity;
  return playerOverall(player) - positionPenalty(player, code);
}

/**
 * 배치 보드의 구역. x는 진영 방향(자기 골문 -0.5 → 상대 골문 +0.5)이고
 * 카드를 놓은 x가 어느 구역에 들어가느냐로 그 자리의 역할이 정해진다.
 *
 * `from`은 포함, `to`는 미포함이다. 배열 순서는 자기 진영 → 상대 진영이다.
 * 포메이션 기본 좌표는 모두 자기 역할 구역 안에 들어가도록 경계를 잡았다.
 *
 * MF/FW 경계는 0.10이다. 공격형 미드필더가 설 깊이(0.02~0.10)를 미드필더 쪽에
 * 남겨 두지 않으면, 중앙 앞선에 놓은 카드가 전부 공격수로 읽힌다.
 */
export const ROLE_ZONES = Object.freeze([
  Object.freeze({ role: 'GK', from: -0.5, to: -0.38 }),
  Object.freeze({ role: 'DF', from: -0.38, to: -0.22 }),
  Object.freeze({ role: 'MF', from: -0.22, to: 0.1 }),
  Object.freeze({ role: 'FW', from: 0.1, to: 0.5 }),
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

/**
 * 라인 안에서 다시 나누는 깊이 띠. 같은 미드필더라도 어느 띠에 섰는지로
 * 수비형 / 중앙 / 공격형이 갈린다. `to`는 미포함이며 마지막 띠가 나머지를 받는다.
 * DF·FW도 같은 구조를 쓰지만 지금은 FW만 두 띠로 나눈다.
 */
export const DEPTH_BANDS = Object.freeze({
  DF: Object.freeze([Object.freeze({ band: 'DF', to: Infinity })]),
  MF: Object.freeze([
    Object.freeze({ band: 'DM', to: -0.15 }),
    Object.freeze({ band: 'CM', to: -0.02 }),
    Object.freeze({ band: 'AM', to: Infinity }),
  ]),
  FW: Object.freeze([
    // 최전방보다 한 발 내려선 자리. 세컨 스트라이커/폴스 나인과 윙어가 여기 선다.
    Object.freeze({ band: 'CF', to: 0.17 }),
    Object.freeze({ band: 'ST', to: Infinity }),
  ]),
});

/** 깊이 x가 속한 띠 이름. 라인 안에서만 의미가 있다. */
export function depthBand(role, x) {
  const bands = DEPTH_BANDS[role];
  if (!bands) return role;
  const value = Number.isFinite(x) ? x : 0;
  return bands.find((entry) => value < entry.to).band;
}

/**
 * 깊이 띠별 좌우 구획. 안쪽이 아니라 왼쪽부터 오른쪽 순이며 `to`는 미포함이다.
 * 미드필더의 |z| ≥ 0.31은 터치라인에 붙은 자리라 띠와 상관없이 윙백으로 읽는다.
 */
const LATERAL_LABELS = Object.freeze({
  DF: Object.freeze([
    { to: -0.22, label: 'LB' },
    { to: -0.06, label: 'LCB' },
    { to: 0.06, label: 'CB' },
    { to: 0.22, label: 'RCB' },
    { to: Infinity, label: 'RB' },
  ]),
  DM: Object.freeze([
    { to: -0.32, label: 'LWB' },
    { to: -0.24, label: 'LM' },
    { to: -0.06, label: 'LDM' },
    { to: 0.06, label: 'CDM' },
    { to: 0.24, label: 'RDM' },
    { to: 0.32, label: 'RM' },
    { to: Infinity, label: 'RWB' },
  ]),
  CM: Object.freeze([
    { to: -0.32, label: 'LWB' },
    { to: -0.24, label: 'LM' },
    { to: -0.06, label: 'LCM' },
    { to: 0.06, label: 'CM' },
    { to: 0.24, label: 'RCM' },
    { to: 0.32, label: 'RM' },
    { to: Infinity, label: 'RWB' },
  ]),
  AM: Object.freeze([
    { to: -0.32, label: 'LWB' },
    { to: -0.24, label: 'LM' },
    { to: -0.06, label: 'LAM' },
    { to: 0.06, label: 'CAM' },
    { to: 0.24, label: 'RAM' },
    { to: 0.32, label: 'RM' },
    { to: Infinity, label: 'RWB' },
  ]),
  // 포워드 줄. 최전방보다 한 발 내려선 자리라 CF·LF·RF로 읽는다.
  CF: Object.freeze([
    { to: -0.22, label: 'LW' },
    { to: -0.07, label: 'LF' },
    { to: 0.07, label: 'CF' },
    { to: 0.22, label: 'RF' },
    { to: Infinity, label: 'RW' },
  ]),
  // 최전방 줄. 상대 최종 라인에 붙는 자리다.
  ST: Object.freeze([
    { to: -0.22, label: 'LW' },
    { to: -0.07, label: 'LS' },
    { to: 0.07, label: 'ST' },
    { to: 0.22, label: 'RS' },
    { to: Infinity, label: 'RW' },
  ]),
});

/**
 * 지금 놓인 자리에서 읽히는 세부 포지션 코드 (LB, CDM, CAM, ST ...).
 * 포메이션 슬롯 이름이 아니라 실제 좌표에서 파생하므로, 카드를 옮기면 이름도 따라 바뀐다.
 *
 * @param {string} role 라인. 보통 roleAtX(x)와 같은 값이다.
 * @param {number} x 깊이 [-0.5, 0.5]
 * @param {number} z 좌우 [-0.5, 0.5]
 */
export function positionCode(role, x, z) {
  if (role === 'GK') return 'GK';
  const table = LATERAL_LABELS[depthBand(role, x)];
  if (!table) return role;
  const value = Number.isFinite(z) ? z : 0;
  return table.find((entry) => value < entry.to).label;
}

/** assignment/슬롯처럼 좌표를 들고 있는 객체에서 바로 세부 포지션을 읽는다. */
export function positionOf(spot) {
  if (!spot) return null;
  return positionCode(spot.role ?? roleAtX(spot.x), spot.x, spot.z);
}

/** 카드에 적는 이름. positionCode의 별칭이며 화면 코드가 읽기 쉬우라고 남긴다. */
export function positionLabel(role, x, z) {
  return positionCode(role, x, z);
}
