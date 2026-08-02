import * as THREE from 'three';

export const CAM_MODES = {
  broadcast: '방송캠',
  top: '탑뷰',
  ball: '공 추적',
};

const tmp = new THREE.Vector3();

/** 카메라 모드별 추적 로직. 자유 시점(top)일 때만 OrbitControls를 넘겨준다. */
export function createCameraRig(camera, controls) {
  let mode = 'broadcast';

  function set(next) {
    mode = next;
    if (next === 'top') {
      camera.position.set(0, 90, 1);
      controls.target.set(0, 0, 0);
      controls.enabled = true;
    } else {
      controls.enabled = false;
    }
  }

  function update(ball) {
    if (mode === 'top') return;
    if (mode === 'ball') {
      camera.position.lerp(tmp.set(ball.x - 14, 10, ball.z + 18), 0.06);
      controls.target.lerp(tmp.set(ball.x, 0, ball.z), 0.1);
    } else {
      camera.position.lerp(tmp.set(ball.x * 0.4, 36, 78), 0.04);
      controls.target.lerp(tmp.set(ball.x * 0.5, 0, 0), 0.05);
    }
  }

  return { set, update, get mode() { return mode; } };
}
