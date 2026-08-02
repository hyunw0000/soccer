/**
 * 배치 보드의 원근 투영.
 *
 * 보드는 CSS `perspective(P) rotateX(θ)`로 기울어진 잔디 위에 카드를 세워 둔 모양이다.
 * 카드가 잔디 위 정확한 지점에 놓이려면 CSS가 쓰는 것과 같은 식으로 좌표를 계산해야 하고,
 * 드래그로 카드를 옮기려면 그 반대 변환도 필요하다. 두 방향을 여기서만 정의한다.
 *
 * 좌표계
 * - 정규화 좌표: 도메인 값. x는 진영 방향(공격 방향이 +), z는 좌우. 둘 다 [-0.5, 0.5]
 * - 보드 로컬 좌표(u, v): 기울이기 전 잔디 평면의 px. 원점은 중앙, v가 +면 화면 아래(가까움)
 * - 화면 좌표: 원점에서 실제로 그려지는 위치까지의 px
 *
 * 화면에서는 공격 방향이 위쪽이 되도록 세로로 세운다. 즉 x가 클수록 v가 작다.
 */

export const TILT_DEG = 22;
export const PERSPECTIVE = 900;

/**
 * @param {object} options
 * @param {number} options.width 기울이기 전 잔디 가로 px
 * @param {number} options.height 기울이기 전 잔디 세로 px
 * @param {number} [options.tilt] 기울기(도)
 * @param {number} [options.perspective] CSS perspective 값 px
 */
export function createProjection({ width, height, tilt = TILT_DEG, perspective = PERSPECTIVE }) {
  const rad = (tilt * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);

  /** 보드 로컬 → 화면. scale은 원근 축소율이며 카드 크기에 그대로 쓴다. */
  function project(u, v) {
    // rotateX 후 z = v·sinθ (v가 +면 시청자 쪽으로 나온다) → 배율 P / (P - z)
    const scale = perspective / (perspective - v * sin);
    return { x: u * scale, y: v * cos * scale, scale };
  }

  /** 화면 → 보드 로컬. project()의 정확한 역변환이다. */
  function unproject(x, y) {
    const v = (y * perspective) / (cos * perspective + y * sin);
    const scale = perspective / (perspective - v * sin);
    return { u: x / scale, v };
  }

  /** 정규화 좌표 → 보드 로컬. width 전술이 좌우 폭을 넓힌다. */
  function toLocal({ x, z }, spread = 1) {
    return { u: z * spread * width, v: -x * height };
  }

  /** 보드 로컬 → 정규화 좌표. 필드 밖으로 나가면 경계에 붙인다. */
  function toNormalized({ u, v }, spread = 1) {
    const clamp = (n) => Math.min(0.5, Math.max(-0.5, n));
    return {
      x: clamp(-v / height),
      z: clamp(u / (spread * width)),
    };
  }

  // 기울인 잔디가 화면에서 차지하는 세로 범위. 원점 위치와 보드 높이를 여기서 얻는다.
  const topY = project(0, -height / 2).y;
  const bottomY = project(0, height / 2).y;

  return {
    width,
    height,
    tilt,
    perspective,
    project,
    unproject,
    toLocal,
    toNormalized,
    /** 잔디 전체를 담는 데 필요한 화면 높이 */
    projectedHeight: bottomY - topY,
    /** 보드 위쪽 끝에서 원점(잔디 중앙)까지의 거리 */
    originOffset: -topY,
  };
}
