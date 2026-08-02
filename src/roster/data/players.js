import raw from './players_korea.json';

const MAX_NUM = 99;

export const META = raw.meta;
/** 원본 JSON은 등번호가 없으므로 로드 시점에 안정적인 번호를 부여한다. */
export const PLAYERS = assignNumbers(raw.players);

/**
 * 선수마다 1~99 사이의 겹치지 않는 등번호를 준다.
 * 후보가 꽉 찼을 때 무한 루프에 빠지지 않도록 탐색 횟수를 번호 개수로 제한한다.
 * (선수 55명 < 99 이므로 빈 번호는 반드시 존재한다)
 */
function assignNumbers(players) {
  const used = new Set();
  return players.map((p, i) => {
    let n = p.pos === 'GK' ? 1 : ((i * 7) % 30) + 2;
    for (let step = 0; step < MAX_NUM && used.has(n); step++) n = (n % MAX_NUM) + 1;
    used.add(n);
    return { ...p, num: n };
  });
}

export const byPos = (pos) => PLAYERS.filter((p) => p.pos === pos);
export const findById = (id) => PLAYERS.find((p) => p.id === id) ?? null;
export const overall = (p) => p.stats.overall;

/** 기본 소집 명단은 실제 대회 명단(squad2026). 부족하면 능력치 순으로 채운다. */
export function defaultPool(limit = 26) {
  return [...PLAYERS]
    .sort((a, b) => Number(b.squad2026) - Number(a.squad2026) || overall(b) - overall(a))
    .slice(0, limit)
    .map((p) => p.id);
}

/**
 * 포지션 요구 수량에 맞춰 풀에서 베스트 XI를 뽑는다.
 * @param {string[]} poolIds 선택된 선수 id 목록
 * @param {{GK:number,DF:number,MF:number,FW:number}} needs
 * @returns {object[]} 슬롯 순서(GK→DF→MF→FW)에 맞춘 선수 배열
 */
export function autoLineup(poolIds, needs) {
  const pool = poolIds.map(findById).filter(Boolean);
  const picked = [];
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    const cands = pool
      .filter((p) => p.pos === pos && !picked.includes(p))
      .sort((a, b) => overall(b) - overall(a));
    for (let i = 0; i < needs[pos]; i++) {
      // 포지션 인원이 모자라면 남은 최고 능력치로 메운다
      const p = cands[i] ?? pool.filter((x) => !picked.includes(x)).sort((a, b) => overall(b) - overall(a))[0];
      if (p) picked.push(p);
    }
  }
  return picked;
}

/** Sim이 요구하는 최소 형태로 변환 */
export function toSimMeta(p) {
  return {
    id: p.id,
    num: p.num,
    name: p.name,
    pace: p.stats.pace,
    stamina: p.stats.stamina,
  };
}
