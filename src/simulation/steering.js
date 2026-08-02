import { PARAMS } from './params.js';
import { vlen } from './math.js';

/** 목표 지점에 감속하며 도착 */
export function arrive(p, tx, tz) {
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = vlen(dx, dz);
  if (d < 0.3) return [0, 0];
  const speed = Math.min(d / 0.35, p.maxSpeed);
  return [(dx / d) * speed - p.vx, (dz / d) * speed - p.vz];
}

/** 공의 미래 위치를 예측해 따라붙기 */
export function pursuit(p, ball) {
  // 떠 있는 공은 현재 위치가 아니라 "떨어질 자리"로 간다 — 안 그러면 공 밑을 계속 따라
  // 달리다가 정작 낙하 지점에서는 뒤에 서 있게 된다.
  if (ball.airborne) {
    const land = ball.predictLanding();
    return arrive(p, land.x, land.z);
  }
  const dx = ball.x - p.x;
  const dz = ball.z - p.z;
  const d = vlen(dx, dz);
  const t = d / (p.maxSpeed + vlen(ball.vx, ball.vz) + 1);
  return arrive(p, ball.x + ball.vx * t * 0.5, ball.z + ball.vz * t * 0.5);
}

/** 같은 팀끼리 뭉치지 않도록 밀어내기 */
export function separation(p, mates) {
  let sx = 0;
  let sz = 0;
  const r2 = PARAMS.sepRadius ** 2;
  for (const m of mates) {
    if (m === p) continue;
    const dx = p.x - m.x;
    const dz = p.z - m.z;
    const d = dx * dx + dz * dz;
    if (d > 0 && d < r2) {
      const l = Math.sqrt(d);
      sx += dx / l / l;
      sz += dz / l / l;
    }
  }
  return [sx * PARAMS.maxSpeed, sz * PARAMS.maxSpeed];
}

/**
 * 팀에서 공에 가장 가까운 필드 플레이어.
 *
 * 떠 있는 공도 "지금 공이 있는 자리" 기준으로 잰다. 낙하 지점 기준으로 바꿔 보았지만,
 * 압박(pressSupportRadius)과 대형 이동이 전부 현재 볼 위치를 보고 있어서 기준이 엇갈리고
 * "압박을 올리면 볼을 더 자주 되찾는다"가 반대로 뒤집혔다(validate-tactics-impact가 잡아냈다).
 * 추격 자체는 pursuit()이 낙하 지점으로 데려가므로 여기서까지 바꿀 필요가 없다.
 */
export function closest(team, ball) {
  let best = null;
  let bd = Infinity;
  for (const p of team) {
    if (p.role === 'GK' || p.sentOff) continue;
    const d = (p.x - ball.x) ** 2 + (p.z - ball.z) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
