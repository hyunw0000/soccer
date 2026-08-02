import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * 렌더러/씬/카메라/조명 기본 세트.
 * dispose()로 WebGL 컨텍스트를 반드시 정리한다 — 화면 전환이 잦으면
 * 컨텍스트가 누적되어 브라우저가 렌더링을 포기한다.
 */
export function createScene(container) {
  // 컨테이너가 아직 레이아웃을 못 잡았을 때(0px) 창 크기로 대신한다
  const sizeOf = () => ({
    w: container.clientWidth || window.innerWidth,
    h: container.clientHeight || window.innerHeight,
  });
  const { w: w0, h: h0 } = sizeOf();

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w0, h0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03080c);
  scene.fog = new THREE.Fog(0x03080c, 150, 300);

  const camera = new THREE.PerspectiveCamera(50, w0 / h0, 0.1, 600);
  camera.position.set(0, 36, 78);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a3b25, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 90;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 250 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  const onResize = () => {
    const { w, h } = sizeOf();
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);
  // 창 크기가 아니라 컨테이너 크기만 바뀌는 경우(레이아웃 확정 시점 포함)도 잡는다
  const ro = new ResizeObserver(onResize);
  ro.observe(container);

  function dispose() {
    window.removeEventListener('resize', onResize);
    ro.disconnect();
    controls.dispose();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else if (m) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { renderer, scene, camera, controls, dispose };
}
