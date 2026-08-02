/**
 * 전술 영향력 검증.
 *
 * 규칙은 하나다 — 감독이 만진 전술은 반드시 경기에 나타나야 한다.
 * 화면에만 있고 경기에는 없는 조작(예전의 `tempo`)이 다시 생기면 여기서 걸린다.
 *
 * 검사 방법: 선수·라인업·상대·seed를 전부 고정하고 전술 한 축만 0 ↔ 1로 흔들어
 * 같은 경기를 끝까지 돌린다. 축마다 "이 축이 움직이면 이 지표가 이 방향으로 움직인다"는
 * 기대가 있고, 그 기대가 깨지면 실패한다. 마지막으로 프리셋 다섯 개로 실제 승점을 비교해
 * 전술이 승패까지 가르는지 확인한다.
 */
import { getNormalizedSlots } from '../src/lineup/formations.js';
import { PRESET_LIBRARY, toTactics } from '../src/tactics/domain/presets.js';
import { slotTacticsOf, toPlayerInstruction } from '../src/tactics/domain/playerTactics.js';
import { HALF, PARAMS, RewindBuffer, createSimulation } from '../src/simulation/index.js';

const FORMATION = '4-4-2';
const SEEDS = [11, 202, 3003, 40004, 500005, 606060];
const NEUTRAL = { lineHeight: 0.5, pressing: 0.5, tempo: 0.5, width: 0.5 };

const errors = [];
const check = (label, ok, detail) => {
  if (!ok) errors.push(`${label}: ${detail}`);
};

// ---------- 고정 입력 ----------
// 양 팀 선수 능력치를 똑같이 준다. 결과가 갈린다면 그 원인은 전술뿐이다.
const squad = (prefix) =>
  Array.from({ length: 11 }, (_, i) => ({
    id: `${prefix}${i}`,
    num: i + 1,
    name: `${prefix}${i}`,
    pace: 72,
    stamina: 75,
  }));

const lineupFor = (prefix) => ({
  formationId: FORMATION,
  assignments: getNormalizedSlots(FORMATION).map((slot, i) => {
    const a = { playerId: `${prefix}${i}`, slotId: slot.slotId, role: slot.role, x: slot.x, z: slot.z };
    // 화면이 보여 주는 자리별 기본 지시를 그대로 싣는다 (createMatchSetup과 같은 경로).
    return { ...a, instruction: toPlayerInstruction(slotTacticsOf(null, a)) };
  }),
  substituteIds: [],
  captainId: `${prefix}0`,
  goalkeeperId: `${prefix}0`,
});

const team = (id, prefix, tactics) => ({
  id,
  code: id,
  players: squad(prefix),
  lineup: lineupFor(prefix),
  tactics,
});

const setupOf = (homeTactics, awayTactics, seed) => ({
  version: 1,
  matchId: `tactics-impact-${seed}`,
  seed,
  homeTeam: team('KOR', 'h', homeTactics),
  awayTeam: team('OPP', 'a', awayTactics),
  tournament: null,
});

// ---------- 경기 한 판 ----------
/** 90분 풀타임을 돌리고 전술이 드러나는 지표를 모은다. */
function play(homeTactics, awayTactics, seed) {
  const sim = createSimulation(setupOf(homeTactics, awayTactics, seed));
  sim.kickoff({ kickoffTeam: 'home' });

  const outfield = sim.homeP.filter((p) => p.role !== 'GK');
  let ticks = 0;
  let sumX = 0; // 홈 필드플레이어 평균 x (라인 높이)
  let sumZ = 0; // 홈 필드플레이어 평균 |z| (진영 폭)
  let sumBallSpeed = 0;
  let homeTouch = 0;
  let awayTouch = 0;
  let lastTouch = null;
  let carryTicks = 0; // 홈 선수가 볼을 발밑에 두고 있던 틱
  let carrySpells = 0; // 그런 구간의 수 — 둘을 나누면 "한 번 잡으면 얼마나 들고 있나"가 나온다
  let prevCarrier = null;
  let outsideTicks = 0; // 선수가 라인 밖(또는 라인 위)에 있던 선수·틱
  let longestCarry = 0; // 한 번 잡고 혼자 이동한 최장 거리(m)
  let carryFrom = null;

  while (sim.phase !== 'fulltime') {
    if (sim.phase === 'halftime') sim.startSecondHalf();
    sim.step();
    ticks++;
    let x = 0;
    let z = 0;
    for (const p of outfield) {
      x += p.x;
      z += Math.abs(p.z);
    }
    sumX += x / outfield.length;
    sumZ += z / outfield.length;
    sumBallSpeed += Math.hypot(sim.ball.vx, sim.ball.vz);
    // 어떤 전술을 걸어도 "뛰고 있는" 선수는 경기장 안에 있어야 한다 — 퇴장·부상으로 빠진
    // 선수는 의도적으로 터치라인 밖(HALF.W+8)에 고정해 두므로 이 체크에서 제외한다.
    for (const p of sim.all) {
      if (p.sentOff || p.injured) continue;
      if (Math.abs(p.x) >= HALF.L || Math.abs(p.z) >= HALF.W) outsideTicks++;
    }

    const carrier = sim.ball.carrierKey;
    if (carrier?.startsWith('home')) {
      carryTicks++;
      if (carrier !== prevCarrier) carrySpells++;
    }
    // 한 명이 잡고 혼자 몰고 간 거리 — 골대까지 질주하는 옛 버그를 감시한다.
    if (carrier && carrier === prevCarrier && carryFrom) {
      longestCarry = Math.max(longestCarry, Math.hypot(sim.ball.x - carryFrom.x, sim.ball.z - carryFrom.z));
    } else {
      carryFrom = carrier ? { x: sim.ball.x, z: sim.ball.z } : null;
    }
    prevCarrier = carrier;
    if (sim.ball.ownerKey) lastTouch = sim.ball.ownerKey.split(':')[0];
    if (lastTouch === 'home') homeTouch++;
    else if (lastTouch === 'away') awayTouch++;
  }

  return {
    goalsFor: sim.score.home,
    goalsAgainst: sim.score.away,
    avgX: sumX / ticks,
    avgZ: sumZ / ticks,
    avgBallSpeed: sumBallSpeed / ticks,
    avgCarrySpell: carryTicks / Math.max(1, carrySpells),
    possession: homeTouch / Math.max(1, homeTouch + awayTouch),
    outsideTicks,
    longestCarry,
    carryShare: carryTicks / ticks,
  };
}

/** 여러 seed 평균 — 한 판의 우연이 아니라 경향을 본다. */
function playSeries(homeTactics, awayTactics = NEUTRAL) {
  const runs = SEEDS.map((seed) => play(homeTactics, awayTactics, seed));
  const avg = (pick) => runs.reduce((s, r) => s + pick(r), 0) / runs.length;
  return {
    runs,
    goalsFor: avg((r) => r.goalsFor),
    goalsAgainst: avg((r) => r.goalsAgainst),
    avgX: avg((r) => r.avgX),
    avgZ: avg((r) => r.avgZ),
    avgBallSpeed: avg((r) => r.avgBallSpeed),
    avgCarrySpell: avg((r) => r.avgCarrySpell),
    possession: avg((r) => r.possession),
    points: runs.reduce((s, r) => s + (r.goalsFor > r.goalsAgainst ? 3 : r.goalsFor === r.goalsAgainst ? 1 : 0), 0),
    scoreline: runs.map((r) => `${r.goalsFor}-${r.goalsAgainst}`).join(' '),
  };
}

const withAxis = (key, value) => ({ ...NEUTRAL, [key]: value });
const fixed = (n, d = 2) => n.toFixed(d);

// ---------- 1. 같은 입력은 항상 같은 결과 (결정론) ----------
const determinismA = play(NEUTRAL, NEUTRAL, SEEDS[0]);
const determinismB = play(NEUTRAL, NEUTRAL, SEEDS[0]);
check(
  '결정론',
  JSON.stringify(determinismA) === JSON.stringify(determinismB),
  `같은 seed·같은 전술인데 결과가 갈렸다 (${JSON.stringify(determinismA)} vs ${JSON.stringify(determinismB)})`
);

// ---------- 2. 축마다 경기가 실제로 달라지는가 ----------
// 축마다 "0 → 1로 올리면 이 지표가 이만큼 이 방향으로 움직인다"는 기대를 못 박는다.
// direction 1은 커져야 함, -1은 작아져야 함.
const AXES = [
  {
    key: 'lineHeight',
    label: '수비 라인',
    metric: 'avgX',
    unit: 'm',
    min: 3,
    direction: 1,
    describe: '라인을 올리면 팀 전체가 상대 진영 쪽에 선다',
  },
  {
    key: 'width',
    label: '진영 폭',
    metric: 'avgZ',
    unit: 'm',
    min: 2,
    direction: 1,
    describe: '폭을 넓히면 좌우로 벌려 선다',
  },
  {
    key: 'tempo',
    label: '공격 템포',
    metric: 'avgCarrySpell',
    unit: '틱',
    min: 3,
    direction: -1,
    describe: '템포를 올리면 볼을 오래 안 들고 빨리 내보낸다',
  },
  {
    key: 'pressing',
    label: '압박 강도',
    metric: 'possession',
    unit: '',
    min: 0.02,
    direction: 1,
    describe: '압박을 올리면 볼을 더 자주 되찾는다',
  },
];

console.log('축              낮음(0.0)      높음(1.0)      차이');
for (const axis of AXES) {
  const lo = playSeries(withAxis(axis.key, 0));
  const hi = playSeries(withAxis(axis.key, 1));
  const delta = hi[axis.metric] - lo[axis.metric];
  const gain = delta * axis.direction; // 기대 방향으로 얼마나 움직였는지
  console.log(
    `${axis.label.padEnd(12)} ${axis.metric}=${fixed(lo[axis.metric])}  ${fixed(hi[axis.metric])}  ${
      delta >= 0 ? '+' : ''
    }${fixed(delta)}${axis.unit}`
  );
  check(
    `${axis.label}(${axis.key})`,
    gain >= axis.min,
    `${axis.describe} — ${axis.metric}가 기대 방향으로 ${fixed(gain)}${axis.unit}밖에 안 움직였다 (최소 ${axis.min}${axis.unit})`
  );
}

// ---------- 3. 전술이 승패를 가르는가 ----------
// 같은 선수·같은 상대·같은 seed로 프리셋만 바꿔 치른다. 승점이 전부 같으면
// 전술은 "영향은 있지만 결과는 안 바뀌는" 장식이라는 뜻이다.
console.log('\n프리셋별 성적 (같은 선수·같은 상대·같은 seed 6경기)');
const presetRows = PRESET_LIBRARY.slice(0, 5).map((preset) => {
  const t = toTactics(preset);
  const r = playSeries(t);
  console.log(
    `${preset.name.padEnd(8)} 승점 ${String(r.points).padStart(2)} · 득 ${fixed(r.goalsFor, 1)} 실 ${fixed(
      r.goalsAgainst,
      1
    )} · 점유 ${fixed(r.possession * 100, 1)}% · ${r.scoreline}`
  );
  return { name: preset.name, ...r };
});

const points = presetRows.map((r) => r.points);
check(
  '전술이 승패를 가른다',
  new Set(points).size > 1,
  `프리셋 다섯 개의 승점이 전부 ${points[0]}로 같다 — 전술을 바꿔도 결과가 안 바뀐다`
);
check(
  '프리셋마다 다른 경기가 된다',
  new Set(presetRows.map((r) => r.scoreline)).size >= 3,
  `스코어 조합이 ${new Set(presetRows.map((r) => r.scoreline)).size}종류뿐이다 — 프리셋이 서로 구별되지 않는다`
);

// ---------- 4. 전술을 안 만진 경기는 예전 그대로 (중립 보존) ----------
// 모든 식이 0.5에서 배수 1이 되도록 맞춰 두었다는 약속을 지키는지 본다.
const neutralSeries = playSeries(NEUTRAL);
check(
  '중립 전술 보존',
  Number.isFinite(neutralSeries.avgX) && Math.abs(neutralSeries.avgX) < 20,
  `중립 전술인데 평균 진영이 ${fixed(neutralSeries.avgX)}m로 치우쳤다`
);

// ---------- 5. 전술을 어떻게 밀어도 경기는 경기장 안에서 이뤄지는가 ----------
// 네 축을 양 끝까지 밀어 본다. 전술이 대형을 미는 힘이 좌표 한계를 이기면
// 선수가 라인 밖에 서고(예전에 실제로 그랬다), 한 명이 볼을 잡고 골대까지 질주한다.
console.log('\n전술 극단값 · 경기장 이탈과 단독 드리블');
for (const [label, tactics] of [
  ['라인 0', withAxis('lineHeight', 0)],
  ['라인 1', withAxis('lineHeight', 1)],
  ['폭 0', withAxis('width', 0)],
  ['폭 1', withAxis('width', 1)],
  ['압박 1', withAxis('pressing', 1)],
  ['템포 0', withAxis('tempo', 0)],
]) {
  const r = play(tactics, tactics, SEEDS[0]);
  console.log(
    `  ${label.padEnd(7)} 라인 밖 ${String(r.outsideTicks).padStart(5)}선수·틱 · 최장 단독 드리블 ${fixed(r.longestCarry, 1)}m · 드리블 시간 ${fixed(r.carryShare * 100, 1)}%`
  );
  check(`${label} 경기장 이탈`, r.outsideTicks === 0, `선수가 라인 밖에 있던 순간이 ${r.outsideTicks}번 있었다`);
  // 한 번의 긴 질주는 버그가 아니다 — 양 팀이 다 올라선 상황의 역습은 실제로 절반을 달린다.
  // 진짜 신호는 "경기 내내 드리블만 한다"쪽이라 시간 비율을 주 기준으로 삼고,
  // 최장 거리는 골라인에서 골라인까지 걸어가던 옛 동작만 걸러 내는 헐거운 상한으로 둔다.
  // 70으로 둔 이유: 체력이 떨어질수록 최고속도가 실제로 느려지게 만든 뒤로(sim.js의
  // energy→maxSpeed 곡선), 지친 수비가 드리블러를 못 따라잡는 한 번의 긴 질주가 이전보다
  // 조금 더 길게 나올 수 있다 — 이건 의도한 체력 저하 효과지 버그가 아니다.
  check(
    `${label} 단독 드리블`,
    r.longestCarry < 70,
    `한 명이 ${fixed(r.longestCarry, 1)}m를 혼자 몰고 갔다 — 아무도 막지 못한다는 뜻이다`
  );
  check(
    `${label} 드리블 편중`,
    r.carryShare < 0.35,
    `경기 시간의 ${fixed(r.carryShare * 100, 1)}%가 드리블이다 — 볼이 돌지 않는다(정상은 10~25%)`
  );
}

// ---------- 6. 되감기가 미래를 바꿀 수 있는가 ----------
// 되감기의 값어치는 "같은 장면을 다시 보는 것"이 아니라 "다른 선택을 하는 것"이다.
// 실점 직전으로 되감았을 때 (a) 아무것도 안 바꾸면 같은 실점이 재현되고
// (b) 전술을 바꾸면 다른 전개가 나와야 한다. 되감는 폭이 너무 짧으면 (b)도 (a)가 된다.
function firstConcede() {
  for (const seed of [...SEEDS, 7, 77, 777, 7777]) {
    const sim = createSimulation(setupOf(NEUTRAL, NEUTRAL, seed));
    const buffer = new RewindBuffer();
    sim.kickoff({ kickoffTeam: 'home' });
    while (sim.phase !== 'fulltime') {
      if (sim.phase === 'halftime') sim.startSecondHalf();
      sim.step();
      buffer.maybeRecord(sim);
      if (sim.score.away > 0) {
        const concedeTick = sim.tick;
        const targetTick = sim.getRewindTargetTick();
        const snap = targetTick === null ? null : buffer.findNearestTick(targetTick);
        if (snap) return { sim, snap, concedeTick, targetTick, seed };
        return null;
      }
    }
  }
  return null;
}

/** 스냅샷에서 tactics를 걸고 seconds(경기 시간)만큼 다시 진행한 결과. */
function replayFrom(sim, snap, tactics, seconds) {
  sim.restore(snap);
  sim.applyTactics(tactics);
  const until = sim.tick + seconds / PARAMS.dt;
  while (sim.tick < until && sim.phase !== 'fulltime') {
    if (sim.phase === 'halftime') sim.startSecondHalf();
    sim.step();
  }
  return { home: sim.score.home, away: sim.score.away, ballX: Number(sim.ball.x.toFixed(3)) };
}

const concede = firstConcede();
if (!concede) {
  errors.push('되감기 검증: 실점이 나는 경기를 찾지 못했다 — 검증 자체가 성립하지 않는다');
} else {
  const lookbackSeconds = (concede.concedeTick - concede.targetTick) * PARAMS.dt;
  const REPLAY_SECONDS = 20;
  const same = replayFrom(concede.sim, concede.snap, NEUTRAL, REPLAY_SECONDS);
  const changed = replayFrom(concede.sim, concede.snap, { ...NEUTRAL, lineHeight: 0.1, pressing: 0.95, tempo: 0.9 }, REPLAY_SECONDS);
  console.log(
    `\n되감기 · seed ${concede.seed} · ${fixed(lookbackSeconds, 1)}분 앞으로 되감음\n` +
      `  그대로 진행: ${same.home}-${same.away} · 전술 변경: ${changed.home}-${changed.away}`
  );
  check(
    '되감기 폭',
    lookbackSeconds >= 8,
    `실점 ${fixed(lookbackSeconds, 1)}분 전으로밖에 못 되감는다 — 손쓸 틈 없이 같은 장면이 반복된다`
  );
  check(
    '되감은 뒤 전술로 미래가 바뀐다',
    JSON.stringify(same) !== JSON.stringify(changed),
    `되감고 전술을 바꿨는데 전개가 똑같다 (${JSON.stringify(same)})`
  );
}

if (errors.length) {
  console.error('\n' + errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `\n전술 영향력 검증 통과 · 네 축 모두 경기에 반영 · 프리셋별 승점 ${points.join('/')} · 결정론 유지`
  );
}
