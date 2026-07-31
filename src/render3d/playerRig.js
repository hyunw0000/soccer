import * as THREE from 'three';

/** 등번호 + 체력 링을 그린 스프라이트 (머리 위 표식) */
function badgeSprite(num, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 70px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(1.6, 1.6, 1);
  sp.position.y = 4.0;
  return sp;
}

/** 체력 바 — 머리 위에 얇은 판으로 띄우고 scale.x 로 줄인다 */
function energyBar() {
  const grp = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x1b1f24, depthTest: false, transparent: true })
  );
  const fg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x3fb950, depthTest: false, transparent: true })
  );
  fg.position.z = 0.01;
  grp.add(bg, fg);
  grp.position.y = 4.9;
  grp.renderOrder = 999;
  return { group: grp, fg };
}

/**
 * 관절 피규어. 반환된 group의 userData에 관절 참조가 들어있고,
 * animateRig()가 그것들을 굽힌다. 로직(engine)과는 완전히 분리.
 */
export function makePlayerRig({ color, skin, num, isCaptain = false }) {
  const g = new THREE.Group();
  const mBody = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const mSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const mShort = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 10), mBody);
  torso.position.y = 2.1;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), mSkin);
  head.position.y = 3.0;
  head.castShadow = true;
  g.add(head);

  const arm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, 2.55, side * 0.55);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 4, 8), mBody);
    upper.position.y = -0.35;
    upper.castShadow = true;
    pivot.add(upper);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.55, 4, 8), mSkin);
    fore.position.y = -0.95;
    fore.castShadow = true;
    pivot.add(fore);
    g.add(pivot);
    return pivot;
  };

  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0, 1.55, side * 0.22);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.7, 4, 8), mShort);
    thigh.position.y = -0.45;
    thigh.castShadow = true;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.85;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), mSkin);
    shin.position.y = -0.45;
    shin.castShadow = true;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.28), mShort);
    foot.position.set(0.15, -0.85, 0);
    foot.castShadow = true;
    knee.add(foot);
    g.add(hip);
    return { hip, knee };
  };

  const armL = arm(1);
  const armR = arm(-1);
  const legL = leg(1);
  const legR = leg(-1);
  g.add(badgeSprite(num, color));

  const bar = energyBar();
  g.add(bar.group);

  if (isCaptain) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.17, 0.05, 8, 14),
      new THREE.MeshStandardMaterial({ color: 0xf2c744, roughness: 0.5 })
    );
    band.position.set(0, 2.05, 0.6);
    band.rotation.y = Math.PI / 2;
    g.add(band);
  }

  g.userData = { armL, armR, legL, legR, torso, head, bar, phase: Math.random() * 6.28 };
  return g;
}

/** 선수 상태(pure)를 리그에 반영 + 달리기 애니메이션 */
export function animateRig(rig, p, dt, camera) {
  rig.position.set(p.x, 0, p.z);
  rig.rotation.y = p.heading;

  const ud = rig.userData;
  const sp = Math.hypot(p.vx, p.vz);
  ud.phase += (0.6 + sp * 2.2) * (dt || 0.016) * 6;
  const swing = Math.min(1, (sp / p.maxSpeed) * 1.3);
  const a = Math.sin(ud.phase) * swing;

  ud.legL.hip.rotation.x = a * 0.9;
  ud.legR.hip.rotation.x = -a * 0.9;
  ud.legL.knee.rotation.x = Math.max(0, -Math.cos(ud.phase)) * swing * 1.1;
  ud.legR.knee.rotation.x = Math.max(0, Math.cos(ud.phase)) * swing * 1.1;
  ud.armL.rotation.x = -a * 0.7;
  ud.armR.rotation.x = a * 0.7;
  ud.torso.rotation.x = swing * 0.18;
  ud.head.position.z = swing * 0.05;
  rig.position.y = Math.abs(Math.sin(ud.phase)) * 0.08 * swing;

  // 체력 바: 항상 카메라를 바라보고, 남은 비율만큼 왼쪽 정렬로 줄어든다
  const e = p.energy;
  ud.bar.fg.scale.x = Math.max(0.01, e);
  ud.bar.fg.position.x = -(1 - e) * 0.8;
  ud.bar.fg.material.color.setHex(e > 0.6 ? 0x3fb950 : e > 0.35 ? 0xd29922 : 0xf85149);
  if (camera) ud.bar.group.quaternion.copy(camera.quaternion);
}
