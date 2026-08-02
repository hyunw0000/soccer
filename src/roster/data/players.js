import raw from './players_korea.json';

export const META = raw.meta;
/** 등번호(num)는 JSON에 실제 대표팀 번호로 들어 있다. 여기서 생성하지 않는다. */
export const PLAYERS = raw.players;

export const byPos = (pos) => PLAYERS.filter((p) => p.pos === pos);
export const findById = (id) => PLAYERS.find((p) => p.id === id) ?? null;
export const overall = (p) => p.stats.overall;

/** 대회 26인 명단 우선 + 능력치 순 정렬 */
export function defaultPool(limit = 23) {
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
