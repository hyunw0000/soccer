import * as THREE from 'three';
import { PARAMS } from '../../simulation/index.js';
import { createScene } from './scene.js';
import { buildPitch } from './pitch.js';
import { makePlayerRig, animateRig } from './playerRig.js';
import { createCameraRig } from './cameraRig.js';
import { createStadiumEnvironment } from './stadiumEnvironment.js';

const HOME_COLOR = 0xc8102e;
const AWAY_COLOR = 0x1f6feb;

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
      color: HOME_COLOR,
      skin: 0xf0c9a0,
      num: p.num,
      isCaptain: p.num === captainNum,
    });
    scene.add(rig);
    rigs.set(p, rig);
    rigToPlayer.set(rig, p);
  }
  for (const p of sim.awayP) {
    const rig = makePlayerRig({ color: AWAY_COLOR, skin: 0xd8b48a, num: p.num });
    scene.add(rig);
    rigs.set(p, rig);
    rigToPlayer.set(rig, p);
  }

  const ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(PARAMS.ballRadius, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
  );
  ballMesh.castShadow = true;
  scene.add(ballMesh);

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
    ballMesh.position.set(b.x, PARAMS.ballRadius, b.z);
    ballMesh.rotation.x += b.vz * 0.02;
    ballMesh.rotation.z -= b.vx * 0.02;
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
