/**
 * 전술 프리셋 도메인.
 *
 * 감독이 실제로 만지는 값(수비 스타일, 폭, 깊이 …)을 그대로 담는 표현 계층이며,
 * simulation이 읽는 Contracts v1 전술 네 값(0..1)은 `toTactics()`로 파생시킨다.
 * 즉 이 파일은 계약을 늘리지 않는다 — 감독의 조작을 계약 값으로 번역할 뿐이다.
 */

export const DEFENSE_STYLES = Object.freeze([
  '후퇴',
  '밸런스',
  '볼 터치 실수 시 압박',
  '공 뺏긴 직후 압박',
  '지속적인 압박',
]);

export const BUILD_UP_STYLES = Object.freeze(['밸런스', '느린 빌드업', '빠른 빌드업', '짧은 패스', '긴 패스']);

export const CHANCE_STYLES = Object.freeze(['밸런스', '짧은 패스', '긴 패스', '빠른 빌드업', '측면 돌파']);

export const MENTALITIES = Object.freeze([
  '매우 수비적',
  '수비적',
  '약간 수비적',
  '보통',
  '약간 공격적',
  '공격적',
  '매우 공격적',
]);

/**
 * 화면이 그리는 조작 행 목록.
 * `type: 'option'`은 ◀ ▶ 로 고르는 값, `type: 'level'`은 칸으로 채우는 단계 값이다.
 */
export const TACTIC_FIELDS = Object.freeze([
  {
    key: 'defenseStyle',
    group: 'defense',
    label: '수비 스타일',
    type: 'option',
    options: DEFENSE_STYLES,
    hint: '공을 잃었을 때 팀이 얼마나 앞에서부터 압박할지 정합니다.',
  },
  {
    key: 'defenseWidth',
    group: 'defense',
    label: '폭',
    type: 'level',
    max: 10,
    hint: '수비 간격을 적절한 균형을 유지하여 조정합니다.',
  },
  {
    key: 'depth',
    group: 'defense',
    label: '깊이',
    type: 'level',
    max: 10,
    hint: '수비 라인을 얼마나 높이 끌어올릴지 정합니다.',
  },
  {
    key: 'buildUp',
    group: 'attack',
    label: '빌드업 플레이',
    type: 'option',
    options: BUILD_UP_STYLES,
    hint: '후방에서 공을 전개하는 방식을 정합니다.',
  },
  {
    key: 'chanceCreation',
    group: 'attack',
    label: '기회 만들기',
    type: 'option',
    options: CHANCE_STYLES,
    hint: '상대 진영에서 득점 기회를 만드는 방식을 정합니다.',
  },
  {
    key: 'attackWidth',
    group: 'attack',
    label: '폭',
    type: 'level',
    max: 10,
    hint: '공격 시 좌우로 얼마나 넓게 벌릴지 조정합니다.',
  },
  {
    key: 'playersInBox',
    group: 'attack',
    label: '박스 안쪽 선수',
    type: 'level',
    max: 10,
    hint: '크로스 상황에서 페널티 박스로 들어갈 선수 수를 조정합니다.',
  },
  {
    key: 'corners',
    group: 'attack',
    label: '코너킥',
    type: 'level',
    max: 5,
    hint: '코너킥 상황에서 공격에 가담할 선수 수를 조정합니다.',
  },
  {
    key: 'freeKicks',
    group: 'attack',
    label: '프리킥',
    type: 'level',
    max: 5,
    hint: '프리킥 상황에서 공격에 가담할 선수 수를 조정합니다.',
  },
]);

const FIELD_BY_KEY = new Map(TACTIC_FIELDS.map((f) => [f.key, f]));

/** 프리셋 하나가 가지는 값. 이름은 감독이 바꿀 수 있으므로 따로 둔다. */
const BASE = Object.freeze({
  defenseStyle: '밸런스',
  defenseWidth: 4,
  depth: 5,
  buildUp: '밸런스',
  chanceCreation: '밸런스',
  attackWidth: 4,
  playersInBox: 10,
  corners: 3,
  freeKicks: 3,
  mentality: 3,
});

/** 공장 초기값. `내 전술`은 기본 전술을 복사한 빈 슬롯이다. */
export const PRESET_LIBRARY = Object.freeze([
  { name: '기본 전술', ...BASE },
  {
    name: '역습',
    ...BASE,
    defenseStyle: '볼 터치 실수 시 압박',
    defenseWidth: 6,
    depth: 5,
    buildUp: '빠른 빌드업',
    chanceCreation: '빠른 빌드업',
    attackWidth: 7,
    playersInBox: 8,
  },
  {
    name: '강한 압박',
    ...BASE,
    defenseStyle: '지속적인 압박',
    defenseWidth: 5,
    depth: 9,
    attackWidth: 6,
    playersInBox: 5,
  },
  {
    name: '점유율',
    ...BASE,
    defenseStyle: '공 뺏긴 직후 압박',
    defenseWidth: 6,
    depth: 5,
    buildUp: '짧은 패스',
    chanceCreation: '짧은 패스',
    attackWidth: 4,
    playersInBox: 6,
  },
  {
    name: '롱 볼',
    ...BASE,
    defenseStyle: '후퇴',
    defenseWidth: 6,
    depth: 3,
    buildUp: '긴 패스',
    chanceCreation: '긴 패스',
    attackWidth: 9,
    playersInBox: 4,
  },
  { name: '내 전술 1', ...BASE },
  { name: '내 전술 2', ...BASE },
  { name: '내 전술 3', ...BASE },
  { name: '내 전술 4', ...BASE },
  { name: '내 전술 5', ...BASE },
]);

export const PRESET_COUNT = PRESET_LIBRARY.length;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** 공장 초기값 사본. 화면의 `초기화`가 되돌리는 지점이다. */
export function createPreset(index) {
  return { ...PRESET_LIBRARY[clamp(index | 0, 0, PRESET_COUNT - 1)] };
}

/**
 * 저장값·입력값을 안전한 프리셋으로 되돌린다.
 * 모르는 키는 버리고, 범위를 벗어난 값은 해당 슬롯의 공장 초기값으로 되돌린다.
 */
export function normalizePreset(input, index = 0) {
  const out = createPreset(index);
  if (!input || typeof input !== 'object') return out;

  if (typeof input.name === 'string' && input.name.trim()) out.name = input.name.trim().slice(0, 12);

  for (const field of TACTIC_FIELDS) {
    const value = input[field.key];
    if (field.type === 'option') {
      if (field.options.includes(value)) out[field.key] = value;
    } else {
      const n = Number(value);
      if (Number.isFinite(n)) out[field.key] = clamp(Math.round(n), 1, field.max);
    }
  }

  const mentality = Number(input.mentality);
  if (Number.isFinite(mentality)) out.mentality = clamp(Math.round(mentality), 0, MENTALITIES.length - 1);

  return out;
}

/** 조작 행 하나의 값을 바꾼 새 프리셋. 값은 항상 허용 범위 안으로 잘린다. */
export function setField(preset, key, value) {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return preset;
  if (field.type === 'option') {
    if (!field.options.includes(value)) return preset;
    return { ...preset, [key]: value };
  }
  return { ...preset, [key]: clamp(Math.round(Number(value) || 1), 1, field.max) };
}

/** ◀ ▶ 로 옵션을 한 칸 옮긴다. 양끝에서는 넘어가지 않는다. */
export function stepField(preset, key, delta) {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return preset;
  if (field.type === 'option') {
    const at = field.options.indexOf(preset[key]);
    return setField(preset, key, field.options[clamp(at + delta, 0, field.options.length - 1)]);
  }
  return setField(preset, key, preset[key] + delta);
}

export function setMentality(preset, index) {
  return { ...preset, mentality: clamp(Math.round(index) || 0, 0, MENTALITIES.length - 1) };
}

export const fieldMax = (key) => FIELD_BY_KEY.get(key)?.max ?? 10;

// ---------- Contracts v1 전술로의 번역 ----------

const TEMPO_BY_BUILD_UP = Object.freeze({
  밸런스: 0.5,
  '느린 빌드업': 0.22,
  '빠른 빌드업': 0.9,
  '짧은 패스': 0.38,
  '긴 패스': 0.72,
});

const TEMPO_BY_CHANCE = Object.freeze({
  밸런스: 0.5,
  '짧은 패스': 0.38,
  '긴 패스': 0.72,
  '빠른 빌드업': 0.9,
  '측면 돌파': 0.62,
});

const PRESSING_BY_STYLE = Object.freeze({
  후퇴: 0.1,
  밸런스: 0.45,
  '볼 터치 실수 시 압박': 0.62,
  '공 뺏긴 직후 압박': 0.78,
  '지속적인 압박': 0.95,
});

const level01 = (value, max) => clamp((value - 1) / (max - 1), 0, 1);

/**
 * 프리셋 → simulation이 읽는 전술 네 값(0..1).
 * 여기가 표현 계층과 계약 사이의 유일한 접점이다.
 */
export function toTactics(preset) {
  const p = normalizePreset(preset);
  const attack = p.mentality / (MENTALITIES.length - 1); // 0 수비적 … 1 공격적

  return {
    lineHeight: clamp(level01(p.depth, 10) * 0.85 + attack * 0.15, 0, 1),
    pressing: clamp((PRESSING_BY_STYLE[p.defenseStyle] ?? 0.5) * 0.85 + attack * 0.15, 0, 1),
    tempo: clamp(
      (TEMPO_BY_BUILD_UP[p.buildUp] ?? 0.5) * 0.6 + (TEMPO_BY_CHANCE[p.chanceCreation] ?? 0.5) * 0.4,
      0,
      1
    ),
    // 보드·시뮬레이션의 좌우 전개는 수비 폭보다 공격 폭이 지배한다.
    width: clamp(level01(p.attackWidth, 10) * 0.75 + level01(p.defenseWidth, 10) * 0.25, 0, 1),
  };
}
