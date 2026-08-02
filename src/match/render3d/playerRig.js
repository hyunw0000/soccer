import * as THREE from 'three';

/** 등번호 + 체력 링을 그린 스프라이트 (머리 위 표식) */
function badgeSprite(num, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
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
    pivot.position.set(side * 0.55, 2.55, 0);
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
    hip.position.set(side * 0.22, 1.55, 0);
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
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.5), mShort);
    foot.position.set(0, -0.85, 0.15);
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

/**
 * 골 세리머니 포즈 — 두 팔을 번쩍 들고 제자리에서 뛴다.
 *
 * 시뮬레이션은 골이 들어간 그 틱에 곧바로 kickoff()을 불러 선수를 대형으로 되돌린다.
 * 그래서 여기서 보이는 건 "골 넣은 자리"가 아니라 킥오프 대형에서의 환호다.
 *
 * 넣은 자리에서 세리머니하게 만들려면 리그 좌표를 직전 프레임 값으로 얼려야 하는데,
 * 실제로 해 보니(골 감지를 view.sync()보다 앞으로 옮기고 위치 갱신을 건너뛰는 방식)
 * 세리머니 자체가 안 걸리는 상태가 돼서 되돌렸다 — 실측: 점프 높이가 전원 0, 리그 좌표도
 * 킥오프 대형과 1~2m 이내로 동일. 제대로 하려면 시뮬레이션에 세리머니 구간을 두고
 * kickoff()을 그만큼 미루는 쪽이 맞다.
 *
 * @param {number} t 세리머니 시작 후 흐른 시간(초)
 */
function celebratePose(rig, t) {
  const ud = rig.userData;
  // 두 팔 번쩍 — 살짝 흔든다
  const wave = Math.sin(t * 9) * 0.18;
  ud.armL.rotation.x = -2.5 + wave;
  ud.armR.rotation.x = -2.5 - wave;
  // 제자리 점프 — 음수 구간을 잘라서 "땅에 붙었다 뛰는" 리듬을 만든다
  const hop = Math.max(0, Math.sin(t * 7));
  rig.position.y = hop * 0.55;
  // 뛰는 동안 다리를 접는다
  ud.legL.hip.rotation.x = -hop * 0.5;
  ud.legR.hip.rotation.x = -hop * 0.5;
  ud.legL.knee.rotation.x = hop * 1.0;
  ud.legR.knee.rotation.x = hop * 1.0;
  ud.torso.rotation.x = -0.12;
  ud.head.position.z = 0;
  rig.rotation.z = 0;
}

/**
 * 선수 상태(pure)를 리그에 반영 + 달리기 애니메이션.
 * @param {number|null} celebrateT null이 아니면 달리기 대신 골 세리머니를 그린다(초 단위 경과 시간)
 */
export function animateRig(rig, p, dt, camera, celebrateT = null) {
  const ud = rig.userData;

  if (celebrateT !== null) {
    // 위치(x/z)·몸 방향은 갱신하지 않는다 — 리그가 들고 있는 직전 프레임 좌표,
    // 즉 "골이 들어가던 순간의 자리"를 그대로 유지한 채 환호한다.
    celebratePose(rig, celebrateT);
    // 체력 바는 세리머니 중에도 그대로 유지한다(아래 공통 처리와 같은 내용).
    const eC = p.energy;
    ud.bar.fg.scale.x = Math.max(0.01, eC);
    ud.bar.fg.position.x = -(1 - eC) * 0.8;
    ud.bar.fg.material.color.setHex(eC > 0.6 ? 0x3fb950 : eC > 0.35 ? 0xd29922 : 0xf85149);
    if (camera) ud.bar.group.quaternion.copy(camera.quaternion);
    return;
  }

  rig.position.set(p.x, 0, p.z);
  rig.rotation.y = p.heading;
  const sp = Math.hypot(p.vx, p.vz);

  // 방향 전환 시 몸을 살짝 기울여(뱅킹) 관성으로 버티는 느낌을 준다 — 정지 상태에서는 안 기운다.
  if (ud.prevHeading == null) ud.prevHeading = p.heading;
  const dh = Math.atan2(Math.sin(p.heading - ud.prevHeading), Math.cos(p.heading - ud.prevHeading));
  ud.prevHeading = p.heading;
  const turnRate = dh / Math.max(dt || 0.016, 1e-3);
  const bank = Math.max(-0.3, Math.min(0.3, -turnRate * 0.05)) * Math.min(1, sp / p.maxSpeed);
  rig.rotation.z = bank;
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
