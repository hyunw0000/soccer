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
  for (const p of sim.homeP) {
    const rig = makePlayerRig({
      color: HOME_COLOR,
      skin: 0xf0c9a0,
      num: p.num,
      isCaptain: p.num === captainNum,
    });
    scene.add(rig);
    rigs.set(p, rig);
  }
  for (const p of sim.awayP) {
    const rig = makePlayerRig({ color: AWAY_COLOR, skin: 0xd8b48a, num: p.num });
    scene.add(rig);
    rigs.set(p, rig);
  }

  const ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(PARAMS.ballRadius, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
  );
  ballMesh.castShadow = true;
  scene.add(ballMesh);

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

  return { sync, render, setCam: cam.set, get camMode() { return cam.mode; }, dispose };
}
