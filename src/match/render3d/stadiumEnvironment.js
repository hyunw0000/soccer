import * as THREE from 'three';
import { FIELD } from '../../simulation/index.js';

const TIERS = 10;
const TIER_RISE = 1.8;
const TIER_DEPTH = 2.4;
const SIDE_GAP = 10;
const END_GAP = 10;
const SIDE_LENGTH = FIELD.L + 20;
const END_LENGTH = FIELD.W + 20;
const ROOF_Y = 23;

function seededRandom(seed = 0x52455749) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function addScaledBox(group, geometry, material, position, scale, rotationY = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.y = rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createCrowd() {
  const random = seededRandom();
  const positions = [];
  const colors = [];
  const palette = [
    new THREE.Color(0xdde9ee),
    new THREE.Color(0xb51f2e),
    new THREE.Color(0x2a7189),
    new THREE.Color(0x596b73),
    new THREE.Color(0x172b34),
  ];

  const addPerson = (x, y, z) => {
    positions.push(x, y, z);
    const color = palette[Math.floor(random() * palette.length)];
    colors.push(color.r, color.g, color.b);
  };

  for (const sign of [-1, 1]) {
    for (let i = 0; i < 700; i++) {
      const tier = Math.floor(random() * TIERS);
      const x = (random() - 0.5) * (SIDE_LENGTH - 3);
      const z = sign * (FIELD.W / 2 + SIDE_GAP + tier * TIER_DEPTH + TIER_DEPTH * 0.5);
      addPerson(x, (tier + 1) * TIER_RISE + 0.55 + random() * 0.35, z);
    }
    for (let i = 0; i < 400; i++) {
      const tier = Math.floor(random() * TIERS);
      const x = sign * (FIELD.L / 2 + END_GAP + tier * TIER_DEPTH + TIER_DEPTH * 0.5);
      const z = (random() - 0.5) * (END_LENGTH - 3);
      addPerson(x, (tier + 1) * TIER_RISE + 0.55 + random() * 0.35, z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.72,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
  });
  return { points: new THREE.Points(geometry, material), geometry, material };
}

/** 기본 Geometry만으로 필드 네 면을 감싸는 저비용 스타디움 환경을 생성한다. */
export function createStadiumEnvironment(scene) {
  const group = new THREE.Group();
  group.name = 'stadium-environment';

  const geometries = new Set();
  const materials = new Set();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  geometries.add(unitBox);

  const standDark = new THREE.MeshStandardMaterial({ color: 0x07161d, roughness: 0.94, metalness: 0.08 });
  const standBlue = new THREE.MeshStandardMaterial({ color: 0x0b2732, roughness: 0.9, metalness: 0.1 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x7f1520, roughness: 0.72, metalness: 0.25 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x111b22, roughness: 0.58, metalness: 0.72 });
  const lightPanel = new THREE.MeshStandardMaterial({
    color: 0xe8f8ff,
    emissive: 0xb8eaff,
    emissiveIntensity: 3.2,
    roughness: 0.25,
  });
  [standDark, standBlue, accent, metal, lightPanel].forEach((material) => materials.add(material));

  for (let tier = 0; tier < TIERS; tier++) {
    const height = (tier + 1) * TIER_RISE;
    const sideOffset = FIELD.W / 2 + SIDE_GAP + tier * TIER_DEPTH + TIER_DEPTH / 2;
    const endOffset = FIELD.L / 2 + END_GAP + tier * TIER_DEPTH + TIER_DEPTH / 2;
    const standMaterial = tier % 2 ? standBlue : standDark;

    for (const sign of [-1, 1]) {
      addScaledBox(group, unitBox, standMaterial, [0, height / 2, sign * sideOffset], [SIDE_LENGTH, height, TIER_DEPTH]);
      addScaledBox(group, unitBox, standMaterial, [sign * endOffset, height / 2, 0], [TIER_DEPTH, height, END_LENGTH]);
      addScaledBox(group, unitBox, accent, [0, height + 0.18, sign * (sideOffset - TIER_DEPTH * 0.42)], [SIDE_LENGTH, 0.28, 0.18]);
      addScaledBox(group, unitBox, accent, [sign * (endOffset - TIER_DEPTH * 0.42), height + 0.18, 0], [0.18, 0.28, END_LENGTH]);
    }
  }

  const roofSideOffset = FIELD.W / 2 + SIDE_GAP + TIERS * TIER_DEPTH - 7;
  const roofEndOffset = FIELD.L / 2 + END_GAP + TIERS * TIER_DEPTH - 7;
  for (const sign of [-1, 1]) {
    // 방송 카메라는 +Z 관중석 뒤에 있으므로 가까운 쪽 지붕은 시야를 막지 않게 생략한다.
    if (sign === -1) {
      addScaledBox(group, unitBox, metal, [0, ROOF_Y, sign * roofSideOffset], [SIDE_LENGTH + 6, 0.8, 15]);
      for (let i = -4; i <= 4; i++) {
        addScaledBox(group, unitBox, lightPanel, [i * 13, ROOF_Y - 1, sign * (roofSideOffset - 7.2)], [7.5, 1.1, 0.35]);
      }
    }
    addScaledBox(group, unitBox, metal, [sign * roofEndOffset, ROOF_Y, 0], [15, 0.8, END_LENGTH + 6]);

    for (let i = -3; i <= 3; i++) {
      addScaledBox(group, unitBox, lightPanel, [sign * (roofEndOffset - 7.2), ROOF_Y - 1, i * 11], [0.35, 1.1, 6.5]);
    }
  }

  const postPositions = [
    [-58, 11, -roofSideOffset], [58, 11, -roofSideOffset],
    [-58, 11, roofSideOffset], [58, 11, roofSideOffset],
    [-roofEndOffset, 11, -40], [-roofEndOffset, 11, 40],
    [roofEndOffset, 11, -40], [roofEndOffset, 11, 40],
  ];
  postPositions.forEach((position) => addScaledBox(group, unitBox, metal, position, [0.7, 22, 0.7]));

  const crowd = createCrowd();
  geometries.add(crowd.geometry);
  materials.add(crowd.material);
  group.add(crowd.points);

  const actualLights = [
    [0, ROOF_Y - 2, -roofSideOffset + 2],
    [0, ROOF_Y - 2, roofSideOffset - 2],
    [-roofEndOffset + 2, ROOF_Y - 2, 0],
    [roofEndOffset - 2, ROOF_Y - 2, 0],
  ].map(([x, y, z]) => {
    const light = new THREE.PointLight(0xc8efff, 32, 115, 2);
    light.position.set(x, y, z);
    group.add(light);
    return light;
  });

  scene.add(group);

  return {
    group,
    dispose() {
      scene.remove(group);
      actualLights.forEach((light) => group.remove(light));
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      group.clear();
    },
  };
}
