// x-z 평면 벡터 헬퍼 (y는 높이라 시뮬에서 쓰지 않는다)
export const vlen = (x, z) => Math.hypot(x, z);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
