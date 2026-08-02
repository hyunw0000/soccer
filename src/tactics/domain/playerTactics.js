/**
 * 선수별 전술 도메인 (기획서 "선수별 전술 6축"에 침투·움직임을 더한 8축).
 *
 * 팀 전술 프리셋과 같은 원칙을 따른다 — 감독이 만지는 값은 여기 있는 1..5 단계이고,
 * 계약 값으로 넘길 때는 `toPlayerInstruction()`으로 0..1을 파생시킨다.
 * 이 파일은 MatchSetup 계약을 늘리지 않는다.
 *
 * 값은 자리(slotId)로 보관한다. 지시는 선수가 아니라 자리에 붙는다 —
 * 센터백 자리에 누가 서든 그 자리는 센터백의 지시로 뛴다. 선수를 바꿔 세워도 지시는 그대로다.
 * 감독이 만진 적 없는 자리는 그 자리(역할·좌우 위치)의 기본값으로 시작한다.
 */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** 8축 모두 1..5 단계다. 경기 화면의 ▓▓▓░░ 다섯 칸 표시와 눈금이 같다. */
export const PLAYER_TACTIC_MAX = 5;

export const PLAYER_TACTIC_FIELDS = Object.freeze([
  {
    key: 'forwardness',
    label: '전진성',
    hint: '기본 위치보다 얼마나 앞으로 나갈지 정합니다. 높이면 공격 가담이 늘고 뒷공간을 내줍니다.',
  },
  {
    key: 'width',
    label: '폭',
    hint: '중앙에 머물지 측면으로 벌릴지 정합니다. 높이면 측면을 넓게 쓰고 중앙이 비웁니다.',
  },
  {
    key: 'runs',
    label: '침투',
    hint: '우리가 공을 잡았을 때 상대 뒷공간으로 얼마나 파고들지 정합니다. 높이면 배후를 노리지만 잡히면 그 자리가 비어 있습니다.',
  },
  {
    key: 'roaming',
    label: '움직임',
    hint: '자기 자리를 지킬지 공을 따라 옮겨 다닐지 정합니다. 높이면 공 근처에 자주 나타나고 낮으면 대형을 지킵니다.',
  },
  {
    key: 'pressing',
    label: '압박 강도',
    hint: '공을 가진 상대에게 얼마나 달려들지 정합니다. 탈취 확률이 오르는 대신 체력을 크게 씁니다.',
  },
  {
    key: 'passLength',
    label: '패스 길이',
    hint: '짧게 연결할지 길게 넘길지 정합니다. 낮으면 점유율, 높으면 빠른 전환입니다.',
  },
  {
    key: 'risk',
    label: '리스크',
    hint: '안전한 선택과 모험적인 선택 사이를 정합니다. 높이면 기회도 턴오버도 늘어납니다.',
  },
  {
    key: 'coverage',
    label: '커버 범위',
    hint: '담당 구역을 얼마나 넓게 볼지 정합니다. 높이면 커버가 늘지만 자기 위치를 자주 비웁니다.',
  },
]);

const FIELD_KEYS = Object.freeze(PLAYER_TACTIC_FIELDS.map((f) => f.key));
const FIELD_BY_KEY = new Map(PLAYER_TACTIC_FIELDS.map((f) => [f.key, f]));

/**
 * 자리마다 감독이 실제로 만지는 지시는 다르다.
 * 골키퍼에게 침투를, 센터백에게 오버랩을 물어봐야 소용이 없다.
 *
 * 계약(8축)은 그대로 두고 화면에 내보내는 항목만 자리별로 고른다 —
 * 보여 주지 않는 축은 그 자리의 기본값에 머물고, simulation은 늘 8축을 읽는다.
 * 이름은 FIFA의 개인 지시(오버랩·배후 침투·스위퍼 키퍼 …)를 따라간다.
 */
const field = (key, label, hint) => Object.freeze({ key, label, hint });

// 측면 미드필더와 윙어는 하는 일이 같다. 항목도 같이 쓴다.
const WIDE_FIELDS = Object.freeze([
  field('forwardness', '전진 위치', '수비 라인 앞에 머물지 상대 최종 라인까지 밀고 올라갈지 정합니다.'),
  field('width', '측면 고수', '높이면 터치라인에 붙어 폭을 넓히고, 낮추면 안쪽으로 좁혀 들어옵니다(컷 인).'),
  field('runs', '배후 침투', '측면 뒷공간으로 얼마나 자주 달릴지 정합니다. 높이면 배후를 노리지만 그 자리가 비웁니다.'),
  field('roaming', '자유 이동', '자기 측면을 지킬지 공을 따라 안쪽으로 들어올지 정합니다.'),
  field('pressing', '전방 압박', '상대 수비의 첫 패스에 얼마나 달려들지 정합니다. 체력을 크게 씁니다.'),
  field('coverage', '수비 가담', '공을 잃었을 때 얼마나 깊이 내려와 측면을 덮을지 정합니다.'),
]);

const GROUPS = Object.freeze({
  GK: Object.freeze({
    label: '골키퍼',
    fields: Object.freeze([
      field('forwardness', '스위퍼 키퍼', '박스를 벗어나 뒷공간을 정리할지 정합니다. 높이면 라인을 올려 받쳐 주지만 로빙에 약해집니다.'),
      field('coverage', '크로스 관여', '문전으로 넘어오는 공에 얼마나 적극적으로 나갈지 정합니다.'),
      field('passLength', '배급 길이', '짧게 빌드업을 시작할지 길게 걷어낼지 정합니다.'),
      field('risk', '빌드업 리스크', '압박을 받으며 짧게 이어갈지 안전하게 처리할지 정합니다.'),
    ]),
  }),
  CB: Object.freeze({
    label: '센터백',
    fields: Object.freeze([
      field('forwardness', '라인 높이', '수비 라인을 얼마나 올릴지 정합니다. 높이면 압박이 쉬워지고 배후가 열립니다.'),
      field('pressing', '수비 적극성', '앞으로 나가 끊을지 자리를 지킬지 정합니다. 높이면 인터셉트가 늘고 벗겨질 위험도 커집니다.'),
      field('coverage', '커버 범위', '동료가 끌려 나간 자리를 얼마나 넓게 메울지 정합니다.'),
      field('passLength', '빌드업 패스', '짧게 연결할지 전방으로 길게 넘길지 정합니다.'),
      field('risk', '전진 패스 리스크', '라인을 가르는 패스를 시도할지 안전하게 돌릴지 정합니다.'),
    ]),
  }),
  FB: Object.freeze({
    label: '풀백',
    fields: Object.freeze([
      field('forwardness', '오버랩', '공격 시 얼마나 올라갈지 정합니다. 높이면 측면 숫자를 늘리고 뒷공간을 내줍니다.'),
      field('width', '측면 폭', '안쪽으로 좁힐지 터치라인까지 벌릴지 정합니다.'),
      field('runs', '측면 배후 침투', '윙어를 앞질러 뒷공간으로 달릴지 정합니다.'),
      field('pressing', '수비 적극성', '측면에서 상대에게 얼마나 달려들지 정합니다.'),
      field('coverage', '복귀 범위', '공을 잃었을 때 얼마나 넓게 뒤를 덮을지 정합니다.'),
    ]),
  }),
  CM: Object.freeze({
    label: '중앙 미드필더',
    fields: Object.freeze([
      field('forwardness', '공격 가담', '뒤에 남을지 공격에 올라갈지 정합니다.'),
      field('runs', '박스 침투', '상대 박스 안까지 달려 들어갈지 정합니다.'),
      field('roaming', '자유 이동', '자기 구역을 지킬지 공을 따라 옮겨 다닐지 정합니다.'),
      field('pressing', '압박 강도', '중원에서 얼마나 달려들지 정합니다. 체력을 크게 씁니다.'),
      field('passLength', '패스 길이', '짧게 연결할지 전환 패스를 넣을지 정합니다.'),
      field('risk', '전진 패스 리스크', '기회를 노린 패스를 시도할지 안전하게 돌릴지 정합니다.'),
      field('coverage', '중앙 커버', '수비할 때 중앙을 얼마나 넓게 덮을지 정합니다.'),
    ]),
  }),
  WM: Object.freeze({ label: '측면 미드필더', fields: WIDE_FIELDS }),
  WF: Object.freeze({ label: '윙어', fields: WIDE_FIELDS }),
  ST: Object.freeze({
    label: '중앙 공격수',
    fields: Object.freeze([
      field('runs', '배후 침투', '상대 최종 라인 뒤로 얼마나 자주 달릴지 정합니다.'),
      field('forwardness', '최전방 위치', '상대 수비 어깨에 붙어 있을지 조금 내려서 받을지 정합니다.'),
      field('width', '중앙 고수', '낮추면 중앙에 머물고, 높이면 측면으로 빠져 공간을 만듭니다.'),
      field('roaming', '내려와 연계', '앞에 남을지 내려와 볼을 받아 줄지 정합니다.'),
      field('pressing', '전방 압박', '상대 수비의 첫 패스에 얼마나 달려들지 정합니다.'),
      field('risk', '과감한 마무리', '무리한 슛과 돌파를 얼마나 시도할지 정합니다.'),
    ]),
  }),
});

/** 측면으로 보는 기준. 기본값(createPlayerTactics)이 쓰는 값과 같아야 한다. */
const WIDE_Z = 0.2;

/** 자리 → 지시 묶음 키. 같은 역할이라도 중앙과 측면은 다른 일을 한다. */
export function playerTacticGroupOf(role, z = 0) {
  const wide = Math.abs(z) >= WIDE_Z;
  if (role === 'GK') return 'GK';
  if (role === 'DF') return wide ? 'FB' : 'CB';
  if (role === 'FW') return wide ? 'WF' : 'ST';
  return wide ? 'WM' : 'CM';
}

/**
 * 그 자리에서 보여 줄 지시 항목들.
 * @returns {{key: string, label: string, fields: ReadonlyArray<{key:string,label:string,hint:string}>}}
 */
export function playerTacticGroup(role, z = 0) {
  const key = playerTacticGroupOf(role, z);
  return { key, label: GROUPS[key].label, fields: GROUPS[key].fields };
}

/**
 * 역할별 기본값. 포메이션을 고르면 자리에 맞는 값이 자동으로 주입되는 셈이다.
 * 감독이 한 번이라도 만진 선수는 이 값 대신 저장된 값을 쓴다.
 */
const BY_ROLE = Object.freeze({
  GK: { forwardness: 1, width: 1, runs: 1, roaming: 1, pressing: 1, passLength: 3, risk: 1, coverage: 2 },
  DF: { forwardness: 2, width: 3, runs: 2, roaming: 2, pressing: 3, passLength: 3, risk: 2, coverage: 3 },
  MF: { forwardness: 3, width: 3, runs: 3, roaming: 3, pressing: 4, passLength: 3, risk: 3, coverage: 4 },
  FW: { forwardness: 4, width: 3, runs: 4, roaming: 3, pressing: 4, passLength: 2, risk: 4, coverage: 2 },
});

/**
 * 같은 역할이라도 측면 자리는 더 넓게 벌리고 더 올라간다.
 * z는 정규화 좌표(-0.5 왼쪽 … 0.5 오른쪽)이므로 절댓값이 클수록 측면이다.
 */
export function createPlayerTactics(role, z = 0) {
  const base = { ...(BY_ROLE[role] ?? BY_ROLE.MF) };
  if (role !== 'GK' && Math.abs(z) >= 0.2) {
    base.width = clamp(base.width + 2, 1, PLAYER_TACTIC_MAX);
    base.forwardness = clamp(base.forwardness + 1, 1, PLAYER_TACTIC_MAX);
    base.coverage = clamp(base.coverage + 1, 1, PLAYER_TACTIC_MAX);
    // 측면은 오르내리는 자리다. 배후로 나가고 공을 따라 움직이는 폭도 함께 넓힌다.
    base.runs = clamp(base.runs + 1, 1, PLAYER_TACTIC_MAX);
    base.roaming = clamp(base.roaming + 1, 1, PLAYER_TACTIC_MAX);
  }
  return base;
}

/** 저장값·입력값을 안전한 8축 값으로 되돌린다. 모르는 키는 버린다. */
export function normalizePlayerTactics(input, role = 'MF', z = 0) {
  const out = createPlayerTactics(role, z);
  if (!input || typeof input !== 'object') return out;

  for (const key of FIELD_KEYS) {
    const n = Number(input[key]);
    if (Number.isFinite(n)) out[key] = clamp(Math.round(n), 1, PLAYER_TACTIC_MAX);
  }
  return out;
}

/** 한 축을 정해진 값으로 바꾼 새 객체. 범위 밖 값은 잘린다. */
export function setPlayerField(tactics, key, value) {
  if (!FIELD_BY_KEY.has(key)) return tactics;
  return { ...tactics, [key]: clamp(Math.round(Number(value) || 1), 1, PLAYER_TACTIC_MAX) };
}

/** ◀ ▶ 로 한 칸 옮긴다. 양끝에서는 넘어가지 않는다. */
export function stepPlayerField(tactics, key, delta) {
  if (!FIELD_BY_KEY.has(key)) return tactics;
  return setPlayerField(tactics, key, (tactics[key] ?? 3) + delta);
}

/**
 * 기본값과 같은지. 화면에서 '기본값' 표시와 초기화 버튼에 쓴다.
 * 그 자리에서 보여 주는 축만 본다 — 화면에 없는 축 때문에 '기본값'이 꺼지면
 * 감독은 눈앞의 값이 다 기본인데 왜 그런지 알 수 없다.
 */
export function isDefaultPlayerTactics(tactics, role, z = 0) {
  const base = createPlayerTactics(role, z);
  return playerTacticGroup(role, z).fields.every((f) => tactics?.[f.key] === base[f.key]);
}

/**
 * 그 자리의 지시를 꺼낸다. 저장된 값이 없으면 자리의 기본값을 만든다.
 * @param {Record<string, object>} book 자리(slotId) → 8축 값
 * @param {{slotId: string, role: string, z: number}} assignment
 */
export function slotTacticsOf(book, assignment) {
  if (!assignment) return null;
  const { role, z } = assignment;
  const saved = normalizePlayerTactics(assignment.slotId ? book?.[assignment.slotId] : null, role, z);

  // 이 자리에서 물어보지 않는 축은 자리의 기본값으로 되돌린다.
  // 보드에서 카드를 끌어 자리의 역할이 바뀌면(측면 수비 → 중앙 미드) 화면의 항목도 바뀌는데,
  // 안 보이는 옛 값이 남아 경기에 나가면 감독은 준 적 없는 지시로 경기를 하게 된다.
  const base = createPlayerTactics(role, z);
  const shown = new Set(playerTacticGroup(role, z).fields.map((f) => f.key));
  for (const key of FIELD_KEYS) if (!shown.has(key)) saved[key] = base[key];
  return saved;
}

/**
 * 8축 → 0..1. 표현 계층과 계약 사이의 유일한 접점이다.
 * simulation이 선수별 지시를 읽게 되는 날 이 값을 그대로 넘긴다.
 */
export function toPlayerInstruction(tactics) {
  const t = normalizePlayerTactics(tactics);
  const level01 = (v) => (v - 1) / (PLAYER_TACTIC_MAX - 1);
  return Object.fromEntries(FIELD_KEYS.map((key) => [key, level01(t[key])]));
}
