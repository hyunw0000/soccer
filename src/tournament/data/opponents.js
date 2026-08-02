/**
 * 상대 팀 데이터 (담당자 2).
 *
 * 대진표 정책이 승인되기 전이므로 대회 규모에 종속된 대진 생성은 만들지 않는다.
 * 지금은 경기 흐름을 끝까지 연결하기 위한 고정 상대 한 팀만 둔다.
 * 16강 등 실제 대회 구조가 승인되면 이 파일은 팀 목록으로 확장된다.
 */

const WORLD_XI = [
  { n: 1, name: 'Neuer', pos: 'GK', overall: 84, pace: 62, stamina: 74 },
  { n: 2, name: 'Hakimi', pos: 'DF', overall: 85, pace: 92, stamina: 84 },
  { n: 4, name: 'Van Dijk', pos: 'DF', overall: 87, pace: 78, stamina: 80 },
  { n: 5, name: 'Rüdiger', pos: 'DF', overall: 85, pace: 82, stamina: 82 },
  { n: 3, name: 'Theo', pos: 'DF', overall: 84, pace: 91, stamina: 85 },
  { n: 8, name: 'Bellingham', pos: 'MF', overall: 88, pace: 80, stamina: 88 },
  { n: 6, name: 'Rodri', pos: 'MF', overall: 89, pace: 68, stamina: 86 },
  { n: 10, name: 'De Bruyne', pos: 'MF', overall: 88, pace: 72, stamina: 80 },
  { n: 7, name: 'Vinícius', pos: 'FW', overall: 89, pace: 95, stamina: 82 },
  { n: 9, name: 'Haaland', pos: 'FW', overall: 91, pace: 89, stamina: 80 },
  { n: 11, name: 'Salah', pos: 'FW', overall: 89, pace: 90, stamina: 83 },
];

/** Player와 같은 모양으로 맞춘다 — lineup의 자동 배치가 pos와 stats를 읽는다. */
export const WORLD_XI_PLAYERS = Object.freeze(
  WORLD_XI.map((p) => ({
    id: `wld_${p.name.toLowerCase().replace(/[^a-z]/g, '')}`,
    name: p.name,
    nameEn: p.name,
    num: p.n,
    pos: p.pos,
    detail: p.pos,
    club: 'World XI',
    stats: Object.freeze({
      overall: p.overall,
      attack: p.overall,
      defense: p.overall,
      stamina: p.stamina,
      pace: p.pace,
      pass: p.overall,
      shoot: p.overall,
    }),
  }))
);

export const WORLD_XI_TEAM = Object.freeze({
  id: 'WLD',
  name: 'WORLD XI',
  code: 'WLD',
  formationId: '4-4-2',
  style: '두 줄 블록 후 측면 역습',
  strength: 87,
});
