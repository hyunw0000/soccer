import * as THREE from 'three';
import { FIELD, HALF, GOAL_W, GOAL_H } from '../../simulation/index.js';

/** 라인이 그려진 잔디 텍스처를 캔버스로 생성 (외부 이미지 의존 0) */
function pitchTexture() {
  const c = document.createElement('canvas');
  c.width = 2100;
  c.height = 1360;
  const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? '#2a8f43' : '#238a3d';
    g.fillRect((i * c.width) / 14, 0, c.width / 14, c.height);
  }
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 6;
  const m = 40;
  g.strokeRect(m, m, c.width - 2 * m, c.height - 2 * m);
  g.beginPath();
  g.moveTo(c.width / 2, m);
  g.lineTo(c.width / 2, c.height - m);
  g.stroke();
  g.beginPath();
  g.arc(c.width / 2, c.height / 2, 150, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(c.width / 2, c.height / 2, 6, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  const boxW = 330;
  const boxH = 560;
  g.strokeRect(m, (c.height - boxH) / 2, boxW, boxH);
  g.strokeRect(c.width - m - boxW, (c.height - boxH) / 2, boxW, boxH);
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
  return pitch;
}
