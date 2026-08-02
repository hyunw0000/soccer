import * as THREE from 'three';
import { PARAMS } from '../../simulation/index.js';
import { createScene } from './scene.js';
import { buildPitch } from './pitch.js';
import { makePlayerRig, animateRig } from './playerRig.js';
import { createCameraRig } from './cameraRig.js';
import { createStadiumEnvironment } from './stadiumEnvironment.js';
import { MATCH_SIDE_STYLES } from '../matchSides.js';

// 한 프레임에 이 이상 움직였으면 굴러간 게 아니라 순간이동(킥오프 리셋·되감기)으로 본다(m).
// 상수로 박지 말고 물리에서 유도한다 — match.js가 프레임당 최대 6스텝을 돌리므로 정상 이동은
// 최대 ballMaxSpeed(40) × dt(1/60) × 6 = 4m까지 나온다. 예전에 3m로 박아뒀더니 이 한계보다
// 작아서, 배속(2x/3x)에서 빠른 슛이 순간이동으로 오판돼 굴림이 멈추는 구간이 있었다.
// 여유를 두 배(12스텝)로 잡아 그 위만 순간이동으로 본다.
const BALL_TELEPORT_DIST = PARAMS.ballMaxSpeed * PARAMS.dt * 12;

// 공중볼 스핀 계수 — 지면 굴림(1.0) 대비 이 비율로만 돈다.
// 지면 굴림 공식(각도 = 이동거리/반지름)은 "바닥에 붙어 구른다"는 전제라, 뜬 공에 그대로
// 쓰면 30m 골킥이 30/0.35 ≈ 86rad(약 13.6바퀴)를 돌아 화면에서 스트로브처럼 번쩍인다.
// 0.15면 같은 30m 비행에서 약 2바퀴 — 긴 킥의 백스핀 느낌이 나면서 무늬도 읽힌다.
const AIRBORNE_SPIN_FACTOR = 0.15;

// 스핀 계수를 지면(1.0)과 공중(0.15) 사이에서 보간하는 높이(m).
// airborne 여부로 딱 끊으면 착지하는 프레임에 회전 속도가 6.6배(=1/0.15) 급변한다
// (실측: 착지 직전 0.104rad → 직후 0.694rad). 잔디에 거의 닿은 높이에서는 이미 굴림에
// 가까우므로, 이 높이 안에서 부드럽게 이어 붙여 그 불연속을 없앤다.
const SPIN_BLEND_HEIGHT = 0.6;

/**
 * 축구공 — 흰 바탕에 검은 오각형 12개(텔스타 무늬). 외부 이미지 의존 0.
 *
 * UV 스피어에 캔버스 텍스처를 감으면 극점에서 무늬가 심하게 뭉개져서 오각형이 안 나온다.
 * 그래서 텍스처 대신 **기하학적으로** 칠한다 — 정이십면체의 꼭짓점 12개가 곧 축구공
 * 오각형의 중심이므로, 각 삼각형이 그 12방향 중 하나에 충분히 가까우면 검게 칠한다.
 * 면 단위로 칠해서 오각형 경계가 선명하게 떨어진다.
 */
function makeBall() {
  // detail 5 = 삼각형 720개. 오각형 경계가 삼각형 단위로 끊기므로 너무 낮으면 계단처럼 보인다.
  const geo = new THREE.IcosahedronGeometry(PARAMS.ballRadius, 5);
  const pos = geo.attributes.position;

  // 정이십면체 꼭짓점 12개 = 오각형 중심 방향
  const t = (1 + Math.sqrt(5)) / 2;
  const centers = [];
  for (const [a, b] of [[1, t], [-1, t], [1, -t], [-1, -t]]) {
    centers.push(new THREE.Vector3(a, b, 0).normalize());
    centers.push(new THREE.Vector3(0, a, b).normalize());
    centers.push(new THREE.Vector3(b, 0, a).normalize());
  }

  // 인접 꼭짓점 사이 각은 63.43°. 표준 깎기(1/3 지점)면 오각형 반지름이 그 1/3쯤이라
  // 0.34rad(≈19.5°) 근방이 실제 축구공 비율과 가장 비슷하다.
  const PENTAGON_RADIUS = 0.34;
  const WHITE = new THREE.Color(0xf2f2f2);
  const BLACK = new THREE.Color(0x14161a);

  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const mid = new THREE.Vector3();
  // PolyhedronGeometry는 인덱스 없는 삼각형 목록이라 3개씩 끊어 면 단위로 처리한다.
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    mid.copy(a).add(b).add(c).divideScalar(3).normalize();
    let nearest = Infinity;
    for (const center of centers) nearest = Math.min(nearest, mid.angleTo(center));
    const col = nearest < PENTAGON_RADIUS ? BLACK : WHITE;
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = col.r;
      colors[(i + k) * 3 + 1] = col.g;
      colors[(i + k) * 3 + 2] = col.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(
    geo,
    // 가죽이라 광택은 약하게, 완전 무광은 아니게 — 잔디 위에서 형태가 읽히는 정도.
    // flatShading은 끈다: 켜면 다면체 각이 그대로 드러나 공이 각져 보인다. 정점 색은 면 단위로
    // 넣었으므로(인덱스 없는 지오메트리) 부드러운 음영을 써도 오각형 경계는 선명하게 남는다.
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.02 })
  );
  mesh.castShadow = true;
  return mesh;
}

/**
 * Sim(순수 상태) ↔ Three.js 씬을 잇는 얇은 어댑터.
 * 이 파일만 두 세계를 동시에 안다. engine은 여기를 모르고, screens는 sim을 직접 그리지 않는다.
 */
export function createMatchView(container, sim, captainNum = null) {
  const { renderer, scene, camera, controls, dispose: disposeScene } = createScene(container);
  const stadiumEnvironment = createStadiumEnvironment(scene);
  buildPitch(scene);
  const cam = createCameraRig(camera, controls);

  const rigs = new Map(); // player → rig
  const rigToPlayer = new Map(); // rig → player (클릭 피킹 역참조용)
  for (const p of sim.homeP) {
    const rig = makePlayerRig({
      color: MATCH_SIDE_STYLES.home.uniformHex,
      skin: 0xf0c9a0,
      num: p.num,
      isCaptain: p.num === captainNum,
    });
    scene.add(rig);
    rigs.set(p, rig);
    rigToPlayer.set(rig, p);
  }
  for (const p of sim.awayP) {
    const rig = makePlayerRig({ color: MATCH_SIDE_STYLES.away.uniformHex, skin: 0xd8b48a, num: p.num });
    scene.add(rig);
    rigs.set(p, rig);
    rigToPlayer.set(rig, p);
  }

  const ballMesh = makeBall();
  scene.add(ballMesh);
  // 굴림 계산용 — 직전 프레임에 그린 볼 위치와, 재사용할 임시 객체(프레임마다 new 하지 않는다).
  let prevBallX = sim.ball.x;
  let prevBallZ = sim.ball.z;
  const rollAxis = new THREE.Vector3();
  const rollQuat = new THREE.Quaternion();

  // 공중볼 그림자 — 탑뷰에서는 높이가 안 보여서, 공이 떠 있으면 "어디에 떨어지는지"를
  // 알 수 있는 단서가 이 원 하나뿐이다. 높이가 올라갈수록 크고 옅어진다.
  const ballShadow = new THREE.Mesh(
    new THREE.CircleGeometry(PARAMS.ballRadius, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
  );
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.renderOrder = 1;
  scene.add(ballShadow);

  // 되감기 후 드래그로 경로를 그릴 때 쓰는 피킹/좌표변환 도구 — 화면 ↔ 필드 바닥(y=0) 변환은
  // 이 파일만 안다. sim/screens는 화면 좌표를 몰라도 되게 여기서 다 끝낸다.
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const groundHit = new THREE.Vector3();

  function toNdc(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return ndc;
  }

  /** 화면 좌표 아래에 있는 선수를 찾는다(피규어 어느 부위를 클릭해도 잡힌다). 없으면 null. */
  function pickPlayer(clientX, clientY) {
    raycaster.setFromCamera(toNdc(clientX, clientY), camera);
    const hits = raycaster.intersectObjects([...rigs.values()], true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !rigToPlayer.has(obj)) obj = obj.parent;
    return obj ? rigToPlayer.get(obj) : null;
  }

  /** 화면 좌표를 필드 바닥 좌표({x,z})로 바꾼다. 지면과 안 만나면(카메라가 위를 보는 각도 등) null. */
  function screenToField(clientX, clientY) {
    raycaster.setFromCamera(toNdc(clientX, clientY), camera);
    const hit = raycaster.ray.intersectPlane(groundPlane, groundHit);
    return hit ? { x: groundHit.x, z: groundHit.z } : null;
  }

  const pathLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffd60a, linewidth: 2, depthTest: false })
  );
  pathLine.renderOrder = 998;
  pathLine.visible = false;
  scene.add(pathLine);

  /** 드래그 중(또는 확정된) 경로를 필드 위에 선으로 그린다. null/1점 이하면 지운다. */
  function setPathPoints(points) {
    if (!points || points.length < 2) {
      pathLine.visible = false;
      return;
    }
    const positions = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = 0.12; // 잔디에 파묻히지 않게 살짝 띄운다
      positions[i * 3 + 2] = p.z;
    });
    pathLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pathLine.geometry.computeBoundingSphere();
    pathLine.visible = true;
  }

  /** 경로를 드래그로 그리는 동안은 탑뷰 OrbitControls(드래그=회전)와 충돌하니 잠깐 꺼둔다. */
  function setOrbitEnabled(v) {
    controls.enabled = v && cam.mode === 'top';
  }

  /** 시뮬 상태를 화면에 반영 (dt=0이면 포즈 고정, 되감기 중에도 호출 가능) */
  function sync(dt = 0) {
    for (const [p, rig] of rigs) animateRig(rig, p, dt, camera);
    const b = sim.ball;

    // 굴림 — 예전엔 rotation.x/z에 속도를 그냥 누적했는데, 무늬가 생기고 나면 그게 눈에 띈다
    // (축이 섞여서 헛도는 것처럼 보이고, 구르는 양도 실제 이동 거리와 무관했다).
    // dt가 아니라 "화면에서 실제로 움직인 거리"로 굴려야 미끄러지지 않는다 — 배속·일시정지·
    // 되감기 어디서도 이동한 만큼만 정확히 구른다.
    const dx = b.x - prevBallX;
    const dz = b.z - prevBallZ;
    const dist = Math.hypot(dx, dz);
    // 킥오프 리셋·되감기·재개처럼 순간이동한 프레임은 굴리지 않는다(한 프레임에 이 거리는 못 간다).
    if (dist > 1e-6 && dist < BALL_TELEPORT_DIST) {
      // 지면에 붙어 있을 때만 진짜 "구름"이다. 뜬 공은 바닥과 안 맞물리므로 같은 거리 기반이되
      // 계수를 낮춰 완만한 스핀만 준다(AIRBORNE_SPIN_FACTOR 주석 참고). 거리 기반이라 배속·
      // 일시정지에도 그대로 맞물린다. 지면↔공중은 높이로 보간해서 착지 프레임에 회전 속도가
      // 튀지 않게 한다(SPIN_BLEND_HEIGHT 주석 참고).
      const heightAboveGround = Math.max(0, b.y - PARAMS.ballRadius);
      const airT = Math.min(heightAboveGround / SPIN_BLEND_HEIGHT, 1);
      const spin = 1 + (AIRBORNE_SPIN_FACTOR - 1) * airT;
      rollAxis.set(dz, 0, -dx).normalize(); // 위(0,1,0) × 진행방향
      rollQuat.setFromAxisAngle(rollAxis, (dist / PARAMS.ballRadius) * spin);
      ballMesh.quaternion.premultiply(rollQuat); // 월드 기준으로 굴린다
    }
    prevBallX = b.x;
    prevBallZ = b.z;

    ballMesh.position.set(b.x, b.y, b.z);
    // 높이 0.35m(지면)에서 1배, 높이 8m 이상이면 2.2배까지 커지고 그만큼 옅어진다.
    const height = Math.max(0, b.y - PARAMS.ballRadius);
    const spread = Math.min(height / 8, 1);
    ballShadow.position.set(b.x, 0.02, b.z);
    ballShadow.scale.setScalar(1 + spread * 1.2);
    ballShadow.material.opacity = 0.3 * (1 - spread * 0.7);
  }

  function render() {
    cam.update(sim.ball);
    controls.update();
    renderer.render(scene, camera);
  }

  function dispose() {
    stadiumEnvironment.dispose();
    disposeScene();
  }

  return {
    sync,
    render,
    setCam: cam.set,
    get camMode() { return cam.mode; },
    dispose,
    pickPlayer,
    screenToField,
    setPathPoints,
    setOrbitEnabled,
  };
}
