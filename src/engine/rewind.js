import { PARAMS } from './params.js';

/**
 * 되감기 링버퍼.
 * 매 프레임이 아니라 intervalTicks 마다 스냅샷을 떠서 메모리를 아낀다.
 * (6틱 = 0.1초 간격, 900개 → 약 90초 분량)
 */
export class RewindBuffer {
  constructor({ intervalTicks = 6, capacity = 900 } = {}) {
    this.intervalTicks = intervalTicks;
    this.capacity = capacity;
    this.buf = new Array(capacity);
    this.head = 0; // 다음에 덮어쓸 위치
    this.size = 0;
  }

  get stepSeconds() {
    return this.intervalTicks * PARAMS.dt;
  }

  /** 현재 보관 중인 되감기 가능 시간(초) */
  get availableSeconds() {
    return Math.max(0, this.size - 1) * this.stepSeconds;
  }

  clear() {
    this.buf.fill(undefined);
    this.head = 0;
    this.size = 0;
  }

  /** 매 스텝 뒤에 호출. 간격에 걸릴 때만 실제로 저장한다. */
  maybeRecord(sim) {
    if (sim.tick % this.intervalTicks !== 0) return;
    this.buf[this.head] = sim.snapshot();
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  /**
   * seconds 만큼 과거로 되감고, 그 이후 기록은 버린다(미래 중복 방지).
   * @returns {object|null} 복원할 스냅샷
   */
  rewind(seconds) {
    if (this.size === 0) return null;
    const back = Math.min(Math.round(seconds / this.stepSeconds), this.size - 1);
    const idx = (this.head - 1 - back + this.capacity * 2) % this.capacity;
    this.head = (idx + 1) % this.capacity;
    this.size -= back;
    return this.buf[idx];
  }
}
