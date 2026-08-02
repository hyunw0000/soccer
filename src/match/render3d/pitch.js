import * as THREE from 'three';
import { FIELD, HALF, GOAL_W, GOAL_H, PENALTY_AREA, PARAMS } from '../../simulation/index.js';

/**
 * 잔디 텍스처의 축척. 캔버스 한 변을 경기장 한 변에 그대로 입히므로,
 * 여기서 정한 px/m가 곧 "그려진 라인의 좌표"가 된다.
 *
 * 예전에는 캔버스 여백(40px)만큼 흰 선을 안쪽에 그렸는데, 그게 정확히 2.0m였다.
 * 시뮬레이션은 실제 라인(±52.5 / ±34)을 기준으로 도니까 화면만 2m 좁은 경기장을
 * 보여 준 셈이고, 그래서 이런 게 보였다(중립 전술 12경기 실측):
 *
 *   - 선수가 그려진 터치라인 밖에 서 있던 시간 0.86%, 그려진 골라인 밖 5.70%
 *     (라인 높이를 최저로 내리면 11.71%까지 올라간다)
 *   - 볼이 그려진 라인 밖에 있는데 경기가 계속되던 시간 2.06%
 *   - 스로인 경기당 15.5회가 전부 그려진 라인 1.5m **바깥**에서 재개
 *   - 골대는 HALF.L(실제 골라인)에 놓여 그려진 골라인보다 2m 밖에 서 있었다
 *     → 그 사이에 선 수비수가 "골대 뒤에서 수비하는" 것처럼 보였다
 *
 * 이제 모든 마킹을 시뮬레이션 상수에서 직접 환산한다. 손으로 적은 px 값이 없으니
 * 시뮬 쪽 치수가 바뀌어도 화면이 따라온다.
 */
const PX_PER_M = 20;
const LINE_PX = 4; // 선 두께(≈0.2m)

const toPx = (m) => m * PX_PER_M;
/** 월드 x(-52.5..52.5) → 캔버스 x */
const cx = (x) => toPx(x + HALF.L);
/** 월드 z(-34..34) → 캔버스 z. 평면이 -90도 눕혀져 있어 캔버스 아래쪽이 +z다. */
const cz = (z) => toPx(z + HALF.W);

// 실제 규격 중 시뮬레이션이 정의하지 않는 값들.
const GOAL_AREA_DEPTH = 5.5;
const PENALTY_SPOT_DEPTH = 11;
const CORNER_ARC_R = 1;
/** 골 에어리어 폭은 골대 양옆으로 5.5m씩. GOAL_W가 게임 설정(12m)이라 거기서 파생시킨다. */
const GOAL_AREA_HALF_W = GOAL_W / 2 + GOAL_AREA_DEPTH;

/**
 * 페널티 아크에서 박스 **밖**에 남는 각도의 절반.
 * 스폿에서 반지름 9.15m 원을 그리면 박스 앞선(스폿에서 5.5m)을 벗어나는 부분만 보인다.
 */
const ARC_HALF_ANGLE = Math.acos((PENALTY_AREA.depth - PENALTY_SPOT_DEPTH) / PARAMS.centerCircleRadius);

/** 라인이 그려진 잔디 텍스처를 캔버스로 생성 (외부 이미지 의존 0) */
function pitchTexture() {
  const c = document.createElement('canvas');
  c.width = toPx(FIELD.L);
  c.height = toPx(FIELD.W);
  const g = c.getContext('2d');

  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? '#2a8f43' : '#238a3d';
    g.fillRect((i * c.width) / 14, 0, c.width / 14, c.height);
  }

  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = LINE_PX;
  g.lineCap = 'butt';

  // 터치라인·골라인은 경기장 경계 **위**에 그린다. 실제 축구처럼 선이 경기장 안쪽에
  // 포함되도록 선 두께의 절반만 들여놓는다(0.1m) — 이러면 캔버스 밖으로 잘리지도 않는다.
  const half = LINE_PX / 2;
  g.strokeRect(half, half, c.width - LINE_PX, c.height - LINE_PX);

  // 하프웨이 라인
  g.beginPath();
  g.moveTo(cx(0), 0);
  g.lineTo(cx(0), c.height);
  g.stroke();

  // 센터 서클 — 킥오프 제한 거리(시뮬이 실제로 쓰는 값)와 같은 원이어야
  // "상대는 원 밖에 서 있어야 한다"는 규칙이 화면과 맞는다.
  g.beginPath();
  g.arc(cx(0), cz(0), toPx(PARAMS.centerCircleRadius), 0, Math.PI * 2);
  g.stroke();

  // 센터 스폿
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(cx(0), cz(0), LINE_PX * 0.9, 0, Math.PI * 2);
  g.fill();

  for (const s of [-1, 1]) {
    const goalLine = s * HALF.L;

    // 페널티 에어리어 — 시뮬의 PENALTY_AREA 그대로. 예전 텍스처는 폭이 28m였는데
    // 시뮬은 40.32m로 판정하고 있었다(골키퍼가 볼을 손에 들 수 있는 범위 등).
    const boxFront = goalLine - s * PENALTY_AREA.depth;
    g.strokeRect(
      Math.min(cx(goalLine), cx(boxFront)),
      cz(-PENALTY_AREA.halfWidth),
      toPx(PENALTY_AREA.depth),
      toPx(PENALTY_AREA.halfWidth * 2)
    );

    // 골 에어리어
    const areaFront = goalLine - s * GOAL_AREA_DEPTH;
    g.strokeRect(
      Math.min(cx(goalLine), cx(areaFront)),
      cz(-GOAL_AREA_HALF_W),
      toPx(GOAL_AREA_DEPTH),
      toPx(GOAL_AREA_HALF_W * 2)
    );

    // 페널티 스폿
    const spotX = goalLine - s * PENALTY_SPOT_DEPTH;
    g.beginPath();
    g.arc(cx(spotX), cz(0), LINE_PX * 0.9, 0, Math.PI * 2);
    g.fill();

    // 페널티 아크 — 박스 밖으로 나오는 부분만. 기준 각도는 중앙 쪽을 향한다.
    const base = s < 0 ? 0 : Math.PI;
    g.beginPath();
    g.arc(
      cx(spotX),
      cz(0),
      toPx(PARAMS.centerCircleRadius),
      base - ARC_HALF_ANGLE,
      base + ARC_HALF_ANGLE
    );
    g.stroke();

    // 코너 아크 — 경기장 안쪽으로 사분원. 3단계 코너킥이 여기서 시작한다.
    for (const t of [-1, 1]) {
      const start = s < 0 ? (t < 0 ? 0 : -Math.PI / 2) : t < 0 ? Math.PI / 2 : Math.PI;
      g.beginPath();
      g.arc(cx(goalLine), cz(t * HALF.W), toPx(CORNER_ARC_R), start, start + Math.PI / 2);
      g.stroke();
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function goal(scene, xSign) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1 });
  // 골대 높이는 시뮬의 GOAL_H를 그대로 따른다 — 눈에 보이는 크로스바와 "골이냐 아니냐"의
  // 경계가 어긋나면, 바 밑으로 들어간 것처럼 보이는 볼이 골킥으로 판정된다.
  const post = new THREE.CylinderGeometry(0.18, 0.18, GOAL_H, 10);
  const p1 = new THREE.Mesh(post, mat);
  p1.position.set(0, GOAL_H / 2, -GOAL_W / 2);
  const p2 = new THREE.Mesh(post, mat);
  p2.position.set(0, GOAL_H / 2, GOAL_W / 2);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, GOAL_W, 10), mat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, GOAL_H, 0);
  [p1, p2, bar].forEach((o) => {
    o.castShadow = true;
    grp.add(o);
  });
  grp.position.x = xSign * HALF.L;
  scene.add(grp);
}

/**
 * 코너 깃발 네 개. 실제 경기장 기준점이자, 코너킥이 어디서 시작하는지 눈으로 보이게 한다.
 * 높이는 이 씬의 선수 리그(머리 y≈3.0m)에 맞춘 값이라 실제 규격(1.5m)보다 크다.
 */
function cornerFlags(scene) {
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.6 });
  const flagGeo = new THREE.PlaneGeometry(0.6, 0.42);
  const flagMat = new THREE.MeshStandardMaterial({
    color: 0xf2c744,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });

  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      const grp = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 1.3;
      pole.castShadow = true;
      grp.add(pole);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      // 깃은 경기장 안쪽을 향해 편다 — 밖으로 뻗으면 터치라인 밖에 물체가 있는 것처럼 보인다.
      flag.position.set(-s * 0.3, 2.3, 0);
      flag.rotation.y = Math.PI / 2;
      grp.add(flag);
      grp.position.set(s * HALF.L, 0, t * HALF.W);
      scene.add(grp);
    }
  }
}

export function buildPitch(scene) {
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.L, FIELD.W),
    new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 })
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  scene.add(pitch);

  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.L + 12, FIELD.W + 12),
    new THREE.MeshStandardMaterial({
      color: 0x0d2b1b,
      roughness: 1,
      transparent: true,
      opacity: 0.82,
    })
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.02;
  surround.receiveShadow = true;
  scene.add(surround);

  goal(scene, 1);
  goal(scene, -1);
  cornerFlags(scene);
  return pitch;
}
