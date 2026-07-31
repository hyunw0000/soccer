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
