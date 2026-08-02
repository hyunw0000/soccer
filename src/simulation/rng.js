// 시드 기반 결정론적 난수(mulberry32).
// 되감기(rewind)가 성립하려면 난수도 스냅샷/복원이 가능해야 하므로
// 클로저가 아니라 상태를 노출하는 클래스로 둔다.
export class Rng {
  constructor(seed = 2026) {
    this.s = seed | 0;
  }
  next() {
    let s = (this.s + 0x6d2b79f5) | 0;
    this.s = s;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/**
 * 판단(결정)이 아니라 실행 단계의 "성공/실패 확률 판정" 전용 순수 해시 난수.
 * (tick, playerId, actionId)만으로 값이 정해지고 상태를 갖지 않는다 —
 * this.rng(스트림형)처럼 스냅샷에 따로 담을 필요가 없고, 호출 순서와도 무관해서
 * "이 행동을 이 틱에 이 선수가 실행했다"는 사실 하나만으로 언제든 같은 결과가 재현된다.
 * playerId는 `${team}:${idx}`를 정수로 눌러 넣어 쓴다(seededRandomPlayerId 참고).
 */
export function seededRandom(tick, playerId, actionId) {
  let h = (tick | 0) ^ Math.imul((playerId | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((actionId | 0) ^ 0xc2b2ae35, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 1 | h);
  h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

/** `${team}:${idx}` 형태의 선수 키를 seededRandom()에 넣을 정수 id로 바꾼다. */
export function seededRandomPlayerId(team, idx) {
  return (team === 'home' ? 0 : 1) * 1000 + idx;
}

/** carrierDecide()/tryKick() 안에서 같은 틱에 겹치지 않게 쓰는 확률 판정 종류 식별자. */
export const ACTION_ID = {
  PASS_SUCCESS: 1,
  SHOOT_SUCCESS: 2,
  TACKLE_CARRIER: 3,
  TACKLE_LOOSE_BALL: 4,
  GK_CLAIM: 5, // 골키퍼가 공중/지상 볼을 잡느냐(캐치) 쳐내느냐(펀칭) 놓치느냐
};
