import { PARAMS, FIELD, HALF, GOAL_W, GOAL_H, PENALTY_AREA } from './params.js';
import { vlen, clamp } from './math.js';
import { Rng, seededRandom, seededRandomPlayerId, ACTION_ID } from './rng.js';
import { Player, Ball } from './entities.js';
import { assignmentSlot, INSTRUCTION_FALLBACK } from './coordinates.js';
import { arrive, pursuit, separation, closest } from './steering.js';
import { chooseAction, effectivePressing, isOffside, nearestOpponentDistance, staminaMult, teamTacticsOf } from './decision.js';

const SIM_TACTIC_FALLBACK = { lineHeight: 0.5, pressing: 0.5, tempo: 0.5, width: 0.5 };
const TACTIC_KEYS = Object.keys(SIM_TACTIC_FALLBACK);
const INSTRUCTION_KEYS = Object.keys(INSTRUCTION_FALLBACK);
const SETUP_VERSION = 1;
const SQUAD_SIZE = 11;
const COORD_LIMIT = 0.5;
// 침투 지시가 공격 방향으로 자리를 미는 폭(m). 감독이 짠 대형이 무너지지 않을 만큼만 움직인다.
const RUN_PUSH = 26;
// 드리블 중 roaming 지시가 좌우로 흔드는 폭(m) — dribbleLookahead(전진 목표 거리)와는
// 별개로 잡아야 "많이 돌아다니는" 지시가 전진 속도까지 흔들지 않는다.
const ROAM_WOBBLE = 14;
// 스냅샷 1인당 저장 항목 수: x, z, vx, vz, heading, energy, kc
const SNAP_STRIDE = 7;
// 실점 이벤트로부터 몇 초(clockSeconds 단위) 전을 되감기 목표로 삼을지는
// PARAMS.rewindLookbackSeconds가 정한다 — 밸런스 상수는 params.js 한 곳에 모은다.

/**
 * 재개 종류별 전용 실행. restart()가 볼과 키커를 자리에 놓은 뒤 여기서 실제 동작을 한다.
 * 표로 둔 이유는 프리킥·페널티킥이 들어올 자리를 미리 열어 두기 위해서다 —
 * 여기 없는 종류는 예전처럼 발밑에 붙여 두고 일반 판단 파이프라인이 처리한다.
 */
const RESTART_EXECUTORS = {
  'goal-kick': (sim, taker) => sim.executeGoalKick(taker),
  corner: (sim, taker) => sim.executeCornerKick(taker),
  'throw-in': (sim, taker) => sim.executeThrowIn(taker),
  penalty: (sim, taker) => sim.executePenaltyKick(taker),
  'free-kick': (sim, taker) => sim.executeFreeKick(taker),
};

/** 감독에게 보여 줄 누적 지표 한 팀분. 전부 숫자라 스냅샷에 그대로 담긴다. */
const STAT_KEYS = ['possessionTicks', 'shots', 'onTarget', 'recoveries', 'left', 'center', 'right'];
const emptyStats = () => Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));

const inCoordRange = (n) => Number.isFinite(n) && n >= -COORD_LIMIT && n <= COORD_LIMIT;

/**
 * MatchSetup을 simulation 입장에서 검증한다.
 * roster/lineup/tactics를 import하지 않으므로 누락된 정보를 조회해 채우지 않고,
 * 경기를 시작할 수 없으면 명시적으로 오류를 낸다.
 *
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateMatchSetupForSim(matchSetup) {
  const errors = [];
  if (!matchSetup || typeof matchSetup !== 'object') return { ok: false, errors: ['MatchSetup이 없습니다.'] };
  if (matchSetup.version !== SETUP_VERSION) errors.push(`지원하지 않는 MatchSetup 버전: ${matchSetup.version}`);

  for (const side of ['homeTeam', 'awayTeam']) {
    const team = matchSetup[side];
    if (!team) {
      errors.push(`${side}가 없습니다.`);
      continue;
    }
    const assignments = team.lineup?.assignments ?? [];
    if (assignments.length !== SQUAD_SIZE) {
      errors.push(`${side} 배치가 ${SQUAD_SIZE}명이 아닙니다: ${assignments.length}명`);
    }
    const meta = new Map((team.players ?? []).map((p) => [p.id, p]));
    for (const a of assignments) {
      if (!inCoordRange(a?.x) || !inCoordRange(a?.z)) {
        errors.push(`${side} 좌표가 범위를 벗어났습니다: ${a?.playerId}`);
      }
      if (!a?.playerId || !meta.has(a.playerId)) {
        errors.push(`${side} 배치 선수의 메타가 없습니다: ${a?.playerId}`);
      }
      // 선수별 지시는 선택 항목이다 (없으면 0.5). 실려 왔다면 계약대로 0..1이어야 한다.
      if (a?.instruction != null) {
        for (const key of INSTRUCTION_KEYS) {
          const v = a.instruction[key];
          if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 1)) {
            errors.push(`${side} 선수별 지시 ${key}가 0..1이 아닙니다: ${a.playerId}`);
          }
        }
      }
    }
    for (const key of TACTIC_KEYS) {
      const v = team.tactics?.[key];
      if (!Number.isFinite(v) || v < 0 || v > 1) errors.push(`${side} 전술 ${key}가 0..1이 아닙니다.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 경기 시뮬레이션. Three.js를 전혀 import 하지 않는 순수 모듈이다.
 * - 렌더러는 sim.homeP / sim.awayP / sim.ball 을 읽기만 한다
 * - 모든 상태가 평범한 숫자라서 snapshot()/restore() 로 되감기가 가능하다
 *
 * 입력은 plain JSON `MatchSetup` 하나뿐이다. 포메이션 정의를 해석하지 않고
 * assignment에 실려 온 정규화 좌표만 월드 좌표로 바꿔 쓴다.
 */
export class Sim {
  /**
   * @param {object} matchSetup MatchSetup version 1
   * @param {object} [rules] 이 경기에만 적용되는 대회 규칙.
   *   `extraTime`이 켜져 있으면 90분에 동점일 때 연장 전·후반(105분·120분)을 치르고,
   *   `shootout`까지 켜져 있으면 120분에도 동점일 때 승부차기로 승자를 가린다.
   *   둘 다 기본값은 false다 — 친선·조별리그는 90분에 무승부로 끝나는 게 정상이다.
   */
  constructor(matchSetup, { extraTime = false, shootout = false } = {}) {
    const check = validateMatchSetupForSim(matchSetup);
    if (!check.ok) throw new Error(`잘못된 MatchSetup: ${check.errors.join(' / ')}`);

    this.rules = { extraTime, shootout };
    this.setup = matchSetup;
    this.matchId = matchSetup.matchId;
    this.seed = Number.isFinite(matchSetup.seed) ? matchSetup.seed : 2026;
    // formationId는 표시·기록용으로만 보관한다. 좌표 조회에는 쓰지 않는다.
    this.formation = matchSetup.homeTeam.lineup.formationId;
    this.oppFormation = matchSetup.awayTeam.lineup.formationId;
    this.tactics = { ...SIM_TACTIC_FALLBACK, ...matchSetup.homeTeam.tactics };
    this.oppTactics = { ...SIM_TACTIC_FALLBACK, ...matchSetup.awayTeam.tactics };
    this.homeLineup = matchSetup.homeTeam.lineup;
    this.awayLineup = matchSetup.awayTeam.lineup;
    this.build();
  }

  build() {
    this.rng = new Rng(this.seed);
    this.tick = 0;
    this.score = { home: 0, away: 0 };
    this.events = []; // {id, tick, type, team, text}
    this.eventSeq = 0; // 이벤트 고유 id 발급용 — events가 50개 넘어가면 shift()로 앞이 밀리므로,
    // UI 쪽에서 배열 인덱스로 "어디까지 그렸는지" 추적하면 밀린 만큼 어긋나 중복/누락이 난다.
    // 안 변하는 id를 UI가 대신 추적하게 한다.
    // 1 = 전반, 2 = 후반, 3 = 연장 전반, 4 = 연장 후반. 홀수 기간은 원래 진영,
    // 짝수 기간은 진영을 바꾼 상태다(매 기간 사이에 코트를 바꾼다) — refreshHomeSlots()가
    // 이 규칙 하나로 공격 방향을 정하므로 half는 항상 이 의미를 지켜야 한다.
    this.half = 1;
    // 'playing' | 'halftime' | 'extratime-break' | 'extratime-halftime' | 'shootout' | 'fulltime'
    // 'playing'이 아닌 값은 전부 "지금 볼이 안 구르고 있다"는 뜻이고, 화면이 각각에 맞는
    // 안내를 띄운 뒤 다음 기간을 시작한다. 'shootout'만은 예외로 계속 step()이 돈다.
    this.phase = 'playing';
    this.shootout = null; // 승부차기 상태 — beginShootout()이 채운다
    this.kickoffLock = null; // { team, active } — 킥오프 제한 구역 규칙
    // { from, until } — 코너킥이 날아오는 동안 문전 배치를 붙잡는다. 숫자 두 개뿐이라
    // 스냅샷이 무거워지지 않고, kickoffLock과 같은 방식이라 되감기 처리도 똑같다.
    this.setPieceHold = null;
    this.lastRewindTick = null; // 되감기를 실제로 사용한 시점(쿨다운 판정용) — restore()가 아니라 markRewindUsed()가 갱신한다

    this.homeP = this.buildSide('home', this.homeLineup, this.setup.homeTeam.players, this.tactics.width);
    this.awayP = this.buildSide('away', this.awayLineup, this.setup.awayTeam.players, this.oppTactics.width);
    this.all = [...this.homeP, ...this.awayP];
    this.ball = new Ball();

    // 교체 후보 — 벤치(substituteIds)에 있는 선수 메타만 담는다. 이미 투입된 선수는
    // substitute()가 여기서 지운다(같은 선수를 두 번 투입할 수 없다).
    this.homeBench = this.buildBench(this.setup.homeTeam);
    this.awayBench = this.buildBench(this.setup.awayTeam);
    this.lastOwnerTeam = null; // 볼 탈취(소유권이 상대에서 넘어온 순간)를 세려고 직전 소유 팀을 들고 있는다
    this.subsUsed = { home: 0, away: 0 };
    this.stats = { home: emptyStats(), away: emptyStats() };
  }

  /**
   * 감독에게 보여 줄 누적 지표를 갱신한다. 매 스텝 끝에서 한 번 불린다.
   *
   * 이벤트(this.events)로 세면 안 된다 — 링버퍼가 50개라 경기 중반부터 앞이 밀려 나가서
   * 누적 횟수가 실제보다 적게 잡힌다. 그래서 별도 카운터를 둔다.
   *
   * 지표는 전술 네 축과 하나씩 짝을 이루도록 골랐다. 감독이 "이 숫자가 나쁘니 이 축을
   * 만진다"로 이어지지 않는 지표는 화면만 복잡하게 만든다.
   *   점유율 -> 템포 · 슈팅 -> 라인/템포 · 볼 탈취 -> 압박 · 좌중우 분포 -> 폭
   */
  updateStats() {
    // 좌·중·우는 **볼이 아니라 선수가 어디 서 있는지**를 센다.
    //
    // 처음엔 소유 중인 볼의 z로 쟀는데 폭 지시에 전혀 반응하지 않았다 — 실측으로 중립 94%
    // 중앙, 폭 0에서 83%, 폭 1에서 87%로 오히려 역전됐다. 볼은 대형이 어떻든 중앙으로
    // 모이기 때문이다. 감독이 폭 손잡이로 실제로 움직이는 건 선수의 자리이므로 그걸 센다.
    // 좌우는 공격 방향 기준이라 진영이 바뀌어도 감독이 보는 "왼쪽"이 그대로다.
    for (const team of ['home', 'away']) {
      const s = this.stats[team];
      for (const p of team === 'home' ? this.homeP : this.awayP) {
        if (p.role === 'GK' || p.sentOff || p.injured) continue;
        const side = p.z * p.attackDirection;
        s[side < -PARAMS.statLaneHalfWidth ? 'left' : side > PARAMS.statLaneHalfWidth ? 'right' : 'center']++;
      }
    }

    // 점유율은 **마지막으로 건드린 팀** 기준이다. ownerKey로 세면 안 된다 — 느슨한 볼일 때는
    // 소유자가 없어서 표본이 듬성듬성해지고, 그래서 경기 초반에 92% : 8% 같은 값이 튄다.
    // 마지막 터치는 첫 터치 이후 항상 채워져 있어서 매 틱 세어지고, 값이 천천히 움직인다.
    const toucher = this.playerByKey(this.ball.lastTouchKey);
    if (toucher) this.stats[toucher.team].possessionTicks++;

    // 볼 탈취는 그대로 소유(ownerKey) 기준이다 — "실제로 발밑에 넣었다"가 되찾음이지
    // 스쳐 건드린 건 아니다.
    const owner = this.playerByKey(this.ball.ownerKey);
    if (!owner) {
      this.lastOwnerTeam = null;
      return;
    }
    if (this.lastOwnerTeam && this.lastOwnerTeam !== owner.team) this.stats[owner.team].recoveries++;
    this.lastOwnerTeam = owner.team;
  }

  /** 슛을 쐈다. onTarget은 골이 되거나 골키퍼가 막았을 때 별도로 올린다. */
  recordShot(team) {
    this.stats[team].shots++;
  }

  /** 골문으로 향한 슛. */
  recordShotOnTarget(team) {
    this.stats[team].onTarget++;
  }

  /**
   * 지금 볼의 속도로 날아가면 골문 안으로 들어가는가. 슛을 찬 **그 순간** 판정한다.
   *
   * 예전에는 "골키퍼가 건드렸으면 유효"로 셌는데, 키퍼 사거리(2.2m)를 스치는 빗나간 슛까지
   * 전부 유효로 잡혀서 사실상 모든 슛이 유효슈팅이 됐다(실측 87%, 실제 축구는 35% 안팎).
   * 키퍼가 어디 서 있느냐와 무관하게, 궤적이 골대 사이로 가는지만 본다 — 그게 유효슈팅의 정의다.
   *
   * 공기저항은 빼고 중력만 넣은 근사다. 슛은 골문까지 0.3~1초라 그 사이 감쇠는 작다.
   */
  shotOnTarget(shooter) {
    const b = this.ball;
    const goalX = shooter.attackDirection * HALF.L;
    const dx = goalX - b.x;
    if (dx * b.vx <= 0) return false; // 골문 반대쪽으로 가는 볼
    const t = dx / b.vx;
    const z = b.z + b.vz * t;
    const y = b.y + b.vy * t - 0.5 * PARAMS.gravity * t * t;
    return Math.abs(z) < GOAL_W / 2 && y > 0 && y < GOAL_H;
  }

  /** 슛 하나를 기록한다 — 시도는 항상, 유효는 궤적이 골문 안으로 갈 때만. */
  recordShotAttempt(shooter) {
    this.recordShot(shooter.team);
    if (this.shotOnTarget(shooter)) {
      this.recordShotOnTarget(shooter.team);
      // 골로 이어져도 같은 슛을 두 번 세지 않게 표시해 둔다(checkGoal이 이 값을 본다).
      this.ball.onTargetCounted = true;
    }
  }

  buildBench(team) {
    const ids = new Set(team.lineup.substituteIds ?? []);
    return new Map((team.players ?? []).filter((p) => ids.has(p.id)).map((p) => [p.id, p]));
  }

  buildSide(team, lineup, players, width) {
    const meta = new Map(players.map((p) => [p.id, p]));
    return lineup.assignments.map(
      (a, i) =>
        new Player({
          team,
          idx: i,
          meta: meta.get(a.playerId),
          slot: assignmentSlot(a, team, width),
          isCaptain: a.playerId === lineup.captainId,
        })
    );
  }

  /**
   * 선수 한 명에게 좌표 경로를 지시한다(되감기 후 드래그로 그린 길).
   * @param {string} playerKey `${team}:${idx}` — playerByKey()와 같은 형식
   * @param {{x:number,z:number}[]} waypoints 월드 좌표 경유점(현재 위치 제외)
   * @returns {boolean} 실제로 지시했는지
   */
  setCommand(playerKey, waypoints) {
    const p = this.playerByKey(playerKey);
    if (!p || !Array.isArray(waypoints) || waypoints.length === 0) return false;
    p.command = { waypoints: waypoints.map((w) => ({ x: w.x, z: w.z })), index: 0 };
    // 경로의 끝점을 그 선수의 새 기준 위치로 삼는다.
    //
    // 이게 없으면 경로를 다 걸어간 순간 command가 null이 되고, 다음 틱부터 스티어링이 다시
    // 원래 대형 자리(p.home)를 목표로 잡아서 선수가 슬금슬금 걸어 돌아간다 — 드래그가
    // "잠깐 다녀오는 심부름"이 돼 버린다. 기준 자체를 옮겨야 거기서부터 평소처럼 뛴다.
    // 못박아 두는 게 아니라 기준만 옮기는 것이라, 라인 오르내림(blockShift)과 침투런(run)은
    // 그 위에 그대로 얹혀서 자연스러운 움직임이 유지된다.
    const last = waypoints[waypoints.length - 1];
    p.homeOffset = { x: last.x - p.home.x, z: last.z - p.home.z };
    return true;
  }

  /**
   * 진행 중인 경로 지시를 취소하고 기본 AI로 되돌린다.
   * 기준 위치(homeOffset)는 건드리지 않는다 — "가던 길을 멈춘다"와 "옮겨 놓은 자리를
   * 되돌린다"는 다른 일이다. 대형을 원래대로 돌리려면 resetHomeOffset()을 쓴다.
   */
  clearCommand(playerKey) {
    const p = this.playerByKey(playerKey);
    if (p) p.command = null;
  }

  /** 드래그로 옮겨 놓은 기준 위치를 원래 대형으로 되돌린다. playerKey가 없으면 전원. */
  resetHomeOffset(playerKey = null) {
    const targets = playerKey ? [this.playerByKey(playerKey)] : this.all;
    for (const p of targets) if (p) p.homeOffset = { x: 0, z: 0 };
  }

  /** 전술만 갈아끼운다 (경기 중 실시간 지시). 배치는 현재 assignment를 그대로 쓴다. */
  applyTactics(tactics) {
    this.tactics = { ...this.tactics, ...tactics };
    this.refreshHomeSlots();
  }

  /**
   * 경기 중 라인업·전술 교체.
   * 포메이션 변경도 새 assignments 전체를 받아서 처리한다 — 여기서 포메이션을 해석하지 않는다.
   * @param {{lineup?: object, tactics?: object}} plan
   */
  applyMatchPlan({ lineup, tactics } = {}) {
    if (tactics) this.tactics = { ...this.tactics, ...tactics };
    if (lineup?.assignments?.length === SQUAD_SIZE) {
      this.homeLineup = lineup;
      this.formation = lineup.formationId ?? this.formation;
    }
    this.refreshHomeSlots();
  }

  /**
   * 선수 교체 — 부상이든 단순 체력 관리든 같은 경로를 쓴다(실제 축구도 이유를 안 가린다).
   * 나간 선수는 필드로 못 돌아오고, 들어온 선수는 나간 자리(위치·역할·개인 지시)를 그대로
   * 물려받되 체력은 100%로 새로 시작한다.
   *
   * ponytail: 되감기(snapshot/restore)는 선수 슬롯의 "수치"만 복원하고 선수 "객체"는
   * 안 바꾼다 — 그래서 교체 이전 시점으로 되감으면 나간 선수는 못 돌아오고 교체된 선수가
   * 그 수치를 그대로 이어받는다. 되감기가 실점 직전 15분 안쪽에서만 쓰이는 한정 자원이라
   * 교체와 겹칠 일이 드물어 지금은 감안하고 넘어간다 — 필요해지면 선수 객체 자체를
   * 스냅샷에 담게 확장한다.
   *
   * @returns {boolean} 실제로 교체했는지
   */
  substitute(team, outIdx, inPlayerId) {
    if (this.subsUsed[team] >= PARAMS.maxSubsPerTeam) return false;
    const side = team === 'home' ? this.homeP : this.awayP;
    const outPlayer = side[outIdx];
    if (!outPlayer || outPlayer.sentOff) return false; // 퇴장한 자리는 교체로 못 채운다
    const bench = team === 'home' ? this.homeBench : this.awayBench;
    const meta = bench.get(inPlayerId);
    if (!meta) return false; // 벤치에 없거나 이미 투입된 선수다

    const incoming = new Player({
      team,
      idx: outIdx,
      meta,
      slot: { x: outPlayer.home.x, z: outPlayer.home.z, role: outPlayer.role, instruction: outPlayer.ins },
    });
    incoming.attackDirection = outPlayer.attackDirection;
    // 들어오는 선수는 그 자리의 지시를 물려받는다 — 감독이 옮겨 놓은 기준 위치는 사람이
    // 아니라 그 포지션에 내린 지시라서, 교체로 리셋되면 대형이 저절로 흐트러진다.
    incoming.homeOffset = { ...outPlayer.homeOffset };
    incoming.x = outPlayer.x;
    incoming.z = outPlayer.z;
    incoming.heading = outPlayer.heading;

    const key = `${team}:${outIdx}`;
    if (this.ball.carrierKey === key) this.ball.carrierKey = null;
    if (this.ball.ownerKey === key) this.ball.ownerKey = null;

    side[outIdx] = incoming;
    this.all = [...this.homeP, ...this.awayP];
    bench.delete(inPlayerId);
    this.subsUsed[team]++;
    this.pushEvent('substitution', team, `${meta.name} 투입 ↔ ${outPlayer.name} 교체 아웃`);
    return true;
  }

  refreshHomeSlots() {
    this.homeP.forEach((p, i) => {
      const a = this.homeLineup.assignments[i];
      if (!a) return;
      const s = assignmentSlot(a, 'home', this.tactics.width);
      // 짝수 기간(후반·연장 후반)은 진영을 바꿔 뛴다.
      const halfTurn = this.half % 2 === 0 ? -1 : 1;
      p.home.x = s.x * halfTurn;
      p.home.z = s.z * halfTurn;
      p.attackDirection = halfTurn;
      p.role = s.role;
      // 경기 중 지시 변경도 여기로 들어온다. 다음 스텝부터 바로 반영된다.
      p.ins = s.instruction;
    });
  }

  /**
   * 한 팀의 대형이 이번 스텝에 앞뒤로 얼마나 밀릴지(m).
   *
   * 볼 위치를 따라가는 몫과 라인 높이가 통째로 미는 몫을 더한 값이지만, 그대로 쓰면
   * 라인을 끝까지 내렸을 때 뒷줄이 골라인 밖으로 밀려난다. 그래서 **팀 전체에 같은 비율**을
   * 곱해, 가장 여유 없는 선수가 경기장 안에 머물 수 있는 만큼만 움직인다 —
   * 대형의 간격은 그대로 유지되고(비율 이동), 한 줄에 쌓이거나 라인을 넘는 일이 없다.
   */
  blockShift(team) {
    const tactics = team === 'home' ? this.tactics : this.oppTactics;
    const dir = (team === 'home' ? this.homeP : this.awayP)[0]?.attackDirection ?? (team === 'home' ? 1 : -1);
    const line = tactics.lineHeight;
    const raw =
      (this.ball.x / FIELD.L) * (14 + line * 22) + (line - 0.5) * PARAMS.lineHeightBasePush * dir;
    if (!raw) return 0;

    const limit = HALF.L - PARAMS.formationTargetGoalMargin;
    let scale = 1;
    for (const p of team === 'home' ? this.homeP : this.awayP) {
      if (p.role === 'GK') continue; // 골키퍼는 대형이 아니라 자기 골문을 따른다
      // 여유 계산도 실제 기준 위치(드래그 변위 포함)로 해야 한다 — 앞으로 끌어다 놓은
      // 선수를 빼고 재면 라인을 올렸을 때 그 선수만 골라인 밖으로 밀린다.
      const baseX = p.home.x + p.homeOffset.x;
      const room = raw > 0 ? limit - baseX : baseX + limit;
      scale = Math.min(scale, clamp(room / Math.abs(raw), 0, 1));
    }
    return raw * scale;
  }

  /**
   * 좌우 블록 이동 — 볼이 있는 쪽으로 팀 전체가 통째로 미끄러진다.
   *
   * 앞뒤(blockShift)는 있었는데 좌우가 없었다. 개인이 볼 쪽으로 15%만 당겨지는 항 하나뿐이라,
   * 볼이 오른쪽 터치라인에 있어도 왼쪽 풀백은 9m만 움직이고 22m 떨어진 반대편에 혼자 남았다 —
   * "공은 반대편에 있고 마크할 사람도 없는데 혼자 저 멀리 서 있는" 그림이 여기서 나온다.
   * 실제 축구의 수비 블록은 볼 쪽으로 통째로 슬라이드하고, 반대편 풀백은 중앙으로 좁혀 든다.
   *
   * blockShift와 달리 팀 전체에 같은 비율을 곱해 줄이지 않는다. 대형이 이미 좌우로 거의
   * 꽉 차 있어서(풀백이 ±31.3m) 그 방식을 쓰면 여유가 0이라 이동량이 통째로 사라진다.
   * 대신 선수마다 경기장 안으로 자르게 둔다 — 그러면 볼 쪽 선수는 터치라인에서 멈추고
   * 반대편 선수만 좁혀 들어와서, 실제 블록 슬라이드와 같은 모양이 된다.
   */
  lateralShift(team) {
    const tactics = team === 'home' ? this.tactics : this.oppTactics;
    return this.ball.z * (PARAMS.lateralShiftBase + tactics.pressing * PARAMS.lateralShiftPress);
  }

  get clockSeconds() {
    return this.tick * PARAMS.dt;
  }

  /** 표시용 경기 시간 — 1초 = 게임 1분 스케일 */
  get matchMinute() {
    return Math.floor(this.clockSeconds);
  }

  /**
   * 킥오프 규정 ① — 휘슬 전에는 양 팀 모두 자기 진영 안에 있어야 한다. 공격 대형의 기준
   * 위치(전방 포지션 줄)는 하프라인을 넘어가 있을 수 있어(공격 중 전진하는 모양이라 원래
   * 그렇게 설계됐다), 킥오프 순간에만 자기 진영 안쪽으로 당겨 세운다.
   */
  confineToOwnHalf(p) {
    const limit = -p.attackDirection * PARAMS.restartInset;
    if (p.attackDirection > 0 ? p.x > limit : p.x < limit) p.x = limit;
  }

  /**
   * 킥오프 규정 ② — 센터서클(9.15m) 밖으로 물러세운다. 자기 진영 안이라는 ①도 같이
   * 만족해야 하므로, 하프라인을 넘는 성분을 먼저 자른 뒤 그 방향으로 반지름까지 밀어낸다.
   *
   * 정확히 센터마크 정면에 서 있던 선수(중앙 원톱처럼 z=0인 자리)는 밀어낼 방향이 없다.
   * 그 경우는 자기 골문 쪽으로 곧게 물러선다.
   */
  pushOutsideCenterCircle(p) {
    const limit = -p.attackDirection * PARAMS.restartInset;
    let dx = p.attackDirection > 0 ? Math.min(p.x, limit) : Math.max(p.x, limit);
    let dz = p.z;
    const radius = PARAMS.centerCircleRadius + PARAMS.restartInset;
    let d = vlen(dx, dz);
    if (d >= radius) {
      p.x = dx; // 이미 규정 거리 밖 — 진영만 맞춰 준다
      return;
    }
    if (d < 1e-6) {
      dx = limit;
      dz = 0;
      d = Math.abs(limit);
    }
    const scale = radius / d;
    p.x = clamp(dx * scale, -HALF.L + PARAMS.playerLineInset, HALF.L - PARAMS.playerLineInset);
    p.z = clamp(dz * scale, -HALF.W + PARAMS.playerLineInset, HALF.W - PARAMS.playerLineInset);
  }

  /**
   * 킥오프 — 실제 축구의 순서를 그대로 따른다.
   *
   *   ① 볼을 센터마크에 **정지시켜** 놓는다(여기서는 아직 차지 않는다).
   *   ② 스물두 명 전원이 자기 진영으로 물러선다.
   *   ③ 킥오프 팀의 키커·파트너 두 명만 센터서클 안에 남고, 나머지 스무 명은 서클 밖으로
   *      물러선다(규정은 상대 팀만이지만, 실제 킥오프도 같은 편이 서클 안에 서 있지는 않다).
   *   ④ kickoffSetupTicks 동안 아무도 움직이지 않는다 — 주심이 자리를 확인하는 시간이다.
   *   ⑤ 휘슬. launchKickoff()가 키커 → 파트너로 짧게 밀어 주면서 볼이 인플레이가 된다.
   *
   * 예전에는 ①③④가 통째로 없어서 배치와 동시에 볼을 차 버렸다. 그래서 중앙 원톱을 쓰는
   * 포메이션(4-3-3 · 4-2-3-1 · 3-4-3)에서는 상대 공격수의 기준 위치가 ②에 걸려 하프라인
   * 앞 0.5m, z=0 — 즉 **볼에서 0.5m** 되는 자리로 잘려 서고, 킥오프 다음 틱에 그 선수가
   * 그대로 볼을 낚아챘다(12경기 실측: 그 세 포메이션은 킥오프 100%가 첫 틱에 상대 볼).
   * 그러고 나면 센터서클에 양 팀이 겹쳐 선 채로 킥 쿨다운 8틱마다 경합·탈취가 되풀이돼
   * 볼이 핀볼처럼 튀었다 — 소유권 전환이 경기당 27회에서 63~94회로 뛰었다.
   */
  kickoff({ kickoffTeam = 'home' } = {}) {
    this.ball.reset();
    // 직전 장면(코너 등)의 배치 홀드가 남아 있으면 킥오프 대형이 그것에 묶인다.
    this.setPieceHold = null;
    for (const p of this.all) {
      // 골이 들어가 킥오프로 돌아가도 감독이 옮겨 놓은 대형은 유지된다 — 드래그가
      // "이번 한 번"이 아니라 새 기준이라는 뜻이므로 킥오프 정렬도 그 기준을 따른다.
      p.x = p.home.x + p.homeOffset.x;
      p.z = p.home.z + p.homeOffset.z;
      this.confineToOwnHalf(p);
      p.vx = 0;
      p.vz = 0;
      p.kc = 0;
    }
    const team = kickoffTeam === 'home' ? this.homeP : this.awayP;
    const taker = closest(team, this.ball); // GK 제외, 센터(볼)에 가장 가까운 선수
    const partner = taker
      ? closest(
          team.filter((p) => p !== taker),
          this.ball
        )
      : null;
    for (const p of this.all) {
      if (p === taker || p === partner) continue;
      this.pushOutsideCenterCircle(p);
    }
    if (taker) {
      // 실제 킥오프처럼 선수를 공 위치(센터)에 정확히 세운다 — 걸어가서 잡는 게 아니라 바로 서있게 한다
      taker.x = 0;
      taker.z = 0;
    }
    if (partner) {
      // 짧은 첫 패스를 받을 파트너를 자기 진영 쪽으로 살짝 물러선 위치(minPass 이상 거리)에 세운다
      partner.x = -taker.attackDirection * (PARAMS.minPass + 1);
      partner.z = 0;
      // 키커·파트너 모두 볼 쪽(하프라인 쪽)을 본다 — 배치 화면이 멈춰 있는 동안 등을 돌리고
      // 서 있으면 킥오프처럼 안 보인다. heading은 sin/cos 순서(atan2(vx, vz))를 따른다.
      partner.heading = Math.atan2(taker.attackDirection, 0);
      taker.heading = Math.atan2(-taker.attackDirection, 0);
    }
    this.kickoffLock = {
      team: kickoffTeam,
      active: true,
      // 주심 휘슬 tick. 여기 닿기 전까지 step()은 경기를 한 발짝도 진행하지 않는다.
      whistleTick: this.tick + PARAMS.kickoffSetupTicks,
      takerKey: taker ? `${taker.team}:${taker.idx}` : null,
      partnerKey: partner ? `${partner.team}:${partner.idx}` : null,
    };
  }

  /**
   * 킥오프 휘슬 — 키커가 파트너에게 짧게 밀어 주면서 볼이 인플레이가 된다.
   *
   * tryKick()의 일반 패스 점수(전진 편향)에 맡기면 파트너가 아닌 다른 선수에게 갈 수 있어
   * 킥오프 첫 패스만은 taker → partner로 직접 지정한다(실제 킥오프는 항상 옆·뒤로 짧게 시작한다).
   */
  launchKickoff() {
    const lock = this.kickoffLock;
    if (!lock) return;
    lock.whistleTick = null; // 휘슬은 한 번뿐 — 이후 step()은 평소대로 흐른다
    const taker = this.playerByKey(lock.takerKey);
    const partner = this.playerByKey(lock.partnerKey);
    if (taker && partner) {
      taker.kc = PARAMS.kickCooldownTicks;
      this.ball.kick(partner.x - taker.x, partner.z - taker.z, PARAMS.passForce, lock.takerKey);
    } else if (taker) {
      this.ball.ownerKey = lock.takerKey;
      this.ball.carrierKey = lock.takerKey;
      this.ball.lastTouchKey = lock.takerKey;
    } else {
      // 찰 사람이 아무도 없다(전원 퇴장·부상). 제한만 풀어 경기가 굳지 않게 한다.
      this.kickoffLock = null;
    }
  }

  /** 후반 시작 — 관례상 원정팀 킥오프 */
  startSecondHalf({ swapEnds = false } = {}) {
    if (this.half !== 1) return;
    this.startNextPeriod({ swapEnds });
  }

  /**
   * 다음 기간(후반 / 연장 전반 / 연장 후반)을 시작한다.
   *
   * 킥오프 팀은 기간마다 번갈아 간다 — 전반은 홈, 후반은 원정, 연장 전반은 다시 홈,
   * 연장 후반은 원정. 진영도 매 기간 바꾸므로 half의 홀짝이 곧 공격 방향이 된다
   * (refreshHomeSlots의 halfTurn과 같은 규칙이다).
   */
  startNextPeriod({ swapEnds = false } = {}) {
    if (this.half >= 4) return;
    this.half += 1;
    this.phase = 'playing';
    if (swapEnds) {
      // 진영 교체는 포메이션을 센터 기준으로 180도 돌리고 공격 골대도 반대로 바꾼다.
      for (const p of this.all) {
        p.home.x *= -1;
        p.home.z *= -1;
        // 감독이 옮겨 놓은 변위도 같이 뒤집는다 — 안 뒤집으면 진영이 바뀐 뒤에 지시가
        // 좌우/전후로 정반대인 자리를 가리킨다(왼쪽으로 벌려 놓은 선수가 오른쪽에 선다).
        p.homeOffset.x *= -1;
        p.homeOffset.z *= -1;
        p.attackDirection *= -1;
        p.heading = (p.heading + Math.PI) % (Math.PI * 2);
        p.command = null;
      }
    }
    this.kickoff({ kickoffTeam: this.half % 2 === 0 ? 'away' : 'home' });
  }

  /** 그 기간이 끝나는 시각(clockSeconds = 게임 분). 45 / 90 / 105 / 120 */
  periodEndClock(half = this.half) {
    const regulation = PARAMS.halfMinutes * Math.min(half, 2);
    return regulation + PARAMS.extraHalfMinutes * Math.max(0, half - 2);
  }

  /** 그 기간이 시작한 tick — 되감기가 기간 경계를 넘지 않게 자를 때 쓴다. */
  periodStartTick(half = this.half) {
    return half <= 1 ? 0 : this.periodEndClock(half - 1) / PARAMS.dt;
  }

  get drawn() {
    return this.score.home === this.score.away;
  }

  /**
   * 전/후반·연장 종료를 판단한다. matchMinute(표시용, Math.floor)가 아니라 clockSeconds로 비교한다 —
   * halfMinutes가 1보다 작아지면 floor 때문에 halftime·fulltime 임계값이 같은 정수로 뭉개질 수 있다.
   *
   * 규칙(실제 축구): 90분 동점이면 연장 전·후반 15분씩을 **끝까지** 치른다(골든골 없음).
   * 120분에도 동점이면 승부차기로 넘어간다.
   */
  updatePhase() {
    if (this.phase !== 'playing') return;
    if (this.clockSeconds < this.periodEndClock()) return;

    if (this.half === 1) {
      this.phase = 'halftime';
      return;
    }
    if (this.half === 2) {
      if (this.rules.extraTime && this.drawn) {
        this.phase = 'extratime-break';
        this.pushEvent('period', 'home', '90분 종료 · 연장전');
        return;
      }
      this.phase = 'fulltime';
      return;
    }
    if (this.half === 3) {
      this.phase = 'extratime-halftime';
      return;
    }
    // 연장 후반 종료
    if (this.rules.shootout && this.drawn) {
      this.beginShootout();
      return;
    }
    this.phase = 'fulltime';
  }

  playerByKey(key) {
    if (!key) return null;
    const [team, idx] = key.split(':');
    return (team === 'home' ? this.homeP : this.awayP)[Number(idx)] ?? null;
  }

  step() {
    if (this.phase === 'fulltime') return; // 종료 후에는 위치를 더 갱신하지 않는다 (호출은 무해하게 무시)
    // 승부차기는 경기가 아니다 — 필드 플레이어 판단·대형·체력을 전부 멈추고
    // 키커와 골키퍼만 움직이는 전용 루프로 넘긴다.
    if (this.phase === 'shootout') return this.stepShootout();

    // 킥오프 준비 — 주심 휘슬 전이다. 볼은 센터마크에 멈춰 있고 스물두 명 모두 잡아 놓은
    // 자리에 선 채로 한 발짝도 움직이지 않는다.
    //
    // 시계는 그대로 흐르게 둔다. tick을 멈추면 되감기 링버퍼가 같은 tick 스냅샷을 계속
    // 덮어써서(maybeRecord는 tick % interval로만 거른다) 되감기 폭이 그만큼 갉아먹힌다.
    if (this.kickoffLock?.whistleTick != null) {
      if (this.tick < this.kickoffLock.whistleTick) {
        this.tick++;
        this.updatePhase();
        return;
      }
      this.launchKickoff();
    }

    // 매 스텝 시작 시 이전 스텝에서 남은 볼 속도로 킥오프 제한 해제 여부를 판정한다
    if (this.kickoffLock?.active && vlen(this.ball.vx, this.ball.vz) > PARAMS.kickoffUnlockSpeed) {
      this.kickoffLock = null;
    }
    // 세트피스 홀드는 볼이 더 이상 안 올라가면서 헤딩 높이 밑으로 내려오면 풀린다.
    // 킥 직후에는 vy > 0이라 곧바로 해제되지 않는다. 상한(until)은 안전장치다.
    //
    // 여기 조건이 `vy < 0`이면 안 된다 — 땅에 놓인 볼은 vy가 정확히 0이라 조건이 영원히
    // 거짓이 되고, 홀드가 상한 170틱(2.8초)을 통째로 채운다. 그동안 볼 쫓는 한 명 말고는
    // 아무도 안 움직여서 캐리어가 무방비로 몰고 간다 — 실측으로 단독 드리블 최장 기록이
    // 38.9m에서 71.2m로 뛰어 validate-tactics-impact가 이걸 잡아냈다.
    const hold = this.setPieceHold;
    if (hold && (this.tick >= hold.until || (this.ball.vy <= 0 && this.ball.y <= PARAMS.headControlHeight))) {
      this.setPieceHold = null;
    }

    const dt = PARAMS.dt;
    const t = this.tactics;
    const lock = this.kickoffLock?.active ? this.kickoffLock : null;
    // 킥오프 팀이 아닌 쪽은 이번 스텝에서 chaser 후보에서 제외된다
    const hc = lock && lock.team !== 'home' ? null : closest(this.homeP, this.ball);
    const ac = lock && lock.team !== 'away' ? null : closest(this.awayP, this.ball);
    // 압박이 센 팀은 볼에 가장 가까운 한 명만 나가지 않는다 — 두 번째 선수가 함께 달려들어
    // 협위(挾圍)를 만든다. 압박 0.5 이하에서는 반경이 0이라 예전 동작 그대로다.
    const hs = hc ? closest(this.homeP.filter((p) => p !== hc), this.ball) : null;
    const as = ac ? closest(this.awayP.filter((p) => p !== ac), this.ball) : null;
    // 대형 이동은 팀 단위 값이라 선수마다 다시 계산하지 않는다.
    const homeShift = this.blockShift('home');
    const awayShift = this.blockShift('away');
    // 좌우 블록 이동도 팀 단위 값이라 선수마다 다시 계산하지 않는다.
    const homeSide = this.lateralShift('home');
    const awaySide = this.lateralShift('away');

    for (const p of this.all) {
      if (p.sentOff || p.injured) continue; // 퇴장·부상 선수는 경기장 밖에 멈춰 선 채로 다시 움직이지 않는다
      const mates = p.team === 'home' ? this.homeP : this.awayP;
      const chaser = p.team === 'home' ? hc : ac;
      const mine = p.team === 'home';
      const restricted = !!lock && p.team !== lock.team;
      // 양 팀 모두 자기 전술로 뛴다 — 감독이 만지는 건 홈뿐이지만, 경기는 두 전술의 대결이다.
      // 개인 지시는 팀 값을 덮어쓰지 않고 ±0.3까지 밀거나 당긴다 — 팀 전술이 여전히 뼈대다.
      const tt = mine ? t : this.oppTactics;
      const press = clamp(tt.pressing + (p.ins.pressing - 0.5) * 0.6, 0, 1);
      // 마지막으로 공을 찬 쪽을 그 팀의 소유로 본다. 침투는 이때만 의미가 있다.
      const holding = this.ball.ownerKey ? this.ball.ownerKey.startsWith(p.team) : false;

      // 체력 → 최고 속도는 스티어링보다 먼저 확정한다.
      // 뒤에서 갱신하면 한 스텝 늦은 값이 힘 계산에 섞여 되감기 재현성이 깨진다.
      // 0.72~1.0(예전)은 완전히 지쳐도 82%로 뛸 수 있어 체감이 안 됐다 — 0.55~1.0으로 넓혀
      // 방전 상태(energyMin)에서는 최고 속도가 눈에 띄게 둔화된다.
      p.maxSpeed = p.maxSpeedBase * (0.6 + p.energy * 0.4);

      let fx = 0;
      let fz = 0;

      const isCarrier = this.ball.carrierKey === `${p.team}:${p.idx}`;

      if (p.command && !this.commandYieldsToBall(p, isCarrier)) {
        // 감독이 되감기 후 드래그로 내린 경로 지시 — 기본 AI보다 우선한다.
        // 단, 볼이 코앞이면 축구가 먼저다(commandYieldsToBall). 예전에는 이 조건이 없어서
        // 지시받은 선수가 목적지에 닿을 때까지 옆으로 지나가는 볼을 완전히 무시했다.
        const wp = p.command.waypoints[p.command.index];
        [fx, fz] = arrive(p, wp.x, wp.z);
        if (vlen(wp.x - p.x, wp.z - p.z) < PARAMS.comfortZone) {
          p.command.index++;
          if (p.command.index >= p.command.waypoints.length) p.command = null; // 다 왔으면 기본 AI로 복귀
        }
      } else if (p.role === 'GK') {
        const [gx, gz] = this.goalkeeperTarget(p);
        [fx, fz] = arrive(p, gx, gz);
      } else if (isCarrier && p.dribbleMode === 'hold') {
        // 키핑 — 판단(decision.js scoreHoldCandidate)이 "제자리에서 볼을 지킨다"를 골랐을 때.
        // 목표를 자기 자신으로 두면 arrive()가 [0,0]을 돌려줘 정지 상태가 된다.
        [fx, fz] = arrive(p, p.x, p.z);
      } else if (isCarrier) {
        // 드리블 중 — 공을 몰고 상대 골 쪽으로 전진한다(목표를 매 틱 앞으로 다시 잡아 계속
        // 전진하게 만든다). 개인 지시(roaming)로 살짝 좌우 흔들림을 준다.
        const dir = p.attackDirection;
        const tx = clamp(p.x + dir * PARAMS.dribbleLookahead, -HALF.L, HALF.L);
        const tz = clamp(p.z + (p.ins.roaming - 0.5) * ROAM_WOBBLE, -HALF.W, HALF.W);
        [fx, fz] = arrive(p, tx, tz);
      } else if (p === chaser) {
        // 압박이 낮으면 곧바로 달려들지 않고 살짝 못 미친 자리에서 길을 막는다(내려앉는 수비).
        //
        // 압박 축의 **아래 절반이 통째로 죽어 있었다**. 협위 반경이 clamp((press-0.5)*2,0,1)라
        // 0.5 이하에서는 0이고, 볼을 쫓는 첫 번째 선수는 압박과 무관하게 항상 전력으로
        // 달려들었다. 실측으로 압박 0.0과 0.5가 사실상 같았다 — 되찾은 위치 -7.8m vs -8.1m,
        // 상대가 잡고 있던 시간 324틱 vs 317틱, 볼 10m 안 인원 1.14 vs 1.17.
        //
        // standoff는 압박 0.5에서 정확히 0이다. 즉 중립과 고압박(0.5~1.0)은 이 항의 영향을
        // 전혀 안 받고 예전 동작 그대로다 — 손대는 건 죽어 있던 아래 절반뿐이다.
        const standoff = holding ? 0 : Math.max(0, 0.5 - press) * 2 * PARAMS.pressStandoff;
        if (standoff > 0) {
          const bdx = this.ball.x - p.x;
          const bdz = this.ball.z - p.z;
          const bd = vlen(bdx, bdz) || 1;
          [fx, fz] = arrive(p, this.ball.x - (bdx / bd) * standoff, this.ball.z - (bdz / bd) * standoff);
        } else {
          [fx, fz] = pursuit(p, this.ball);
        }
      } else if (
        // 협위 압박 — 우리가 볼을 갖고 있지 않을 때, 압박 지시가 센 팀의 두 번째 선수가
        // 볼로 함께 달려든다. 반경은 압박 0.5에서 0, 1.0에서 pressSupportRadius다.
        p === (mine ? hs : as) &&
        !holding &&
        !restricted &&
        vlen(this.ball.x - p.x, this.ball.z - p.z) < clamp((press - 0.5) * 2, 0, 1) * PARAMS.pressSupportRadius
      ) {
        [fx, fz] = pursuit(p, this.ball);
      } else if (this.setPieceHold) {
        // 코너킥이 날아오는 동안의 문전 움직임.
        //
        // 배치를 안 붙잡으면 다들 자기 대형 자리로 되돌아가서 볼이 도착할 무렵엔 박스가
        // 빈다 — 실측으로 킥 순간 박스 안 공격수 7.00명이 도착 순간 3.01명까지 빠졌다
        // (체공 2.23초 동안 10m 넘게 움직인다).
        //
        // 그렇다고 전부 얼리면 반대로 무너진다. 볼을 쫓는 한 명(chaser)만 움직이니 수비가
        // 낙하 지점 경합을 아예 안 해서 코너 득점률이 50.9%까지 치솟았다(실제 축구는 2~3%).
        // 그래서 낙하 예측 지점 근처에 있는 선수는 **양 팀 모두** 그리로 달려들고,
        // 나머지만 자리를 지킨다. 이러면 공중볼 다툼이 실제로 벌어진다.
        const land = this.ball.predictLanding();
        const near = vlen(land.x - p.x, land.z - p.z) < PARAMS.setPieceContestRadius;
        [fx, fz] = near ? arrive(p, land.x, land.z) : arrive(p, p.x, p.z);
      } else {
        // 대형 전체가 같은 폭으로 밀린다(blockShift가 이미 경기장 안에 들어오도록 비율을
        // 맞춰 둔 값이다). 우리팀이 공을 갖고 있을 때만 개인차 있는 침투런을 얹는다.
        const shift = mine ? homeShift : awayShift;
        const run = holding ? (p.ins.runs - 0.5) * RUN_PUSH * p.attackDirection : 0;
        // 침투런까지 더한 뒤 마지막으로 한 번 더 라인 안쪽으로 자른다 — 어떤 지시를 줘도
        // 목표 지점은 경기장 안이어야 한다.
        const margin = PARAMS.formationTargetGoalMargin;
        // 감독이 드래그로 옮겨 놓은 자리를 기준으로 삼는다(homeOffset). 라인 오르내림(shift)과
        // 침투런(run)은 그 위에 그대로 얹히므로, 옮긴 자리에 못박히지 않고 거기서부터 뛴다.
        const baseX = p.home.x + p.homeOffset.x;
        const baseZ = p.home.z + p.homeOffset.z;
        let tx = clamp(baseX + shift + run, -HALF.L + margin, HALF.L - margin);
        // NOTE: 폭이 넓을수록 볼 쪽으로 더 따라붙게 하는 항을 여기 넣었다가 뺐다.
        // 폭 1.0에서 팀이 무너지는 원인을 "벌려서 볼에서 멀어진다"로 보고 보정했는데,
        // 진짜 원인은 대형 계산 쪽이었고(coordinates.js의 등급형 확산 주석 참고) 이 보정은
        // 오히려 폭을 올릴수록 팀을 중앙으로 모아서 폭 축 자체를 죽였다 —
        // 실측: 폭 1.0의 좌우 폭이 54.1m(보정 없음)에서 44.2m로 줄어 중립(53.3m)보다 좁아졌다.
        // 블록 전체가 볼 쪽으로 미끄러지고(side), 그 위에 개인의 활동량(roaming)만큼 더 붙는다.
        const side = mine ? homeSide : awaySide;
        let tz = clamp(
          baseZ + side + (this.ball.z - baseZ - side) * (0.08 + press * 0.14) * (0.15 + p.ins.roaming * 1.7),
          -HALF.W + margin,
          HALF.W - margin
        );
        if (restricted) {
          // 킥오프 규정: 상대팀 선수는 볼이 움직이기 전까지 센터서클 밖에 있어야 한다
          const d = vlen(tx, tz);
          if (d < PARAMS.centerCircleRadius) {
            if (d < 1e-6) {
              tx = -p.attackDirection * PARAMS.centerCircleRadius;
              tz = 0;
            } else {
              const scale = PARAMS.centerCircleRadius / d;
              tx *= scale;
              tz *= scale;
            }
          }
        }
        const comfort = PARAMS.comfortZone * (0.3 + p.ins.coverage * 1.4);
        if (vlen(tx - p.x, tz - p.z) > comfort) [fx, fz] = arrive(p, tx, tz);
      }

      const [sxx, szz] = separation(p, mates);
      fx += sxx * PARAMS.sepWeight;
      fz += szz * PARAMS.sepWeight;

      const fl = vlen(fx, fz);
      if (fl > PARAMS.maxForce) {
        fx = (fx / fl) * PARAMS.maxForce;
        fz = (fz / fl) * PARAMS.maxForce;
      }

      p.vx += fx * dt;
      p.vz += fz * dt;
      const sp = vlen(p.vx, p.vz);
      if (sp > p.maxSpeed) {
        p.vx = (p.vx / sp) * p.maxSpeed;
        p.vz = (p.vz / sp) * p.maxSpeed;
      }
      // 선수는 어떤 전술·지시로도 경기장 밖에 서지 않는다. 라인을 밟고 서는 것도 막아
      // 시각적으로 "밖으로 나간" 것처럼 보이지 않게 살짝 안쪽까지만 허용한다.
      p.x = clamp(p.x + p.vx * dt, -HALF.L + PARAMS.playerLineInset, HALF.L - PARAMS.playerLineInset);
      p.z = clamp(p.z + p.vz * dt, -HALF.W + PARAMS.playerLineInset, HALF.W - PARAMS.playerLineInset);
      if (isCarrier) {
        // 드리블로는 골라인을 절대 못 넘는다(골은 슛으로만) — mandatoryShotDistance가 미리
        // 슛을 강제하지만, 그 전에라도 몸으로 넘어가 버리는 걸 여기서 한 번 더 확실히 막는다.
        // dribbleCarryOffset(볼을 몸 앞에 붙이는 거리)만큼 더 여유를 둬야, 붙어있는 볼까지
        // 골라인에 안 닿는다 — 안 그러면 슛으로 놓는 순간 볼이 이미 골라인 위에 있어서
        // 슛이 날아가기도 전에 골로 잡히는 버그가 난다(실제로 겪었다).
        const goalLimit = HALF.L - PARAMS.dribbleCarryOffset - 0.5;
        p.x = p.attackDirection > 0 ? Math.min(p.x, goalLimit) : Math.max(p.x, -goalLimit);
      }
      if (sp > 0.5) p.heading = Math.atan2(p.vx, p.vz);
      if (p.kc > 0) p.kc--;
      p.distanceRun += sp * dt; // 실제로 뛴 거리(m) 누적 — 감독이 압박 강도의 대가를 눈으로 확인할 지표

      // 부상 — 지치고 전력질주할수록 확률이 올라간다. 이번 틱에 다치면 볼 스냅·체력 소모 없이
      // 바로 빠진다(캐리어였다면 볼도 놓는다).
      const injuryChance =
        PARAMS.injuryBaseChance * (1 + (1 - p.energy) * PARAMS.injuryFatigueCoef) * clamp(sp / p.maxSpeed, 0, 1);
      const injuryRoll = seededRandom(this.tick, seededRandomPlayerId(p.team, p.idx), ACTION_ID.INJURY_CHECK);
      if (injuryRoll < injuryChance) {
        this.injurePlayer(p);
        continue;
      }

      if (isCarrier) {
        // 볼을 발밑 앞쪽에 붙여둔다 — 따로 물리 갱신하지 않고 매 틱 캐리어 위치로 스냅한다.
        // 여기도 라인 바로 앞(-0.5m 여유)까지만 허용해 위 클램프와 이중으로 막는다.
        //
        // z에 여유가 없던 게 오래된 버그였다. 아웃 판정이 `|z| >= HALF.W`(경계 포함)인데
        // 클램프 상한이 딱 HALF.W라, 터치라인 근처의 캐리어가 바깥을 보기만 하면 볼이 정확히
        // 라인 위로 박혀 그 틱에 아웃으로 잡혔다. 그러면 스로인 → 상대 선수가 그 자리로
        // 순간이동해 캐리어가 됨 → 다음 틱에 또 아웃 …이 반복된다.
        // 실측: 스로인의 **99%가 직전 스로인 1틱 뒤**에 났고(24경기 263회, 간격 중앙값 1틱),
        // 그래서 경기당 11회라는 숫자 자체가 사실은 두세 번의 무한 왕복이었다.
        // x축은 원래부터 0.5m 여유가 있어 골라인에서는 이 현상이 없었다 — 그냥 z만 빠져 있었다.
        this.ball.x = clamp(p.x + Math.sin(p.heading) * PARAMS.dribbleCarryOffset, -HALF.L + 0.5, HALF.L - 0.5);
        this.ball.z = clamp(p.z + Math.cos(p.heading) * PARAMS.dribbleCarryOffset, -HALF.W + 0.5, HALF.W - 0.5);
        this.ball.vx = p.vx;
        this.ball.vz = p.vz;
        // 발밑에 붙은 볼은 항상 땅에 있다 — 공중볼을 잡은 직후에도 높이를 여기서 확실히 죽인다.
        this.ball.y = PARAMS.ballRadius;
        this.ball.vy = 0;
      }

      const drain = (sp / PARAMS.maxSpeed) * (PARAMS.pressDrainBase + (press - 0.5) * PARAMS.pressDrainSpread) * (110 - p.stamina) / 100;
      p.energy = clamp(p.energy - drain * dt * PARAMS.energyDrainCoef, PARAMS.energyMin, 1);
    }

    for (const p of this.all) this.tryKick(p);
    // 드리블 중엔 이미 위(캐리어 처리)에서 매 틱 위치를 붙여놨다 — 마찰/관성 물리를 또 적용하면 안 된다.
    if (!this.ball.carrierKey) {
      this.ball.update(dt);
      // 골은 슛(킥)으로만 넣는다 — 드리블로 공을 몰고 골라인을 그냥 지나가는 건 골이 아니다.
      // 캐리어가 있는 동안은 골 판정을 아예 안 한다(위 carrierDecide의 골문 근처 슛 강제와 짝).
      // 골이 아니면(빗나간 슛/걷어낸 공 등) 필드 밖으로 나갔는지도 같이 본다 — 골 판정이
      // 이미 kickoff()로 볼을 리셋했다면 아웃오브바운즈 판정은 의미가 없어 건너뛴다.
      if (!this.checkGoal()) this.checkOutOfBounds();
    } else {
      // 캐리어가 드리블 중에 터치라인/골라인 밖으로 그대로 뛰쳐나가는 경우 — 골은 슛으로만
      // 나므로 checkGoal()은 여전히 안 부르지만, 아웃오브바운즈는 "볼이 캐리어 상태냐"와
      // 무관하게 실제로 선을 넘으면 즉시 잡아야 한다. 이걸 안 하면 킥으로 공을 놓을 때까지는
      // 절대 아웃 판정이 안 나서, 드리블로 계속 터치라인 밖까지 몰고 가도 경기가 안 멈추고
      // 그대로 진행되는 버그가 났다(실전에서 확인).
      this.checkOutOfBounds();
    }
    this.updateStats();
    this.tick++;
    this.updatePhase();
  }

  /**
   * 골키퍼가 이번 스텝에 서 있고 싶은 자리.
   * 기본은 골문 앞 2m에서 볼의 z를 반만 따라가는 예전 동작 그대로다. 볼이 떠서 우리 페널티
   * 에어리어로 떨어지는 중이면(크로스·롱볼·클리어) 낙하 지점까지 마중 나간다 — 다만 골라인에서
   * gkComeOutRange 밖으로는 절대 안 나간다. 나갔다가 골문이 비면 그게 더 큰 실점이다.
   */
  /**
   * 경로 지시를 받은 선수가 지금은 지시를 잠시 미루고 축구를 해야 하는가.
   *
   * 경로 지시는 "여기로 가라"는 위치 지시이지 "볼을 무시하라"는 뜻이 아니다. 예전에는
   * 스티어링 분기에서 p.command가 맨 앞에 있어서, 지시받은 선수가 목적지에 닿을 때까지
   * 바로 옆으로 지나가는 볼도 안 쫓았다.
   *
   * 지시를 취소하지는 않는다 — 볼 상황이 지나가면 하던 경로를 이어서 간다. 어차피
   * setCommand()가 도착 지점을 새 기준 위치(homeOffset)로 잡아 두므로, 중간에 끊겨도
   * 결국 감독이 찍은 자리로 수렴한다.
   *
   * @returns {boolean} true면 이번 틱은 일반 AI(추격·드리블·대형)에 맡긴다
   */
  commandYieldsToBall(p, isCarrier) {
    if (isCarrier) return true; // 발밑에 볼이 있는데 경로만 따라 걷는 건 말이 안 된다
    return vlen(this.ball.x - p.x, this.ball.z - p.z) <= PARAMS.commandBallReactRadius;
  }

  goalkeeperTarget(gk) {
    const b = this.ball;
    let gx = -gk.attackDirection * (HALF.L - 2);
    let gz = clamp(b.z * 0.5, -GOAL_W / 2, GOAL_W / 2);
    if (b.airborne) {
      const land = b.predictLanding();
      const ownGoalX = -gk.attackDirection * HALF.L;
      const landsInOwnBox =
        Math.abs(land.x - ownGoalX) <= PENALTY_AREA.depth && Math.abs(land.z) <= PENALTY_AREA.halfWidth;
      if (landsInOwnBox) {
        const outLimit = -gk.attackDirection * (HALF.L - PARAMS.gkComeOutRange);
        gx = gk.attackDirection > 0 ? Math.min(land.x, outLimit) : Math.max(land.x, outLimit);
        gz = clamp(land.z, -PENALTY_AREA.halfWidth, PENALTY_AREA.halfWidth);
      }
    }
    return [gx, gz];
  }

  /** p를 압박 중인 가장 가까운 상대와의 거리를 오차 배수로 바꾼다. 상대가 없거나 멀면 1(가산 없음). */
  pressureFactor(p) {
    const opps = p.team === 'home' ? this.awayP : this.homeP;
    let nearest = Infinity;
    for (const o of opps) {
      const d = vlen(o.x - p.x, o.z - p.z);
      if (d < nearest) nearest = d;
    }
    return clamp(1 + (PARAMS.pressureRadius - nearest) / PARAMS.pressureRadius, 1, PARAMS.pressureMax);
  }

  /**
   * 실수를 성공/실패 판정이 아니라 "방향 오차(도)"로 만든다.
   * 오차 = 기본값 × (스탯 낮을수록↑) × (압박받을수록↑) × (체력 없을수록↑) × (거리 멀수록↑).
   * 삼각분포(두 난수의 합)로 뽑아서 작은 오차는 흔하고 큰 오차는 드물게 나오게 한다 —
   * 그래서 2도 정도는 그냥 정상 패스로, 8도는 삑사리로, 20도는 터치라인 아웃으로 저절로 이어진다.
   */
  errorDegrees(p, { statValue, distance, baseDeg }) {
    const statFactor = clamp((100 - statValue) / 50, 0.2, 1.6);
    const staminaFactor = clamp(1 + (0.75 - p.energy) * 2, 1, PARAMS.staminaErrorMax);
    const distanceFactor = clamp(distance / PARAMS.distanceErrorRef, 0.5, 2.5);
    const magnitude = Math.min(
      baseDeg * statFactor * this.pressureFactor(p) * staminaFactor * distanceFactor,
      PARAMS.maxErrorDeg
    );
    return (this.rng.next() + this.rng.next() - 1) * magnitude;
  }

  /** (dx, dz)를 deg도만큼 돌린다 — 오차각을 실제 킥 방향에 반영할 때 쓴다. */
  rotateXZ(dx, dz, deg) {
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [dx * c - dz * s, dx * s + dz * c];
  }

  /**
   * 수비(defender) vs 공격(attacker) 다툼의 승패만 판정한다(부수효과 없음).
   * §6.7: 탈취확률 = (수비력×체력승수)/(수비력+드리블력) × (1+압박강도/200) × 거리감쇠
   * - 압박강도: defender의 압박 지시(0..1, effectivePressing)를 다른 항(수비력/드리블력,
   *   0..100 스탯 스케일)과 맞추려고 ×tacklePressingScale(100)로 정규화한다 — 단위를
   *   안 맞추면 이 항이 사실상 무시되거나(0..1 그대로면 /200이 거의 1) 반대로 스탯 항을
   *   압도해버린다.
   * - 거리감쇠: 실제 몸싸움 거리(둘 사이 실측 거리, kickDist 기준)가 멀수록 승률을 깎는다.
   * - 확률 판정은 이번 리팩터링에서 지정한 seededRandom(tick, playerId, actionId) —
   *   defender가 태클을 "시도하는" 쪽이라 defender를 playerId로 쓴다.
   */
  resolveTackle(defender, attacker, actionId = ACTION_ID.TACKLE_LOOSE_BALL) {
    const staminaMult = 0.55 + 0.45 * defender.energy;
    const def = defender.defenseSkill * staminaMult;
    // 스탯 비교를 지수로 날카롭게 만든다.
    //
    // 문제는 압박 보너스(중립에서도 3.5배)가 승률을 상한(tackleWinMax)까지 밀어 올려서,
    // 스탯 차이가 상한에 눌려 사라지는 것이었다 — 4000회 실측으로 강수비(90 vs 30) 84.9%,
    // 약수비(20 vs 90) 51.4%. 70이나 벌어진 스탯인데 격차가 33%p뿐이었다.
    //
    // 해결로 두 가지를 먼저 시도했다가 되돌렸다.
    //   · 압박 계수를 낮춤(divisor 100) → 스탯은 갈리지만 태클이 약해져 드리블 편중이
    //     재발했다(검증기: 폭 0에서 드리블 시간 37.2%, 단독 드리블 70.8m).
    //   · 압박을 수비 능력치 쪽에 곱함 → 태클이 전반적으로 약해져 같은 재발.
    // 둘 다 "태클을 약하게 만들어" 스탯을 살리려 한 게 원인이었다.
    //
    // 지수를 쓰면 강한 수비는 여전히 상한까지 가고(드리블 편중이 안 생기고), 약한 수비만
    // 아래로 크게 내려간다 — 태클 총량을 안 줄이고 스탯만 갈라 낸다.
    const k = PARAMS.tackleSkillExponent;
    const dp = Math.pow(def, k);
    const ap = Math.pow(attacker.dribbleSkill, k);
    const base = dp / (dp + ap);
    const pressingPct = effectivePressing(this, defender) * PARAMS.tacklePressingScale;
    const pressureBonus = 1 + pressingPct / PARAMS.tacklePressingDivisor;
    const dist = vlen(defender.x - attacker.x, defender.z - attacker.z);
    const distanceDecay = clamp(1 - dist / PARAMS.kickDist, PARAMS.tackleDistanceDecayMin, 1);
    const winProb = clamp(base * pressureBonus * distanceDecay, PARAMS.tackleWinMin, PARAMS.tackleWinMax);
    const roll = seededRandom(this.tick, seededRandomPlayerId(defender.team, defender.idx), actionId);
    return roll < winProb;
  }

  /** 태클 성공 시 수비가 그 자리에서 걷어낸다 — 클리어링도 킥이라 같은 오차 모델을 그대로 쓴다. */
  clearBall(defender) {
    const cdx = defender.atkX - defender.x;
    const cdz = 0 - defender.z;
    const errDeg = this.errorDegrees(defender, {
      statValue: defender.passSkill,
      distance: PARAMS.distanceErrorRef,
      baseDeg: PARAMS.passBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(cdx, cdz, errDeg);
    // 걷어내기는 높이 띄운다 — 태클로 빼앗은 볼을 땅으로 굴리면 압박 안에서 바로 다시 뺏긴다.
    this.ball.kick(edx, edz, PARAMS.clearForce, `${defender.team}:${defender.idx}`, PARAMS.clearLoftDeg); // kick()이 carrierKey도 같이 지운다
    // 볼을 되찾은 쪽에 소유를 넘긴다. 원래 이 대입이 kick() **앞**에 있었는데 kick()이
    // ownerKey를 null로 덮어써서 아무 효과가 없었다 — 즉 태클로 볼을 뺏어도 "누가 갖고
    // 있는가"가 상대 팀에 그대로 남았다. 압박의 가장 직접적인 성과가 통째로 기록되지 않던
    // 자리다(볼에 소유자가 없는 시간이 경기의 82~85%라 영향이 크다).
    this.ball.ownerKey = `${defender.team}:${defender.idx}`;
    this.pushEvent('tackle', defender.team, `${defender.name} 볼 탈취`);
  }

  /**
   * 태클 시도의 세 갈래 결과 — 'win'(탈취) | 'lose'(공격 유지, 파울 아님) | 'foul'(반칙).
   * 태클에서 진 경우에만 파울 여부를 추가로 굴린다 — 이긴 태클은 몸싸움에서 이긴 것이라
   * 파울일 수 없다. 파울이면 이 안에서 카드·재개까지 전부 끝낸다.
   */
  attemptTackle(defender, attacker, actionId = ACTION_ID.TACKLE_LOOSE_BALL) {
    if (this.resolveTackle(defender, attacker, actionId)) return 'win';
    const foulChance = this.foulChance(defender);
    const roll = seededRandom(this.tick, seededRandomPlayerId(defender.team, defender.idx), ACTION_ID.FOUL_CHECK);
    if (roll < foulChance) {
      this.commitFoul(defender, attacker);
      return 'foul';
    }
    return 'lose';
  }

  /** 파울 확률 — 압박이 셀수록 거칠어지고, 수비력이 높을수록 깔끔하게 걸러 낸다. */
  foulChance(defender) {
    const press = effectivePressing(this, defender);
    const raw =
      PARAMS.foulBaseChance + press * PARAMS.foulPressingCoef - (defender.defenseSkill / 100) * PARAMS.foulSkillCoef;
    return clamp(raw, PARAMS.foulChanceMin, PARAMS.foulChanceMax);
  }

  /**
   * 반칙 지점이 **반칙한 쪽 자기 페널티 에어리어** 안인가. 여기가 페널티킥과 프리킥을 가른다.
   * 공격 방향(attackDirection)이 아니라 수비하는 골문 기준으로 재야 한다 — 공격 진영
   * 페널티 에어리어(상대 골문 앞)에서 수비수가 반칙한 게 아니면 PK가 아니다.
   *
   * 위치를 선수 객체가 아니라 좌표로 받는다. 카드 판정이 퇴장으로 이어지면 sendOff()가
   * 그 선수를 경기장 밖으로 치워 버리므로, 반칙 지점은 **카드를 굴리기 전에** 따로
   * 떠 놓아야 한다(아래 commitFoul 참고).
   */
  foulInOwnBox(defender, spotX, spotZ) {
    const ownGoalX = -defender.attackDirection * HALF.L;
    return Math.abs(spotX - ownGoalX) <= PENALTY_AREA.depth && Math.abs(spotZ) <= PENALTY_AREA.halfWidth;
  }

  /** 파울 확정 — 카드 여부를 굴리고, 반칙 위치에 따라 프리킥과 페널티킥으로 갈린다. */
  commitFoul(defender, attacker) {
    this.pushEvent('foul', defender.team, `${defender.name} 파울`);
    // 반칙 지점을 카드 판정보다 **먼저** 떠 둔다. sendOff()는 퇴장 선수를 터치라인 밖
    // (z = HALF.W + 8)으로 옮기는데, 그 뒤에 defender.x/z를 읽으면 반칙 자리가 사라진다 —
    // 박스 안 반칙이 퇴장을 동반하면 페널티킥이 프리킥으로 바뀌고, 그 프리킥마저 실제
    // 반칙 자리가 아니라 터치라인에서 차는 버그가 났다.
    const foulX = defender.x;
    const foulZ = defender.z;
    const roll = seededRandom(this.tick, seededRandomPlayerId(defender.team, defender.idx), ACTION_ID.CARD_CHECK);
    if (roll < PARAMS.straightRedChance) {
      this.sendOff(defender, '거친 파울');
    } else if (roll < PARAMS.straightRedChance + PARAMS.yellowCardChance) {
      this.applyCard(defender);
    }
    if (this.foulInOwnBox(defender, foulX, foulZ)) {
      // 페널티킥은 반칙 자리가 아니라 언제나 페널티 스폿에서 찬다.
      const spotX = attacker.attackDirection * (HALF.L - PARAMS.penaltySpotDepth);
      this.restart(attacker.team, spotX, 0, 'penalty', `${defender.name} 반칙 · 페널티킥`);
      return;
    }
    this.restart(attacker.team, foulX, foulZ, 'free-kick', `${defender.name} 파울 · 프리킥`);
  }

  /** 경고 — 두 번째 경고는 그 자리에서 퇴장(2차 경고 퇴장)으로 이어진다. */
  applyCard(p) {
    p.yellowCards++;
    if (p.yellowCards >= 2) {
      this.sendOff(p, '경고 누적');
    } else {
      this.pushEvent('yellow-card', p.team, `${p.name} 경고`);
    }
  }

  /** 퇴장 — 경기장 밖으로 완전히 빼서(터치라인 밖 고정 좌표) 다시는 판단·이동에 끼지 않게 한다. */
  sendOff(p, reason) {
    p.sentOff = true;
    p.x = p.home.x;
    p.z = HALF.W + 8;
    p.vx = 0;
    p.vz = 0;
    this.pushEvent('red-card', p.team, `${p.name} 퇴장 (${reason})`);
  }

  /**
   * 부상 — 퇴장과 같은 방식으로 경기장 밖에 고정하지만, sentOff와 달리 substitute()로
   * 그 자리를 채울 수 있다. 캐리어가 다치면 볼도 즉시 놓아야 다음 틱에 아무도 못 다루는
   * "유령 캐리어" 상태가 안 생긴다.
   */
  injurePlayer(p) {
    p.injured = true;
    p.x = p.home.x;
    p.z = HALF.W + 8;
    p.vx = 0;
    p.vz = 0;
    const key = `${p.team}:${p.idx}`;
    if (this.ball.carrierKey === key) this.ball.carrierKey = null;
    if (this.ball.ownerKey === key) this.ball.ownerKey = null;
    this.pushEvent('injury', p.team, `${p.name} 부상`);
  }

  /** 캐리어를 드리블 중에 노리는 상대. 사거리 안에 실제로 붙어야 다툰다. */
  tryTackleCarrier(defender) {
    const carrier = this.playerByKey(this.ball.carrierKey);
    if (!carrier) return;
    // 자기 페널티 에어리어 안에서 볼을 잡고 있는 골키퍼에게는 도전할 수 없다 —
    // 손에 든 공을 발로 뺏는 장면이 나오면 안 된다.
    if (carrier.role === 'GK') {
      const ownGoalX = -carrier.attackDirection * HALF.L;
      if (Math.abs(carrier.x - ownGoalX) <= PENALTY_AREA.depth && Math.abs(carrier.z) <= PENALTY_AREA.halfWidth) {
        return;
      }
    }
    if (vlen(defender.x - carrier.x, defender.z - carrier.z) > PARAMS.kickDist) return;
    defender.kc = PARAMS.kickCooldownTicks;
    // 캐리어의 kc(재판단 주기)는 여기서 건드리지 않는다 — 건드리면 수비가 계속 붙어서
    // (수비 쿨다운 8틱 < 캐리어 판단주기 24틱) 매번 재시도할 때마다 캐리어 재판단이 밀려서,
    // 이기든 지든 캐리어가 영원히 패스/슛을 못 하고 드리블만 하게 되는 버그가 났었다.
    // (이 버그는 test_carrier_kc_regression.mjs로 명시적으로 재현·재확인한다.)
    const result = this.attemptTackle(defender, carrier, ACTION_ID.TACKLE_CARRIER);
    if (result === 'win') this.clearBall(defender);
  }

  /**
   * 캐리어가 판단 주기(dribbleDecisionTicks)마다 무엇을 할지 정한다.
   * 판단(어떤 행동을 고를지 — chooseAction, 확률 없음)과 실행(고른 행동이 성공하는지 —
   * execute*, 확률 판정 1회)을 분리한다. 새 행동은 decision.js의 후보 목록에 추가하고
   * 여기 execute* 하나만 늘리면 되고, 기존 execute*는 서로 건드리지 않는다 — 이게
   * "새 행동을 추가하면 기존 행동이 안 나오는" 폭포수 if-else 버그의 재발 방지책이다.
   */
  carrierDecide(p) {
    const action = chooseAction(this, p);
    switch (action.type) {
      case 'pass':
        return this.executePass(p, action);
      case 'cross':
        return this.executeCross(p, action);
      case 'shoot':
        return this.executeShoot(p, action);
      case 'dribble':
        return this.executeDribble(p);
      case 'hold':
        return this.executeHold(p);
      case 'clear':
        return this.executeClear(p);
      default:
        return this.executeDribble(p); // 이론상 도달하지 않는다 — hold가 항상 후보라 chooseAction은 null을 안 낸다
    }
  }

  /**
   * 팀 템포가 판단 주기를 바꾼다. 빠른 팀은 볼을 빨리 놓고(주기 짧게), 점유 팀은 오래 들고 있다.
   * 템포 0.5에서 정확히 dribbleDecisionTicks라서 전술을 안 만진 경기는 예전 그대로 흐른다.
   */
  decisionTicksFor(p) {
    const tempo = teamTacticsOf(this, p).tempo;
    const scale = 1 + PARAMS.tempoDecisionScale / 2 - tempo * PARAMS.tempoDecisionScale;
    return Math.max(6, Math.round(PARAMS.dribbleDecisionTicks * scale));
  }

  /** 패스 실행 — 성공확률(§6.7)을 seededRandom으로 한 번만 굴린다. 실패해도 소멸 대신 큰 오차로 표현. */
  executePass(p, action) {
    const target = action.target;
    if (isOffside(this, p, target)) {
      this.offsideRestart(p.team, target);
      return;
    }
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const roll = seededRandom(this.tick, seededRandomPlayerId(p.team, p.idx), ACTION_ID.PASS_SUCCESS);
    const succeeded = roll < action.meta.successProb;
    const baseDeg = succeeded ? PARAMS.passBaseErrorDeg : PARAMS.passBaseErrorDeg * PARAMS.passFailErrorMultiplier;
    const errDeg = this.errorDegrees(p, { statValue: p.passSkill, distance: action.meta.distance, baseDeg });
    const [edx, edz] = this.rotateXZ(dx, dz, errDeg);
    // 직선적인 팀은 패스를 더 세게 찬다 — 빨리 도착하는 대신 받기 어렵고 흐르기도 쉽다.
    const tempo = teamTacticsOf(this, p).tempo;
    const force = PARAMS.passForce * (1 - PARAMS.tempoPassForceScale / 2 + tempo * PARAMS.tempoPassForceScale);
    // 짧은 패스는 땅볼, 긴 패스는 띄워 보낸다 — 롱볼이 수비 사이를 굴러 지나가지 않고
    // 넘어가야 "긴 패스"가 짧은 패스와 다른 선택이 된다.
    const loft = action.meta.distance > PARAMS.longPassDistance ? PARAMS.longPassLoftDeg : PARAMS.passLoftDeg;
    this.ball.kick(edx, edz, force, `${p.team}:${p.idx}`, loft);
    // 찬 직후에도 kc가 0으로 남아 있으면, 공이 발밑에서 채 1틱도 안 떨어진 사이에 본인이
    // 다시 "가장 가까운 선수"로 잡혀서 즉시 자기 패스를 자기가 재줍는 버그가 났다(실전에서
    // 확인함 — 패스가 나간 것처럼 보이지만 실제로는 계속 같은 선수가 캐리어로 남아 있었다).
    // 다른 킥/태클 경로는 전부 kc를 세팅하는데 여기만 빠져 있었다.
    p.kc = PARAMS.kickCooldownTicks;
  }

  /** 크로스 실행 — executePass와 같은 골격이지만 항상 크게 띄우고(crossLoftDeg) 오차가 더 크다. */
  executeCross(p, action) {
    const target = action.target;
    if (isOffside(this, p, target)) {
      this.offsideRestart(p.team, target);
      return;
    }
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const roll = seededRandom(this.tick, seededRandomPlayerId(p.team, p.idx), ACTION_ID.CROSS_SUCCESS);
    const succeeded = roll < action.meta.successProb;
    const baseDeg = succeeded ? PARAMS.crossBaseErrorDeg : PARAMS.crossBaseErrorDeg * PARAMS.passFailErrorMultiplier;
    const errDeg = this.errorDegrees(p, { statValue: p.passSkill, distance: action.meta.distance, baseDeg });
    const [edx, edz] = this.rotateXZ(dx, dz, errDeg);
    this.ball.kick(edx, edz, PARAMS.passForce, `${p.team}:${p.idx}`, PARAMS.crossLoftDeg);
    p.kc = PARAMS.kickCooldownTicks;
    this.pushEvent('cross', p.team, `${p.name} 크로스`);
  }

  /** 슛 실행 — 마찬가지로 성공확률을 한 번만 굴려서 오차 폭을 정한다. */
  executeShoot(p, action) {
    const gdx = p.atkX - p.x;
    const gdz = 0 - p.z;
    const roll = seededRandom(this.tick, seededRandomPlayerId(p.team, p.idx), ACTION_ID.SHOOT_SUCCESS);
    const succeeded = roll < action.meta.successProb;
    const baseDeg = succeeded ? PARAMS.shotBaseErrorDeg : PARAMS.shotBaseErrorDeg * PARAMS.shotFailErrorMultiplier;
    const errDeg = this.errorDegrees(p, { statValue: p.shootSkill, distance: action.meta.distance, baseDeg });
    const [edx, edz] = this.rotateXZ(gdx, gdz, errDeg);
    // 오차는 좌우로만이 아니라 위아래로도 난다 — 같은 오차각을 상하로도 나눠 써서, 크게
    // 빗나간 슛은 옆으로 흐르는 대신 크로스바를 넘어간다(errDeg가 음수면 낮게 깔린 슛).
    const loft = Math.max(0, PARAMS.shootLoftDeg + errDeg * PARAMS.shotVerticalErrorScale);
    this.ball.kick(edx, edz, PARAMS.shootForce, `${p.team}:${p.idx}`, loft);
    this.ball.shotBy = `${p.team}:${p.idx}`; // GK가 이 볼을 잡으면 tryKick()에서 "선방"으로 기록한다
    p.kc = PARAMS.kickCooldownTicks; // 패스와 같은 이유 — 슛한 직후 본인이 바로 재줍는 걸 막는다
    this.recordShotAttempt(p);
    this.pushEvent('shot', p.team, `${p.name} 슈팅`);
  }

  /** 드리블 유지 — "계속 갈지"는 이미 판단(점수 비교)에서 끝났다. 확률 판정 없음. */
  executeDribble(p) {
    p.dribbleMode = 'advance';
    p.kc = this.decisionTicksFor(p);
  }

  /** 키핑 — 다음 판단 주기까지 제자리에서 볼을 지킨다. 확률 판정 없음. */
  executeHold(p) {
    p.dribbleMode = 'hold';
    p.kc = this.decisionTicksFor(p);
  }

  /** 클리어 — 압박에 밀린 캐리어가 무조건 앞으로 걷어낸다. 클리어링이라 오차를 크게 잡는다. */
  executeClear(p) {
    const cdx = p.atkX - p.x;
    const cdz = 0 - p.z;
    const errDeg = this.errorDegrees(p, { statValue: p.passSkill, distance: PARAMS.distanceErrorRef, baseDeg: PARAMS.clearBaseErrorDeg });
    const [edx, edz] = this.rotateXZ(cdx, cdz, errDeg);
    this.ball.kick(edx, edz, PARAMS.clearForce, `${p.team}:${p.idx}`, PARAMS.clearLoftDeg);
    p.kc = PARAMS.kickCooldownTicks; // 마찬가지로 자기 클리어를 자기가 바로 재줍는 걸 막는다
    this.pushEvent('tackle', p.team, `${p.name} 압박에 클리어`);
  }

  /**
   * 헤딩 — 발이 안 닿는 높이의 볼을 머리로 쳐낸다. 컨트롤이 아니라 "쳐내기"라서 캐리어가
   * 되지 않고, 방향 오차도 발보다 훨씬 크다. 항상 자기 공격 방향으로 보내므로 수비의
   * 걷어내기와 공격의 문전 헤딩이 같은 코드에서 자연스럽게 갈린다(골문 앞에서 때리면
   * 그대로 골문으로 간다).
   *
   * 각도만은 그 둘을 갈라 준다. 골문 근처(headerShotRange)면 아래로 찍고, 그 밖이면 높이
   * 걷어낸다 — 어느 쪽이든 볼이 머리 높이대(footControlHeight~headControlHeight)를 곧바로
   * 벗어난다는 게 핵심이다. 예전처럼 한 각도(9도)로만 때리면 헤딩한 볼이 그 높이대에
   * 그대로 머물러서, 주위 선수들이 킥 쿨다운 8틱마다 번갈아 다시 헤딩한다(params.js의
   * headerClearLoftDeg 주석에 실측을 적어 뒀다).
   */
  executeHeader(p) {
    const hdx = p.atkX - p.x;
    const hdz = 0 - p.z;
    const errDeg = this.errorDegrees(p, {
      statValue: p.shootSkill,
      distance: PARAMS.distanceErrorRef,
      baseDeg: PARAMS.headerBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(hdx, hdz, errDeg);
    const shooting = vlen(hdx, hdz) <= PARAMS.headerShotRange;
    const loft = shooting ? PARAMS.headerShotLoftDeg : PARAMS.headerClearLoftDeg;
    const key = `${p.team}:${p.idx}`;
    this.ball.kick(edx, edz, PARAMS.headerForce, key, loft);
    if (shooting) {
      // 문전 헤딩은 실제 축구에서도 슈팅으로 집계된다. 이걸 안 세면 헤딩 골이 유효슈팅에는
      // 잡히는데 슈팅에는 안 잡혀서 "유효슈팅 > 슈팅"이라는 말이 안 되는 숫자가 나온다
      // (실측으로 중립 전술에서 슈팅 2.7 · 유효 2.6, 폭 0에서 3.3 · 3.4로 역전됐다).
      this.recordShotAttempt(p);
      this.ball.shotBy = key; // 키퍼가 막으면 유효슈팅·선방으로 이어지게 한다
    }
    // 공중볼 경합은 혼자 하는 게 아니다 — 옆에 붙어 있던 선수들도 같이 뛰어올랐다가 같이
    // 내려온다. 그래서 헤딩한 사람뿐 아니라 사거리 안의 **전원**이 같은 쿨다운을 받는다.
    // 느슨한 볼 경합(tryKick)에서 이긴 쪽·진 쪽 모두 kc를 거는 것과 같은 이유다.
    //
    // 이게 없으면 각도를 갈라 놔도 연쇄가 남는다. 걷어내는 헤딩(26도)조차 머리 높이대를
    // 벗어나는 데 0.24초가 걸리는데 킥 쿨다운은 0.13초라, 그 사이에 옆 선수가 1.8m 날아간
    // 볼을 그대로 다시 헤딩한다 — 실측된 연쇄 간격이 정확히 8틱(=kickCooldownTicks)이었다.
    for (const o of this.all) {
      if (o.sentOff || o.injured) continue;
      if (vlen(o.x - this.ball.x, o.z - this.ball.z) <= PARAMS.kickDist) o.kc = PARAMS.kickCooldownTicks;
    }
    p.kc = PARAMS.kickCooldownTicks; // 헤딩한 본인은 사거리 밖으로 밀려나 있어도 반드시 건다
  }

  /**
   * 골키퍼의 볼 처리. 손을 쓰기 때문에 필드 플레이어의 발 사거리(kickDist)·발 높이
   * (footControlHeight)가 아니라 gkReachRadius·gkReachHeight를 쓰고, 대신 자기 페널티
   * 에어리어 안에서만 가능하다(밖에서는 이 경로를 안 타고 발로만 다룬다).
   *
   * 결과는 셋 중 하나다 — 잡거나(캐치), 손끝에 걸려 쳐내거나(펀칭), 완전히 지나치거나.
   * 세 번째가 반드시 있어야 골이 들어간다. 확률 한 번만 굴려서 세 구간으로 나눈다.
   *
   * @param {number} [ownGoalXOverride] 지킬 골문의 x. 승부차기는 규칙상 한쪽 골대에서만
   *   차므로, 그 기간의 공격 방향과 무관하게 실제로 서 있는 골문을 넘겨준다.
   * @returns {boolean} 이번 틱에 골키퍼가 볼을 실제로 건드렸는지
   */
  tryGoalkeeperClaim(gk, ownGoalXOverride) {
    if (gk.kc > 0) return false;
    const b = this.ball;
    if (b.carrierKey) return false; // 누가 발밑에 두고 있으면 그건 태클 문제다
    const ownGoalX = ownGoalXOverride ?? -gk.attackDirection * HALF.L;
    if (Math.abs(b.x - ownGoalX) > PENALTY_AREA.depth || Math.abs(b.z) > PENALTY_AREA.halfWidth) return false;
    if (b.y > PARAMS.gkReachHeight) return false;
    const dist = vlen(gk.x - b.x, gk.z - b.z);
    if (dist > PARAMS.gkReachRadius) return false;

    // 성공하든 실패하든 이번 접촉은 여기서 끝난다 — 쿨다운을 안 걸면 볼이 사거리를 지나는
    // 동안 매 틱 다시 굴려서, 아무리 확률이 낮아도 결국 한 번은 잡아 버린다.
    gk.kc = PARAMS.kickCooldownTicks;

    const speed = vlen(b.vx, b.vz);
    // 조건별 배수를 곱한다 — 각 항은 "이만큼 어려워진다"를 뜻하고, 어느 하나가 혼자
    // 확률을 0으로 끌어내리지 않는다(뺄셈이었을 때 속도 항 하나가 그렇게 만들었다).
    const handling = clamp(
      (gk.defenseSkill * staminaMult(gk.energy)) / PARAMS.gkHandlingRefStat,
      0.6,
      1.25
    );
    const speedFactor = 1 - clamp(speed / PARAMS.gkCatchSpeedRef, 0, 1) * PARAMS.gkCatchSpeedPenalty;
    const reachFactor = 1 - clamp(dist / PARAMS.gkReachRadius, 0, 1) * PARAMS.gkCatchReachPenalty;
    const heightFactor =
      1 -
      clamp(
        (b.y - PARAMS.footControlHeight) / Math.max(0.01, PARAMS.gkReachHeight - PARAMS.footControlHeight),
        0,
        1
      ) * PARAMS.gkCatchHeightPenalty;
    // 네 배수를 곱한 값이 곧 "이번 볼을 얼마나 제대로 다룰 수 있었나"다. 캐치 확률의 재료이자
    // 쳐냈을 때 방향을 얼마나 통제했는지(아래 control)의 재료이기도 하다 — 둘이 같은 값에서
    // 나와야 "간신히 손끝에 걸린 볼일수록 엉뚱한 데로 튄다"가 저절로 맞아떨어진다.
    const quality = handling * speedFactor * reachFactor * heightFactor;
    const catchProb = clamp(PARAMS.gkCatchBaseProb * quality, PARAMS.gkCatchMin, PARAMS.gkCatchMax);
    const parryProb = (1 - catchProb) * PARAMS.gkParryShare;
    const roll = seededRandom(this.tick, seededRandomPlayerId(gk.team, gk.idx), ACTION_ID.GK_CLAIM);
    const gkKey = `${gk.team}:${gk.idx}`;
    // 세게 날아온 볼을 막아냈을 때만 "선방"으로 남긴다 — 굴러온 볼까지 기록하면 이벤트 창이 도배된다.
    const worthLogging = speed >= PARAMS.gkSaveEventSpeed;
    // 골키퍼가 건드렸다는 건 볼이 골문으로 향하고 있었다는 뜻이다 — 유효슈팅으로 센다.
    // 기록 여부(worthLogging)와 무관하게 세야 느린 슛도 통계에 남는다.

    if (roll < catchProb) {
      // 캐치 — 손에 넣었다. 볼을 죽여 발밑에 붙이고 다음 판단(골킥/패스)까지 들고 있는다.
      b.vx = 0;
      b.vz = 0;
      b.vy = 0;
      b.y = PARAMS.ballRadius;
      b.ownerKey = gkKey;
      b.carrierKey = gkKey;
      b.lastTouchKey = gkKey;
      gk.kc = PARAMS.gkHoldTicks;
      if (worthLogging) this.pushEvent("save", gk.team, `${gk.name} 선방`);
      return true;
    }

    if (roll < catchProb + parryProb) {
      // 쳐내기 — 잡지는 못했지만 손끝에 걸렸다.
      //
      // 예전에는 방향이 언제나 (attackDirection, side), 즉 **전방 45도 대각선 하나뿐**이었다.
      // 그래서 어떤 강슛을 막아도 볼이 앞으로만 튀어 나갔고, 24경기에서 쳐낸 51번 중 96%가
      // 앞으로 갔다(옆 4%, 뒤 0%). 코너킥이 0.00회/경기였던 직접적인 원인이다.
      //
      // 이제 "얼마나 제대로 손을 댔나"(control)로 두 성분을 섞는다. 분기가 아니라 하나의 식이라
      // 임계점이 생기지 않는다.
      //   - 제대로 댄 몫(control)   : 키퍼가 의도한 방향 — 앞+옆으로 걷어낸다 (예전 동작)
      //   - 못 댄 몫(1-control)     : 들어오던 기세가 그대로 남아 골문 쪽으로 흐르고,
      //                              손에 스치며 옆으로 밀리고, 위로 뜬다
      // 느린 볼을 정면에서 받으면 control이 1에 가까워 예전과 똑같은 펀칭이 되고,
      // 강슛을 몸 던져 건드리면 control이 0에 가까워 볼이 옆/뒤로 빠진다 → 코너킥.
      const control = clamp(quality, 0, 1);
      const side = b.z >= 0 ? 1 : -1;

      // 키퍼가 의도한 몫. 단위벡터로 만들어 곱하므로 control=1이면 예전과 같은 세기(gkPunchForce)다.
      const intended = 1 / Math.SQRT2;
      // 걷어내는 방향은 "지키는 골문의 반대쪽". attackDirection을 그대로 쓰면 승부차기처럼
      // 공격 방향과 실제로 서 있는 골문이 어긋난 상황에서 자기 골문 안으로 쳐넣게 된다.
      const clearDir = ownGoalX >= 0 ? -1 : 1;
      const wx = clearDir * intended * PARAMS.gkPunchForce * control;
      const wz = side * intended * PARAMS.gkPunchForce * control;

      // 못 댄 몫. 골문 정면으로 온 볼일수록 옆으로 더 크게 밀어내야 포스트를 벗어난다 —
      // 실제로도 정면 강슛은 옆으로 쳐내는 것 말고는 방법이 없다. 이게 없으면 손끝에 걸린
      // 볼이 그대로 골문 안으로 흘러 들어가 "선방했는데 실점"이 잦아진다.
      const centrality = 1 - clamp(Math.abs(b.z) / (GOAL_W / 2), 0, 1);
      const leak = (1 - control) * PARAMS.gkParryLeak;
      const lx = b.vx * leak;
      const lz = b.vz * leak + side * speed * leak * PARAMS.gkParrySideBias * (1 + centrality);

      const errDeg = this.errorDegrees(gk, {
        statValue: gk.defenseSkill,
        distance: PARAMS.distanceErrorRef,
        baseDeg: PARAMS.gkPunchBaseErrorDeg,
      });
      const [edx, edz] = this.rotateXZ(wx + lx, wz + lz, errDeg);
      // 세기는 두 성분을 더한 크기를 그대로 쓴다. 최소값을 두는 건 두 성분이 서로 상쇄돼
      // 볼이 키퍼 발밑에 멈추는 걸 막기 위한 것이다(그러면 곧바로 다시 잡아 버린다).
      const force = Math.max(PARAMS.gkParryMinForce, vlen(wx + lx, wz + lz));
      // 손끝에 걸린 볼일수록 위로 뜬다 — 크로스바를 넘기면 그것도 코너킥이다.
      const loftDeg = PARAMS.gkPunchLoftDeg + (1 - control) * PARAMS.gkTipLoftBonus;
      b.kick(edx, edz, force, gkKey, loftDeg);
      if (worthLogging) this.pushEvent("save", gk.team, `${gk.name} 선방`);
      return true;
    }

    return false; // 못 막았다 — 볼은 그대로 흐른다(골이 될 수도 있다)
  }

  /**
   * 골킥 — 골문 앞에서 크게 띄워 전방으로 걷어찬다.
   * 힘과 각도가 고정이라 "얼마나 멀리 가는지"는 정해져 있고, 고르는 건 방향뿐이다.
   * 그래서 그 사거리쯤에 서 있는 동료 중 가장 열려 있는 쪽을 겨냥한다 — 아무도 없으면
   * 그냥 정면으로 걷어찬다(경합볼이 된다).
   */
  executeGoalKick(gk) {
    // 무항력 포물선 사거리 R = v²·sin(2θ)/g. 공기저항 때문에 실제로는 조금 못 미치므로
    // 상수 하나를 더 두는 대신 여기서 깎아 쓴다 — 힘·각도를 바꾸면 조준도 같이 따라온다.
    const rad = (PARAMS.goalKickLoftDeg * Math.PI) / 180;
    const range = ((PARAMS.goalKickForce ** 2 * Math.sin(2 * rad)) / PARAMS.gravity) * 0.8;

    const mates = gk.team === 'home' ? this.homeP : this.awayP;
    let target = null;
    let bestScore = -Infinity;
    for (const m of mates) {
      if (m === gk || m.role === 'GK') continue;
      if ((m.x - gk.x) * gk.attackDirection <= 0) continue; // 앞으로 차는 킥이다 — 뒤에 있는 동료는 후보가 아니다
      const d = vlen(m.x - gk.x, m.z - gk.z);
      // 사거리에 가까울수록, 상대와 떨어져 있을수록 좋다.
      const score =
        -Math.abs(d - range) / FIELD.L + clamp(nearestOpponentDistance(this, m) / PARAMS.openPassRadius, 0, 1);
      if (score > bestScore) {
        bestScore = score;
        target = m;
      }
    }

    const gdx = target ? target.x - gk.x : gk.attackDirection;
    const gdz = target ? target.z - gk.z : 0;
    const errDeg = this.errorDegrees(gk, {
      statValue: gk.passSkill,
      distance: PARAMS.distanceErrorRef,
      baseDeg: PARAMS.goalKickBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(gdx, gdz, errDeg);
    this.ball.kick(edx, edz, PARAMS.goalKickForce, `${gk.team}:${gk.idx}`, PARAMS.goalKickLoftDeg);
    gk.kc = PARAMS.kickCooldownTicks;
  }

  tryKick(p) {
    if (p.sentOff || p.injured) return;
    const pKey = `${p.team}:${p.idx}`;

    if (this.ball.carrierKey) {
      // 볼이 이미 누군가의 발밑에 있다 — 그 사람이면 계속 갈지/풀지 재판단하고,
      // 상대편이면(같은 편은 아무 것도 안 함) 사거리 안일 때만 태클을 시도한다.
      if (this.ball.carrierKey === pKey) {
        if (p.kc <= 0) {
          // 손에 넣은 볼을 가진 골키퍼는 패스/드리블을 저울질하지 않는다 — 그냥 배급한다.
          // 일반 판단에 맡기면 '키핑'이 계속 이겨서 키퍼가 볼을 안고 경기를 세워 버린다.
          if (p.role === 'GK') this.executeGoalKick(p);
          else this.carrierDecide(p);
        }
      } else if (p.team !== this.ball.carrierKey.split(':')[0] && p.kc <= 0) {
        this.tryTackleCarrier(p);
      }
      return;
    }

    // 골키퍼는 손을 쓴다 — 발보다 사거리가 넓고 크로스바 높이까지 닿는다. 자기 페널티
    // 에어리어 안에서만이고, 발로 처리하는 일반 경로보다 먼저 본다(자기 골문 앞 공중볼은
    // 키퍼가 우선권을 갖는다).
    if (p.role === 'GK' && this.tryGoalkeeperClaim(p)) return;

    // 볼이 자유 상태(아무도 안 갖고 있음) — 이 틱에 실제로 주울 수 있는 사람만 처리한다.
    if (p.kc > 0 || vlen(p.x - this.ball.x, p.z - this.ball.z) > PARAMS.kickDist) return;

    // 머리보다 높이 뜬 볼은 이번 틱에 아무도 다루지 못한다. 이 게이트가 없으면 머리 위로
    // 날아가는 공을 땅에서 그대로 낚아채서 로프트가 아무 의미도 갖지 못한다.
    if (this.ball.y > PARAMS.headControlHeight) return;

    // 이 틱에 실제로 볼을 다루는 건 볼에 가장 가까운 딱 한 명이다. p가 그 사람이 아니면(더
    // 가까운 다른 선수가 있으면) 아무 것도 하지 않는다 — this.all이 항상 홈을 먼저 훑기 때문에,
    // 이 체크가 없으면 볼 근처에 둘 다 있을 때 홈이 항상 먼저 "내가 다룬다"고 우겨버린다.
    let closer = null;
    let bd = vlen(p.x - this.ball.x, p.z - this.ball.z);
    for (const other of this.all) {
      if (other === p || other.kc > 0 || other.sentOff || other.injured) continue;
      const d = vlen(other.x - this.ball.x, other.z - this.ball.z);
      if (d < bd) {
        bd = d;
        closer = other;
      }
    }
    if (closer) return; // 더 가까운 선수의 차례에 처리된다

    // 발이 안 닿고 머리로만 닿는 높이 — 컨트롤(캐리어 등록)은 못 하고 헤딩으로 걷어내기만
    // 된다. 그래서 띄운 공은 발밑 공처럼 그 자리에서 소유로 이어지지 않는다.
    if (this.ball.y > PARAMS.footControlHeight) {
      this.executeHeader(p);
      return;
    }

    // 상대가 같은 순간 볼에 붙어 있으면 줍기 전에 다툼부터 — 이겨야 잡는다.
    const opps = p.team === 'home' ? this.awayP : this.homeP;
    let challenger = null;
    let cbd = PARAMS.kickDist;
    for (const o of opps) {
      if (o.kc > 0 || o.sentOff || o.injured) continue;
      const d = vlen(o.x - this.ball.x, o.z - this.ball.z);
      if (d <= cbd) {
        cbd = d;
        challenger = o;
      }
    }
    if (challenger) {
      p.kc = PARAMS.kickCooldownTicks;
      challenger.kc = PARAMS.kickCooldownTicks; // 승패 무관 — 이번 틱엔 둘 다 다시 못 다툰다
      const result = this.attemptTackle(challenger, p);
      if (result === 'win') {
        this.clearBall(challenger);
        return;
      }
      if (result === 'foul') return; // commitFoul()이 이미 재개까지 처리했다
      // 수비가 졌으면 공격이 그대로 잡는다 — 아래로 이어져 캐리어가 된다.
    }

    // 슛으로 날아가던 볼을 상대 골키퍼가 잡으면 선방이다 — 다른 사람이 잡거나(리바운드)
    // 자기 팀이 다시 잡으면(막힌 슛이 자기 발에 걸린 경우 등) 선방이 아니므로 조건을 좁힌다.
    if (this.ball.shotBy && this.ball.shotBy.split(':')[0] !== p.team && p.role === 'GK') {
      this.pushEvent('save', p.team, `${p.name} 선방!`);
    }
    this.ball.shotBy = null; // 누구든 잡으면(선방이든 리바운드든) 슛은 끝난 사건이다

    // 첫 터치 — 곧바로 패스/슛을 정하지 않고 일단 발밑에 붙인다(캐리어 등록). 실제 판단은
    // carrierDecide()가 판단 주기마다 한다 — 그래서 "잡자마자 반사적으로 패스"가 안 생긴다.
    this.ball.ownerKey = pKey;
    this.ball.carrierKey = pKey;
    // lastTouchKey도 여기서 갱신해야 한다 — 안 그러면 "킥 없이 주워서 그대로 드리블만 하다
    // 터치라인 밖으로 나간" 경우, 아웃오브바운즈 판정이 예전 킥의 lastTouchKey(심하면 상대
    // 팀 것)를 그대로 써서 스로인/코너킥/골킥을 엉뚱한 팀에게 줘버린다.
    this.ball.lastTouchKey = pKey;
    p.kc = this.decisionTicksFor(p);
  }

  /** @returns {boolean} 이번 틱에 골이 들어갔는지 — 아웃오브바운즈 판정을 건너뛸지 결정하는 데 쓴다. */
  checkGoal() {
    const b = this.ball;
    // 크로스바를 넘어간 볼은 골이 아니다. 여기서 false를 돌려주면 checkOutOfBounds()가
    // 이어받아 골킥으로 처리한다(마지막 터치가 공격 쪽이므로 규칙이 이미 맞다).
    if (b.y >= GOAL_H) return false;
    if (b.x <= -HALF.L && Math.abs(b.z) < GOAL_W / 2) {
      const scoringTeam = this.homeP[0]?.attackDirection === -1 ? 'home' : 'away';
      const concedingTeam = scoringTeam === 'home' ? 'away' : 'home';
      this.score[scoringTeam]++;
      // 슈팅으로 아직 안 센 골(크로스가 그대로 들어가거나 굴절된 경우)은 여기서 센다 —
      // 안 그러면 "유효슈팅 > 슈팅"이라는 말이 안 되는 숫자가 나온다.
      const countedShot = b.shotBy && b.shotBy.startsWith(scoringTeam);
      if (!countedShot) this.recordShot(scoringTeam);
      // 골은 정의상 유효슈팅이다. 다만 찰 때 이미 유효로 센 슛이면 두 번 세지 않는다.
      if (!countedShot || !b.onTargetCounted) this.recordShotOnTarget(scoringTeam);
      const scorer = this.playerByKey(b.lastTouchKey);
      this.pushEvent('goal', scoringTeam, scoringTeam === 'home' && scorer ? `${scorer.name} 득점` : scoringTeam === 'home' ? '득점' : '실점');
      this.kickoff({ kickoffTeam: concedingTeam });
      return true;
    } else if (b.x >= HALF.L && Math.abs(b.z) < GOAL_W / 2) {
      const scoringTeam = this.homeP[0]?.attackDirection === 1 ? 'home' : 'away';
      const concedingTeam = scoringTeam === 'home' ? 'away' : 'home';
      this.score[scoringTeam]++;
      // 슈팅으로 아직 안 센 골(크로스가 그대로 들어가거나 굴절된 경우)은 여기서 센다 —
      // 안 그러면 "유효슈팅 > 슈팅"이라는 말이 안 되는 숫자가 나온다.
      const countedShot = b.shotBy && b.shotBy.startsWith(scoringTeam);
      if (!countedShot) this.recordShot(scoringTeam);
      // 골은 정의상 유효슈팅이다. 다만 찰 때 이미 유효로 센 슛이면 두 번 세지 않는다.
      if (!countedShot || !b.onTargetCounted) this.recordShotOnTarget(scoringTeam);
      const scorer = this.playerByKey(b.lastTouchKey);
      this.pushEvent('goal', scoringTeam, scoringTeam === 'home' && scorer ? `${scorer.name} 득점` : scoringTeam === 'home' ? '득점' : '실점');
      this.kickoff({ kickoffTeam: concedingTeam });
      return true;
    }
    return false;
  }

  /**
   * 필드 밖으로 나간 볼을 처리한다 — 스로인(터치라인)/코너킥·골킥(골라인, 골은 아닌 쪽).
   * 마지막으로 볼을 건드린 팀(ball.lastTouchKey)으로 어느 팀에 주는지 정한다.
   */
  checkOutOfBounds() {
    const b = this.ball;
    const lastTeam = b.lastTouchKey ? b.lastTouchKey.split(':')[0] : null;

    if (Math.abs(b.z) >= HALF.W) {
      // 터치라인 아웃 — 마지막으로 안 건드린 팀이 스로인
      const throwInTeam = lastTeam === 'home' ? 'away' : 'home';
      const side = b.z > 0 ? 1 : -1;
      this.restart(throwInTeam, b.x, side * (HALF.W - PARAMS.restartInset), 'throw-in', '스로인');
      return true;
    }

    if (Math.abs(b.x) >= HALF.L) {
      const end = b.x > 0 ? 1 : -1;
      const defendingTeam = end === -(this.homeP[0]?.attackDirection ?? 1) ? 'home' : 'away';
      const attackingTeam = defendingTeam === 'home' ? 'away' : 'home';
      if (lastTeam === defendingTeam) {
        // 수비 쪽이 마지막으로 건드리고 나갔다 — 공격 팀 코너킥
        const cornerZ = (b.z > 0 ? 1 : -1) * (HALF.W - PARAMS.restartInset);
        const cornerX = end * (HALF.L - PARAMS.restartInset);
        this.restart(attackingTeam, cornerX, cornerZ, 'corner', '코너킥');
      } else {
        // 공격 쪽이 마지막으로 건드리고 나갔다(빗나간 슛 등) — 수비 팀 골킥
        const goalKickX = end * (HALF.L - PARAMS.goalKickDepth);
        this.restart(defendingTeam, goalKickX, 0, 'goal-kick', '골킥');
      }
      return true;
    }
    return false;
  }

  /**
   * 스로인/코너킥/골킥 공통 재개 처리 — 볼을 정지시켜 지정 위치에 놓고, 그 팀에서 가장
   * 가까운 선수(골킥은 골키퍼 우선)를 새 캐리어로 세운다. 이후 판단은 기존 carrierDecide
   * 파이프라인이 그대로 처리하므로 재개 전용 킥 로직을 따로 만들지 않는다.
   */
  restart(team, x, z, type, text) {
    this.ball.reset();
    this.ball.x = clamp(x, -HALF.L, HALF.L);
    this.ball.z = clamp(z, -HALF.W, HALF.W);
    // 재개가 주어졌다는 사실을 **실행보다 먼저** 기록한다. 페널티킥·프리킥은 실행이 곧바로
    // 슛까지 하면서 자기 이벤트를 남기므로, 나중에 기록하면 행동로그가
    // "슛 → 페널티킥 부여" 순으로 뒤집혀 읽힌다.
    this.pushEvent(type, team, text);
    const side = team === 'home' ? this.homeP : this.awayP;
    const taker = this.restartTaker(type, side);
    if (taker) {
      taker.x = this.ball.x;
      taker.z = this.ball.z;
      // 재개 종류마다 실제로 하는 동작이 다르다 — 골킥은 길게 걷어차고, 코너킥은 문전으로
      // 올리고, 스로인은 손으로 던진다. 전용 실행이 없는 종류(오프사이드)만
      // 예전처럼 발밑에 붙여 두고 일반 판단 파이프라인에 넘긴다.
      const execute = RESTART_EXECUTORS[type];
      if (execute) {
        // lastTouchKey는 각 실행이 부르는 ball.kick()이 알아서 채운다.
        execute(this, taker);
      } else {
        this.ball.ownerKey = `${taker.team}:${taker.idx}`;
        this.ball.carrierKey = `${taker.team}:${taker.idx}`;
        this.ball.lastTouchKey = `${taker.team}:${taker.idx}`;
        taker.kc = PARAMS.kickCooldownTicks;
      }
    }
  }

  /**
   * 재개를 누가 차는가. 기본은 볼에서 가장 가까운 선수지만 두 가지는 다르다 —
   * 골킥은 골키퍼가 차고, 페널티킥은 **가까운 사람이 아니라 팀에서 슛이 가장 좋은 선수**가 찬다.
   */
  restartTaker(type, side) {
    const available = side.filter((p) => !p.sentOff && !p.injured);
    if (type === 'goal-kick') return available.find((p) => p.role === 'GK') ?? closest(side, this.ball);
    if (type === 'penalty') {
      // 동점이면 idx로 갈라서 같은 seed에서 항상 같은 키커가 나오게 한다(되감기 재현).
      const kickers = available
        .filter((p) => p.role !== 'GK')
        .sort((a, b) => b.shootSkill - a.shootSkill || a.idx - b.idx);
      return kickers[0] ?? closest(side, this.ball);
    }
    return closest(side, this.ball);
  }

  // ==========================================================================
  // 승부차기 (연장 120분에도 동점일 때)
  //
  // 실제 규칙 중 여기서 지키는 것:
  //  - 한쪽 골대에서만 찬다(주심이 고른다 → 여기서는 연장 후반 홈팀 공격 방향으로 고정).
  //  - 어느 팀이 먼저 찰지는 동전 던지기(시드 기반이라 되감기·재현이 가능하다).
  //  - 양 팀이 번갈아 5번씩 찬다. 남은 킥을 다 성공해도 못 따라잡으면 그 자리에서 끝난다.
  //  - 5-5 뒤에는 서든데스 — 같은 횟수를 찬 시점에 점수가 다르면 끝난다.
  //  - 찰 수 있는 사람은 연장 종료 시점에 경기장에 있던 선수뿐이고(퇴장·부상 제외),
  //    전원이 한 번씩 찬 뒤에야 두 번째로 찰 수 있다.
  //  - 인원이 적은 팀에 맞춰 많은 쪽이 인원을 줄인다(동수 원칙).
  //  - 승부차기 득점은 경기 스코어에 더하지 않는다 — 승자를 가리는 데만 쓴다.
  // ==========================================================================

  /** 승부차기를 찰 수 있는 선수들 — 슛 능력 순. 실제 규칙대로 골키퍼도 포함한다. */
  shootoutKickerOrder(team) {
    const side = team === 'home' ? this.homeP : this.awayP;
    return side
      .filter((p) => !p.sentOff && !p.injured)
      // 동점이면 idx로 갈라 같은 seed에서 항상 같은 순서가 나오게 한다(되감기 재현).
      .sort((a, b) => b.shootSkill - a.shootSkill || a.idx - b.idx)
      .map((p) => p.idx);
  }

  beginShootout() {
    const home = this.shootoutKickerOrder('home');
    const away = this.shootoutKickerOrder('away');
    // 동수 원칙 — 인원이 많은 팀이 슛이 약한 순서부터 뺀다.
    const squad = Math.min(home.length, away.length);
    // 동전 던지기는 seededRandom(tick, playerId, actionId)으로 굴리면 안 된다 — 세 값이
    // 어느 경기에서나 똑같아서(항상 120분, 고정 id) 결과가 매 경기 같은 팀으로 나온다.
    // 경기 seed에서 출발하는 스트림 난수를 쓴다(스냅샷에 담기므로 재현성도 그대로다).
    const first = this.rng.next() < 0.5 ? 'home' : 'away';
    this.phase = 'shootout';
    this.shootout = {
      // 킥이 향하는 골대. 연장 후반에 홈팀이 공격하던 쪽을 그대로 쓴다.
      endSide: this.homeP[0]?.attackDirection ?? 1,
      first,
      turn: first,
      order: { home: home.slice(0, squad), away: away.slice(0, squad) },
      next: { home: 0, away: 0 }, // order를 한 바퀴 돌면 다시 처음부터(전원이 한 번씩 찬 뒤 두 번째)
      taken: { home: 0, away: 0 },
      score: { home: 0, away: 0 },
      kicks: [], // { team, num, name, scored } — 화면의 승부차기 보드가 그대로 그린다
      current: null, // { team, idx }
      stage: 'setup', // 'setup' → 'live' → 'result' → (다음 키커) 'setup'
      stageUntil: 0,
      winner: null,
    };
    this.pushEvent('shootout', first, `승부차기 시작 · ${first === 'home' ? '홈' : '원정'} 선축`);
    this.prepareShootoutKick();
  }

  /** 다음 키커를 뽑아 볼과 선수를 배치한다(아직 안 찬다). */
  prepareShootoutKick() {
    const s = this.shootout;
    const team = s.turn;
    const order = s.order[team];
    const side = team === 'home' ? this.homeP : this.awayP;
    const kicker = side[order[s.next[team] % order.length]];
    s.next[team]++;
    s.current = { team, idx: kicker.idx };

    this.ball.reset();
    this.ball.x = s.endSide * (HALF.L - PARAMS.penaltySpotDepth);
    this.ball.z = 0;
    this.placePenaltyKick(kicker, s.endSide);
    s.stage = 'setup';
    s.stageUntil = this.tick + PARAMS.shootoutSetupTicks;
  }

  /**
   * 승부차기 전용 스텝. 필드 플레이어는 전부 제자리에 멈춰 있고 볼과 골키퍼만 움직인다 —
   * 일반 step()을 태우면 다른 선수들이 볼로 몰려들어 승부차기가 난투가 된다.
   */
  stepShootout() {
    const s = this.shootout;
    if (!s) return;
    this.tick++;

    if (s.stage === 'done') {
      // 승부가 갈린 킥을 잠깐 보여 준 뒤에 경기를 끝낸다 — 결과 화면이 마지막 킥 위로
      // 곧바로 덮이면 무엇으로 끝났는지 볼 수가 없다.
      if (this.tick >= s.stageUntil) this.phase = 'fulltime';
      return;
    }

    if (s.stage === 'setup') {
      if (this.tick < s.stageUntil) return;
      const side = s.current.team === 'home' ? this.homeP : this.awayP;
      const gk = this.shootoutKeeper();
      this.launchPenaltyKick(side[s.current.idx], s.endSide, gk, {
        log: false,
        rolls: { aim: this.rng.next(), dive: this.rng.next() },
      });
      s.stage = 'live';
      s.stageUntil = this.tick + PARAMS.shootoutFlightTicks;
      return;
    }

    if (s.stage === 'live') {
      const gk = this.shootoutKeeper();
      if (gk) {
        if (gk.kc > 0) gk.kc--; // 일반 step()의 선수 루프가 하던 일 — 안 하면 영원히 못 막는다
        this.tryGoalkeeperClaim(gk, s.endSide * HALF.L);
      }
      this.ball.update(PARAMS.dt);
      const outcome = this.shootoutKickOutcome();
      // 상한을 넘도록 결판이 안 났으면(포스트를 스치고 굴러다니는 등) 실축으로 확정한다.
      if (outcome) this.resolveShootoutKick(outcome === 'goal');
      else if (this.tick >= s.stageUntil) this.resolveShootoutKick(false);
      return;
    }

    // 'result' — 결과를 보여 주는 사이. 끝나면 다음 키커로 넘어간다.
    if (this.tick >= s.stageUntil) {
      s.turn = s.turn === 'home' ? 'away' : 'home';
      this.prepareShootoutKick();
    }
  }

  /** 지금 킥을 막는 골키퍼. 퇴장·부상이면 없을 수도 있다(그러면 빈 골문이다). */
  shootoutKeeper() {
    const defenders = this.shootout.current.team === 'home' ? this.awayP : this.homeP;
    return defenders.find((p) => p.role === 'GK' && !p.sentOff && !p.injured) ?? null;
  }

  /**
   * 날아가는 중인 승부차기 킥의 결말. 아직 결판이 안 났으면 null.
   * 리바운드는 규칙상 두 번째 슛이 없으므로, 골문을 안 지나친 볼이 멈추면 실축이다.
   * @returns {'goal'|'miss'|null}
   */
  shootoutKickOutcome() {
    const b = this.ball;
    const dir = this.shootout.endSide;
    if (b.y < GOAL_H && dir * b.x >= HALF.L && Math.abs(b.z) < GOAL_W / 2) return 'goal';
    if (Math.abs(b.x) >= HALF.L || Math.abs(b.z) >= HALF.W) return 'miss'; // 골문을 벗어나 아웃
    if (b.carrierKey) return 'miss'; // 키퍼가 잡았다
    if (!b.airborne && vlen(b.vx, b.vz) < 0.4) return 'miss'; // 굴러가다 멈췄다(막힌 뒤 흐른 볼 포함)
    return null;
  }

  /** 한 킥을 확정하고, 그걸로 승부가 갈렸는지 본다. */
  resolveShootoutKick(scored) {
    const s = this.shootout;
    const { team, idx } = s.current;
    const kicker = (team === 'home' ? this.homeP : this.awayP)[idx];
    s.taken[team]++;
    if (scored) s.score[team]++;
    s.kicks.push({ team, num: kicker.num, name: kicker.name, scored });
    this.pushEvent(
      scored ? 'shootout-goal' : 'shootout-miss',
      team,
      `${kicker.name} 승부차기 ${scored ? '성공' : '실축'} (${s.score.home}-${s.score.away})`
    );
    this.ball.carrierKey = null; // 키퍼가 잡고 있어도 다음 킥을 위해 놓는다

    const winner = this.shootoutWinner();
    s.stage = winner ? 'done' : 'result';
    s.stageUntil = this.tick + PARAMS.shootoutResultTicks;
    if (winner) {
      s.winner = winner;
      this.pushEvent('shootout', winner, `승부차기 ${s.score.home}-${s.score.away} 종료`);
    }
  }

  /**
   * 지금까지의 킥으로 승자가 정해졌는가.
   *
   * 정규 5킥 동안은 "남은 킥을 다 넣어도 못 따라잡는" 순간 바로 끝난다(실제 규칙의 조기 종료).
   * 5킥을 다 찬 뒤에는 양 팀이 **같은 횟수**를 찬 시점에만 비교한다(서든데스).
   * @returns {'home'|'away'|null}
   */
  shootoutWinner() {
    const s = this.shootout;
    const rounds = PARAMS.shootoutRegularKicks;
    const { home: hTaken, away: aTaken } = s.taken;
    if (hTaken < rounds || aTaken < rounds) {
      const hLeft = Math.max(0, rounds - hTaken);
      const aLeft = Math.max(0, rounds - aTaken);
      if (s.score.home > s.score.away + aLeft) return 'home';
      if (s.score.away > s.score.home + hLeft) return 'away';
      return null;
    }
    if (hTaken !== aTaken || s.score.home === s.score.away) return null;
    return s.score.home > s.score.away ? 'home' : 'away';
  }

  /**
   * 페널티킥 — 키커 대 골키퍼 단독 상황.
   *
   * 세이브 확률을 따로 계산하지 않는다. 키커가 노리는 쪽과 키퍼가 몸을 던지는 쪽을 각각
   * 굴려서 키퍼를 **미리 그 자리에 세워 두고**, 그 다음은 기존 슛·선방 코드가 그대로
   * 처리한다. 방향을 맞히면 볼이 사거리(gkReachRadius) 안으로 들어와 캐치/펀칭 판정이
   * 돌고, 틀리면 손이 안 닿아 골이 된다. 새 확률 모델을 안 만들어도 "찍기 싸움"이 된다.
   *
   * 두 굴림은 actionId가 달라야(PENALTY_AIM vs PENALTY_DIVE) 서로 독립이다 — 같으면
   * 키퍼가 항상 맞히거나 항상 틀린다.
   *
   * 배치(placePenaltyKick)와 킥(launchPenaltyKick)이 나뉘어 있는 이유는 승부차기 때문이다.
   * 경기 중 페널티킥은 둘을 한 틱에 이어서 하지만, 승부차기는 배치를 먼저 보여 주고
   * 잠시 뒤에 차야 한 킥씩 눈에 들어온다.
   *
   * @param {number} [dirOverride] 킥이 향하는 골대(+1/-1). 승부차기는 규칙상 한쪽 골대에서만
   *   차므로 키커의 공격 방향 대신 이 값을 쓴다.
   */
  executePenaltyKick(kicker, dirOverride) {
    const dir = dirOverride ?? kicker.attackDirection;
    const gk = this.placePenaltyKick(kicker, dir);
    this.launchPenaltyKick(kicker, dir, gk);
  }

  /**
   * 페널티킥 배치 — 키커는 볼 뒤, 키퍼는 골라인 정면, 나머지는 전원 박스 밖(실제 규칙).
   * @returns {object|null} 막을 골키퍼(없으면 null)
   */
  placePenaltyKick(kicker, dir) {
    const goalX = dir * HALF.L;
    const opponents = kicker.team === 'home' ? this.awayP : this.homeP;
    const gk = opponents.find((p) => p.role === 'GK' && !p.sentOff && !p.injured) ?? null;

    // 차는 팀의 골키퍼는 대기 줄에 세우지 않고 **자기 골문**으로 보낸다.
    //
    // 예전에는 이 골키퍼가 others에 섞여 들어가서, 두 골키퍼가 같은 골문 앞에 나란히 서고
    // 차는 팀 골문은 통째로 비어 있었다. 실제 축구에서도 페널티킥을 차는 동안 상대 골키퍼는
    // 자기 골문을 지킨다 — 막히고 역습이 나오면 그 자리에 있어야 한다.
    const kickerGk = (kicker.team === 'home' ? this.homeP : this.awayP).find(
      (p) => p.role === 'GK' && !p.sentOff && !p.injured
    );

    // 키커와 두 골키퍼를 뺀 전원은 박스 밖에 선다(실제 규칙). 표를 두지 않고 폭에 고르게
    // 늘어세운다 — 퇴장·부상으로 인원이 줄어도 그대로 동작한다.
    const others = this.all.filter(
      (p) => p !== kicker && p !== gk && p !== kickerGk && !p.sentOff && !p.injured
    );
    others.forEach((p, i) => {
      const t = others.length > 1 ? i / (others.length - 1) : 0.5;
      p.x = goalX - dir * (PENALTY_AREA.depth + 2.5 + (i % 3) * 3);
      p.z = (t - 0.5) * 2 * PARAMS.penaltyWaitHalfWidth;
      p.vx = 0;
      p.vz = 0;
      p.kc = 0;
    });

    // 키커는 볼 뒤에 선다. 볼은 restart()가 이미 페널티 스폿에 놓았다.
    kicker.x = this.ball.x - dir * PARAMS.penaltyRunUp;
    kicker.z = 0;
    kicker.vx = 0;
    kicker.vz = 0;

    if (gk) {
      // 다이브는 킥 순간에 정한다(launchPenaltyKick) — 여기서는 골문 정면에 세워만 둔다.
      gk.x = goalX - dir * PARAMS.penaltyGkLineOffset;
      gk.z = 0;
      gk.vx = 0;
      gk.vz = 0;
      gk.kc = 0;
    }
    if (kickerGk) {
      // 반대편 골문 정면. 승부차기처럼 양 팀이 같은 골대로 찰 때도 이 골키퍼는 자기 골문에
      // 남으므로, 두 골키퍼가 한 자리에 겹치는 일이 없다.
      const ownGoalX = -dir * HALF.L;
      kickerGk.x = ownGoalX + dir * PARAMS.penaltyGkLineOffset;
      kickerGk.z = 0;
      kickerGk.vx = 0;
      kickerGk.vz = 0;
      kickerGk.kc = 0;
    }
    return gk;
  }

  /**
   * 페널티킥 실행 — 키커의 조준과 키퍼의 다이브를 굴려 키퍼를 세운 뒤 실제로 찬다.
   * @param {boolean} [log] 행동로그에 "페널티킥"을 남길지. 승부차기는 성공/실패가 난 뒤에
   *   결과와 함께 한 줄로 남기므로 여기서는 안 남긴다.
   * @param {{aim:number, dive:number}} [rolls] 조준·다이브 굴림을 밖에서 넣는다(승부차기 전용).
   *   경기 중 페널티킥은 되감기 재현 때문에 seededRandom(tick, playerId, actionId)이어야 하지만,
   *   승부차기는 그 세 입력이 지나치게 규칙적이다 — 골키퍼 id는 팀당 하나로 고정이고 킥 간격도
   *   거의 일정해서, 해시가 특정 팀 쪽으로 계속 같은 방향을 내놓는다(실측: 홈 성공률 60% vs
   *   원정 70%, 오차각·체력·압박은 완전히 동일한데도). 승부차기는 되감기 대상이 아니므로
   *   경기 seed에서 출발하는 스트림 난수를 대신 쓴다.
   */
  launchPenaltyKick(kicker, dir, gk, { log = true, rolls = null } = {}) {
    const goalX = dir * HALF.L;
    const aimRoll = rolls
      ? rolls.aim
      : seededRandom(this.tick, seededRandomPlayerId(kicker.team, kicker.idx), ACTION_ID.PENALTY_AIM);
    const aimSide = aimRoll < 0.5 ? -1 : 1;
    // 조준점은 스탯과 무관하게 고정이다 — 페널티킥은 찍기 싸움으로 둔다.
    // (슛 스탯으로 구석에 더 붙이게 해 봤지만, 그러면 페널티가 스탯 대결이 된다.
    //  스탯은 errorDegrees의 조준 오차에만 반영된다.)
    const targetZ = aimSide * (GOAL_W / 2) * PARAMS.penaltyAimFraction;

    if (gk) {
      const diveRoll = rolls
        ? rolls.dive
        : seededRandom(this.tick, seededRandomPlayerId(gk.team, gk.idx), ACTION_ID.PENALTY_DIVE);
      const diveSide = diveRoll < 0.5 ? -1 : 1;
      gk.x = goalX - dir * PARAMS.penaltyGkLineOffset;
      gk.z = diveSide * PARAMS.penaltyDiveReach;
      gk.vx = 0;
      gk.vz = 0;
      gk.kc = 0;
    }

    const errDeg = this.errorDegrees(kicker, {
      statValue: kicker.shootSkill,
      distance: PARAMS.distanceErrorRef,
      baseDeg: PARAMS.penaltyBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(goalX - this.ball.x, targetZ - this.ball.z, errDeg);
    const kickerKey = `${kicker.team}:${kicker.idx}`;
    this.ball.kick(edx, edz, PARAMS.penaltyForce, kickerKey, PARAMS.penaltyLoftDeg);
    // 슛으로 표시해야 키퍼가 막았을 때 "선방"으로 기록된다(일반 슛과 같은 경로).
    this.ball.shotBy = kickerKey;
    kicker.kc = PARAMS.kickCooldownTicks;
    this.recordShotAttempt(kicker);
    if (log) this.pushEvent('shot', kicker.team, `${kicker.name} 페널티킥`);
  }

  /**
   * 코너킥 문전 배치 — 실제 코너처럼 양 팀을 골문 앞에 모은다.
   *
   * 이게 없으면 코너를 아무리 정확히 올려도 박스에 아무도 없어서 그냥 골키퍼 볼이 된다
   * (코너가 처음 생겼을 때 실제로 그랬다 — 코너 34번에서 나온 골 0). 킥오프가 대형을
   * 되돌리는 것과 같은 방식이라 새로운 개념을 들이지 않는다.
   *
   * 좌표는 "골라인에서 몇 m 떨어져(depth), 어느 폭(z)에 서는가"다. 공격은 골에어리어 앞부터
   * 페널티 스폿 뒤까지 퍼지고, 수비는 그보다 한 겹 골문 쪽에 선다.
   */
  setCornerFormation(taker) {
    const dir = taker.attackDirection;
    const goalX = dir * HALF.L;
    // 문전에 세울 사람은 **이미 그쪽에 가까이 있던 선수**로 고른다. 나머지는 손대지 않는다.
    //
    // 예전에는 순서대로 스무 명 중 열여섯을 박스로 순간이동시켰다. 그러면 코너가 끝난 뒤
    // 그 열여섯이 자기 자리까지 60m를 걸어 돌아가는데, 12게임초쯤 걸리는 그 구간 내내
    // 화면에는 큰 덩어리가 통째로 이동하는 모양이 남는다 — 실측으로 "선수 16명이 35m 구간
    // 안에 몰려 있는 시간"이 경기의 17%였고, 코너가 생기기 전에는 0%였다.
    // 가까운 순으로 뽑으면 이동 거리도, 복귀 꼬리도 같이 줄고, 멀리 있던 선수는 자연스럽게
    // 뒤에 남아 역습 대비까지 저절로 된다(예전에는 그걸 별도 좌표로 억지로 만들어 뒀다).
    const place = (players, spots) => {
      const aim = goalX - dir * PARAMS.cornerAimDepth;
      const near = players
        .filter((p) => p !== taker && p.role !== 'GK' && !p.sentOff && !p.injured)
        // 동점이면 idx로 갈라 같은 seed에서 항상 같은 배치가 나오게 한다(되감기 재현).
        .sort((a, b) => vlen(a.x - aim, a.z) - vlen(b.x - aim, b.z) || a.idx - b.idx)
        .slice(0, spots.length);
      near.forEach((p, i) => {
        p.x = goalX - dir * spots[i][0];
        p.z = spots[i][1];
        p.vx = 0;
        p.vz = 0;
        // 세트피스 배치는 그 자리에서 다시 판단하게 한다 — 안 그러면 직전 판단의 쿨다운이
        // 남아 코너가 올라오는 동안 아무도 볼에 반응하지 못한다.
        p.kc = 0;
      });
    };
    const attackers = taker.team === 'home' ? this.homeP : this.awayP;
    const defenders = taker.team === 'home' ? this.awayP : this.homeP;
    place(attackers, PARAMS.cornerAttackSpots);
    place(defenders, PARAMS.cornerDefendSpots);
  }

  /**
   * 문전으로 띄워 올리는 세트피스 배달 — 코너킥과 먼 프리킥이 같은 장면이라 코드를 공유한다.
   *
   * 힘은 거리에서 역산한다. 골킥처럼 힘을 고정하면 짧은 코너에서 볼이 골라인을 그대로
   * 넘어가 버린다(코너 스팟에서 문전까지가 34m인데 고정 힘은 그 하나에만 맞기 때문이다).
   * 무항력 포물선 R = v²·sin(2θ)/g 에 공기저항 보정을 넣고 v를 역산한다 — 각도를 바꾸면
   * 힘이 저절로 따라온다.
   */
  deliverSetPieceCross(taker) {
    this.setCornerFormation(taker);
    const dir = taker.attackDirection;
    // 겨냥점은 사람이 아니라 "위험 지역"이다 — 실제 코너도 존을 보고 올린다. 그 존에
    // 가장 가까운 동료를 목표로 삼아, 배치와 조준이 어긋나지 않게 한다.
    const aimX = dir * (HALF.L - PARAMS.cornerAimDepth);
    const mates = taker.team === 'home' ? this.homeP : this.awayP;
    let target = null;
    let best = Infinity;
    for (const m of mates) {
      if (m === taker || m.role === 'GK' || m.sentOff || m.injured) continue;
      const d = vlen(m.x - aimX, m.z);
      if (d < best) {
        best = d;
        target = m;
      }
    }
    const tx = target ? target.x : aimX;
    const tz = target ? target.z : 0;
    const dist = vlen(tx - taker.x, tz - taker.z);
    const rad = (PARAMS.cornerLoftDeg * Math.PI) / 180;
    const force = clamp(
      Math.sqrt((dist * PARAMS.gravity) / (Math.sin(2 * rad) * PARAMS.loftRangeEfficiency)),
      PARAMS.cornerMinForce,
      PARAMS.cornerMaxForce
    );
    const errDeg = this.errorDegrees(taker, {
      statValue: taker.passSkill,
      distance: PARAMS.distanceErrorRef,
      baseDeg: PARAMS.cornerBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(tx - taker.x, tz - taker.z, errDeg);
    this.ball.kick(edx, edz, force, `${taker.team}:${taker.idx}`, PARAMS.cornerLoftDeg);
    taker.kc = PARAMS.kickCooldownTicks;
    // 볼이 문전에 내려올 때까지 배치를 붙잡는다. 안 잡으면 2.23초 체공 동안 다들 자기
    // 대형 자리로 돌아가 박스가 빈다.
    this.setPieceHold = { from: this.tick, until: this.tick + PARAMS.setPieceHoldMaxTicks };
  }

  /** 코너킥 — 문전 배달 그대로다. */
  executeCornerKick(taker) {
    this.deliverSetPieceCross(taker);
  }

  /**
   * 수비벽 — 볼과 골문을 잇는 선 위, 규정 거리(centerCircleRadius와 같은 9.15m)에 세운다.
   * 벽에 안 서는 수비도 그 거리 밖으로 물러난다(규정).
   *
   * @param {number} count 벽에 세울 인원. 0이면 벽 없이 물러나기만 한다(먼 프리킥).
   */
  setFreeKickWall(taker, count) {
    const b = this.ball;
    const dir = taker.attackDirection;
    const gd = vlen(dir * HALF.L - b.x, -b.z) || 1;
    const ux = (dir * HALF.L - b.x) / gd; // 볼 → 골문 단위벡터
    const uz = -b.z / gd;
    const px = -uz; // 그 수직 방향 — 벽이 옆으로 늘어서는 축
    const pz = ux;

    const defenders = (taker.team === 'home' ? this.awayP : this.homeP).filter(
      (p) => p.role !== 'GK' && !p.sentOff && !p.injured
    );
    // 볼에 가까운 순서로 벽을 세운다. 동점이면 idx로 갈라 같은 seed에서 같은 벽이 나오게 한다.
    const sorted = [...defenders].sort(
      (a, c) => vlen(a.x - b.x, a.z - b.z) - vlen(c.x - b.x, c.z - b.z) || a.idx - c.idx
    );
    const wall = sorted.slice(0, count);
    wall.forEach((p, i) => {
      const off = (i - (count - 1) / 2) * PARAMS.freeKickWallSpacing;
      p.x = clamp(b.x + ux * PARAMS.freeKickWallDistance + px * off, -HALF.L + PARAMS.playerLineInset, HALF.L - PARAMS.playerLineInset);
      p.z = clamp(b.z + uz * PARAMS.freeKickWallDistance + pz * off, -HALF.W + PARAMS.playerLineInset, HALF.W - PARAMS.playerLineInset);
      p.vx = 0;
      p.vz = 0;
      p.kc = 0;
    });
    // 나머지 수비는 규정 거리까지 물러난다 — 이미 밖에 있으면 건드리지 않는다.
    for (const p of sorted.slice(count)) {
      const d = vlen(p.x - b.x, p.z - b.z);
      if (d >= PARAMS.freeKickWallDistance || d < 1e-6) continue;
      const s = PARAMS.freeKickWallDistance / d;
      p.x = clamp(b.x + (p.x - b.x) * s, -HALF.L + PARAMS.playerLineInset, HALF.L - PARAMS.playerLineInset);
      p.z = clamp(b.z + (p.z - b.z) * s, -HALF.W + PARAMS.playerLineInset, HALF.W - PARAMS.playerLineInset);
    }
    return wall;
  }

  /**
   * 프리킥 — 골문까지의 거리가 두 장면을 가른다.
   *
   * 사거리 밖이면 문전으로 올리는 세트피스(코너와 같은 장면)이고, 사거리 안이면 수비벽을
   * 세우고 직접 노린다. 직접 슛은 벽에 맞을 수 있는데, 볼과 선수의 충돌 물리가 없으므로
   * 여기서 한 번만 굴려서 판정한다 — 맞으면 마지막 터치가 수비가 되니 골라인을 넘어가면
   * 규칙대로 코너킥이 된다.
   */
  executeFreeKick(taker) {
    const b = this.ball;
    const dir = taker.attackDirection;
    const goalX = dir * HALF.L;
    const gd = vlen(goalX - b.x, -b.z);

    if (gd > PARAMS.freeKickShotRange) {
      // 먼 프리킥 — 벽은 필요 없고(슛 사거리 밖), 규정 거리만 물린 뒤 문전으로 올린다.
      this.setFreeKickWall(taker, 0);
      this.deliverSetPieceCross(taker);
      return;
    }

    this.setFreeKickWall(taker, PARAMS.freeKickWallCount);
    const takerKey = `${taker.team}:${taker.idx}`;

    // 벽 반대쪽 구석을 노린다 — 볼이 있는 쪽 반대편(파 포스트)이 벽에 덜 가린다.
    const aimSide = b.z >= 0 ? -1 : 1;
    const targetZ = aimSide * (GOAL_W / 2) * PARAMS.freeKickAimFraction;

    // 벽을 **넘겨서** 크로스바 밑으로 떨어지는 궤적을 만든다. 이게 프리킥의 핵심이고,
    // 없으면 벽이 매번 헤딩으로 걷어낸다 — 낮게 깔아 찼더니 실측으로 벽 앞 볼 높이가
    // 1.2m라 헤딩 구간(0.75~2.2m)에 정확히 걸려서 100% 막혔다(득점 1~2%).
    //
    // 포물선 y(x) = x·tanθ − g·x²/(2v²cos²θ) 에서 "골라인에서의 높이 y(gd)"를 정해 두고
    // v를 역산한다. 각도가 고정이면 거리마다 필요한 힘이 저절로 나오고, 벽 위치(9.15m)에서의
    // 높이는 그 결과로 따라온다(20m 기준 3.0m — 헤딩이 안 닿는다).
    // 스핀(마그누스)이 없는 물리라 힘을 실제 프리킥만큼 세게 주면 이 둘을 동시에 못 만족한다.
    // 그래서 "감아 차는 느린 킥"쪽을 택했다.
    const rad = (PARAMS.freeKickShotLoftDeg * Math.PI) / 180;
    const rise = gd * Math.tan(rad) - PARAMS.freeKickTargetHeight;
    const denom = 2 * Math.cos(rad) ** 2 * rise;
    const force =
      rise > 0
        ? clamp(
            Math.sqrt((PARAMS.gravity * gd * gd) / denom) * PARAMS.freeKickDragCorrection,
            PARAMS.freeKickMinForce,
            PARAMS.freeKickMaxForce
          )
        : PARAMS.freeKickMinForce;

    const errDeg = this.errorDegrees(taker, {
      statValue: taker.shootSkill,
      distance: gd,
      baseDeg: PARAMS.freeKickBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(goalX - b.x, targetZ - b.z, errDeg);
    b.kick(edx, edz, force, takerKey, PARAMS.freeKickShotLoftDeg);
    b.shotBy = takerKey;
    taker.kc = PARAMS.kickCooldownTicks;
    this.recordShotAttempt(taker);
    this.pushEvent('shot', taker.team, `${taker.name} 프리킥 슛`);
  }

  /**
   * 스로인 — 손으로 던진다.
   *
   * 발로 차는 것보다 짧고 느리고 높이 뜬다. 그래서 스로인은 상대 진영 깊숙이 보내는 수단이
   * 아니라 "가까운 동료에게 안전하게 넘기는" 재개다. 사거리를 사람이 던질 수 있는 범위로
   * 제한하는 게 핵심이고, 그래서 조준도 그 안에서만 고른다.
   *
   * 규칙 두 개가 저절로 지켜진다 — 스로인은 오프사이드가 없고(여기서 ball.kick을 직접
   * 부르므로 tryKick의 오프사이드 검사를 타지 않는다), 직접 득점도 안 된다(터치라인에서
   * throwInForce로는 골문에 닿지 않는다).
   */
  executeThrowIn(taker) {
    const dir = taker.attackDirection;
    const mates = taker.team === 'home' ? this.homeP : this.awayP;
    let target = null;
    let bestScore = -Infinity;
    for (const m of mates) {
      if (m === taker || m.sentOff || m.injured) continue;
      const d = vlen(m.x - taker.x, m.z - taker.z);
      if (d < PARAMS.minPass || d > PARAMS.throwInRange) continue;
      // 열려 있을수록, 앞에 있을수록 좋다. 던지는 힘이 약해서 상대가 붙어 있는 동료에게
      // 넘기면 그대로 뺏긴다.
      const forward = ((m.x - taker.x) * dir) / PARAMS.throwInRange;
      const score = clamp(nearestOpponentDistance(this, m) / PARAMS.openPassRadius, 0, 1) + forward * 0.5;
      if (score > bestScore) {
        bestScore = score;
        target = m;
      }
    }
    // 받을 동료가 없으면 라인을 따라 앞쪽으로 던진다(경합볼이 된다) — 던지지 않고 들고
    // 있으면 볼이 라인 위에 멈춘 채로 경기가 굳는다.
    const tdx = target ? target.x - taker.x : dir * PARAMS.throwInRange * 0.6;
    const tdz = target ? target.z - taker.z : -Math.sign(taker.z) * PARAMS.throwInRange * 0.3;
    const dist = vlen(tdx, tdz);
    const errDeg = this.errorDegrees(taker, {
      statValue: taker.passSkill,
      distance: PARAMS.distanceErrorRef,
      baseDeg: PARAMS.throwInBaseErrorDeg,
    });
    const [edx, edz] = this.rotateXZ(tdx, tdz, errDeg);
    const rad = (PARAMS.throwInLoftDeg * Math.PI) / 180;
    const force = clamp(
      Math.sqrt((dist * PARAMS.gravity) / (Math.sin(2 * rad) * PARAMS.loftRangeEfficiency)),
      PARAMS.throwInMinForce,
      PARAMS.throwInMaxForce
    );
    this.ball.kick(edx, edz, force, `${taker.team}:${taker.idx}`, PARAMS.throwInLoftDeg);
    taker.kc = PARAMS.kickCooldownTicks;
  }

  /**
   * 오프사이드 — 반칙한 팀(attackingTeam)의 상대에게 간접 프리킥을 준다.
   * 재개 지점은 실제 규정대로 볼이 아니라 오프사이드 위치에 있던 선수 자리다.
   */
  offsideRestart(attackingTeam, offsidePlayer) {
    const defendingTeam = attackingTeam === 'home' ? 'away' : 'home';
    this.restart(defendingTeam, offsidePlayer.x, offsidePlayer.z, 'offside', `${offsidePlayer.name} 오프사이드`);
  }

  pushEvent(type, team, text) {
    this.events.push({ id: ++this.eventSeq, tick: this.tick, minute: this.matchMinute, type, team, text });
    if (this.events.length > 50) this.events.shift();
  }

  /** 우리 팀(home)이 가장 최근 실점한 골 이벤트. 없으면 null. */
  getLastConcedeEvent() {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const ev = this.events[i];
      if (ev.type === 'goal' && ev.team === 'away') return ev;
    }
    return null;
  }

  /**
   * 되감기 버튼은 "그 실점이 일어난 순간"에만 그 골을 겨냥한다 — 감독이 그 자리에서
   * 안 쓰고 넘어가면 기회가 지나간 것이지, 경기 끝까지 계속 그 골을 되감을 수 있는 게
   * 아니다. PARAMS.concedeRewindWindowSeconds가 지나면 더는 이 이벤트를 겨냥하지 않는다.
   */
  getActiveConcedeEvent() {
    const concede = this.getLastConcedeEvent();
    if (!concede) return null;
    const elapsed = (this.tick - concede.tick) * PARAMS.dt;
    return elapsed <= PARAMS.concedeRewindWindowSeconds ? concede : null;
  }

  /**
   * 되감기 목표 tick. 실점 이벤트가 아직 기회(concedeRewindWindowSeconds) 안에 있을 때만
   * 그 직전(rewindLookbackSeconds만큼 앞)을 계산한다. 되감기는 그 순간에만 쓸 수
   * 있는 것이라 그 외에는 폴백 없이 null — 호출 전에 반드시 canRewind()로 확인해야 한다.
   *
   * 전반에 난 실점을 후반에서 되감지 않도록 그 하프의 시작보다 앞으로는 가지 않는다.
   */
  getRewindTargetTick() {
    const concede = this.getActiveConcedeEvent();
    if (!concede) return null;
    const halfStartTick = this.periodStartTick();
    const target = concede.tick - PARAMS.rewindLookbackSeconds / PARAMS.dt;
    // 하프 시작보다 앞으로는 가지 않되, 실점 시점보다 뒤로도 가지 않는다
    // (하프 시작 직후에 실점하면 두 한계가 서로 엇갈릴 수 있다).
    return Math.min(concede.tick, Math.max(halfStartTick, target));
  }

  /**
   * 되감기를 지금 실행해도 되는지 — 실점 이벤트가 기회 안에 있어야 하고(그 순간에만
   * 되감기가 의미를 가진다), 후반 막판이 아니어야 하고, 쿨다운도 지나 있어야 한다.
   */
  canRewind() {
    if (this.phase === 'shootout') return false; // 승부차기는 스냅샷 대상이 아니다 — 찬 킥은 되돌릴 수 없다
    if (!this.getActiveConcedeEvent()) return false; // 되감기는 실점 순간에만 쓸 수 있다
    // 경기가 끝날 수 있는 기간(후반·연장 후반)의 마지막 1분은 확정 — 되감기 불가.
    const canEndHere = this.half === 2 || this.half === 4;
    if (canEndHere && this.matchMinute >= this.periodEndClock() - 1) return false;
    if (
      this.lastRewindTick !== null &&
      (this.tick - this.lastRewindTick) * PARAMS.dt < PARAMS.rewindCooldownSeconds
    ) {
      return false; // 쿨다운 중
    }
    return true;
  }

  /**
   * 되감기가 "지금 일어났다"는 기록. restore()가 과거로 시계를 돌리는 것과 별개로,
   * 이 시점(=restore 이후의 this.tick)을 쿨다운 기준으로 남긴다.
   */
  markRewindUsed() {
    this.lastRewindTick = this.tick;
  }

  /** 되감기용 스냅샷. 숫자만 담아 GC 압박과 복사 비용을 낮춘다. */
  snapshot() {
    // Float32면 반올림 오차 때문에 되감은 뒤 경기가 미세하게 갈라진다.
    // 되감기가 이 서비스의 핵심이므로 정밀도를 택한다 (900스냅샷 ≈ 1.1MB).
    const players = new Float64Array(this.all.length * SNAP_STRIDE);
    this.all.forEach((p, i) => {
      const o = i * SNAP_STRIDE;
      players[o] = p.x;
      players[o + 1] = p.z;
      players[o + 2] = p.vx;
      players[o + 3] = p.vz;
      players[o + 4] = p.heading;
      players[o + 5] = p.energy;
      players[o + 6] = p.kc; // 킥 쿨다운까지 담아야 되감기가 무손실이 된다
    });
    return {
      tick: this.tick,
      players,
      // 높이(y, vy)는 뒤에 덧붙인다 — 4개짜리 옛 스냅샷도 그대로 복원되게 하려는 것이다.
      ball: [this.ball.x, this.ball.z, this.ball.vx, this.ball.vz, this.ball.y, this.ball.vy],
      ownerKey: this.ball.ownerKey,
      carrierKey: this.ball.carrierKey,
      lastTouchKey: this.ball.lastTouchKey,
      score: { ...this.score },
      rng: this.rng.s,
      eventCount: this.events.length,
      tactics: { ...this.tactics },
      half: this.half,
      phase: this.phase,
      kickoffLock: this.kickoffLock ? { ...this.kickoffLock } : null,
      setPieceHold: this.setPieceHold ? { ...this.setPieceHold } : null,
      // 누적 지표도 되감기 대상이다. 안 담으면 되감은 뒤에도 "없던 일이 된" 슛·점유가
      // 그대로 남아서, 감독이 보는 숫자와 실제 경기가 어긋난다.
      stats: { home: { ...this.stats.home }, away: { ...this.stats.away } },
      lastOwnerTeam: this.lastOwnerTeam ?? null,
      // 날아가는 중인 슛의 표식. 예전에는 안 담아도 됐지만 이제 이 둘이 누적 지표(슈팅·유효)를
      // 좌우하므로 반드시 복원해야 한다 — 안 담으면 되감은 뒤 같은 골을 두 번 세거나 아예
      // 안 세서, 되감기 전후로 숫자가 어긋난다(실측으로 seed 4242에서 실제로 깨졌다).
      shotBy: this.ball.shotBy,
      onTargetCounted: this.ball.onTargetCounted,
      lastRewindTick: this.lastRewindTick,
      // 경로 지시는 좌표 배열이라 SNAP_STRIDE 숫자 배열에 안 들어간다 — 선수 순서(this.all)와
      // 나란한 별도 배열로 얕은 구조 복제한다. 되감기 후 안 바꾸면 그대로 재현돼야 하므로
      // 진행 중인 지시도 반드시 여기 담는다(안 담으면 되감기 넘어서 지시가 사라지는 버그가 난다).
      commands: this.all.map((p) =>
        p.command ? { waypoints: p.command.waypoints.map((w) => ({ x: w.x, z: w.z })), index: p.command.index } : null
      ),
      // 드래그로 옮겨 놓은 기준 위치. 경로 지시(commands)와 달리 이건 도착한 뒤에도 계속
      // 남는 상태라, 안 담으면 "드래그 이전으로 되감았는데 대형은 드래그 후 그대로"인
      // 모순이 생긴다. 되감기가 이 게임의 핵심이라 반드시 시점별로 정확히 복원돼야 한다.
      homeOffsets: this.all.map((p) => ({ x: p.homeOffset.x, z: p.homeOffset.z })),
      // 키핑(hold) vs 전진 드리블(advance) — 다음 판단 주기까지 유지되는 캐리어 상태라
      // 되감기 후에도 그대로 재현돼야 한다. 1/0 숫자 배열로 담아 SNAP_STRIDE 구조를 안 건드린다.
      dribbleModes: this.all.map((p) => (p.dribbleMode === 'hold' ? 1 : 0)),
      // 경고·퇴장도 경기 중 변하는 상태다 — 안 담으면 퇴장 이후로 되감았다가 다시 앞으로
      // 돌려도 선수가 경기장에 돌아와 있는 모순이 생긴다.
      yellowCards: this.all.map((p) => p.yellowCards),
      sentOff: this.all.map((p) => p.sentOff),
      // 부상·교체 사용 횟수도 되감기 대상이다 — 안 담으면 되감은 뒤 subsUsed가 그대로 남아
      // maxSubsPerTeam을 우회해 교체를 더 쓸 수 있게 된다(선수 객체 자체가 아니라 이 숫자만
      // 정확해도 "규정 위반"은 막을 수 있다 — substitute() 클래스 위 comment 참고).
      injured: this.all.map((p) => p.injured),
      subsUsed: { ...this.subsUsed },
    };
  }

  restore(s) {
    this.all.forEach((p, i) => {
      const o = i * SNAP_STRIDE;
      p.x = s.players[o];
      p.z = s.players[o + 1];
      p.vx = s.players[o + 2];
      p.vz = s.players[o + 3];
      p.heading = s.players[o + 4];
      p.energy = s.players[o + 5];
      p.kc = s.players[o + 6];
    });
    const [bx, bz, bvx, bvz, by, bvy] = s.ball;
    this.ball.x = bx;
    this.ball.z = bz;
    this.ball.vx = bvx;
    this.ball.vz = bvz;
    // 옛 스냅샷 호환: 높이가 없으면 땅에 있던 것으로 취급한다.
    this.ball.y = by ?? PARAMS.ballRadius;
    this.ball.vy = bvy ?? 0;
    this.ball.ownerKey = s.ownerKey;
    this.ball.carrierKey = 'carrierKey' in s ? s.carrierKey : null; // 옛 스냅샷 호환: 없으면 자유 상태로 취급
    this.ball.lastTouchKey = 'lastTouchKey' in s ? s.lastTouchKey : null; // 옛 스냅샷 호환: 없으면 알 수 없음 취급
    this.score = { ...s.score };
    this.tick = s.tick;
    this.rng.s = s.rng;
    this.events.length = s.eventCount; // 되감은 시점 이후의 사건은 없던 일이 된다
    // 옛 스냅샷 호환: half/phase/kickoffLock/lastRewindTick이 없으면 현재 값 유지.
    // half는 반드시 refreshHomeSlots()보다 **먼저** 되돌려야 한다 — 그 안의 halfTurn이
    // half의 홀짝으로 공격 방향을 정하므로, 순서가 뒤집히면 기간을 넘어 되감을 때
    // 대형이 반대 진영으로 계산된다(지금은 되감기가 기간 안으로 잘리지만 그 보장에 기대지 않는다).
    if (s.half !== undefined) this.half = s.half;
    if (s.phase !== undefined) this.phase = s.phase;
    if (s.tactics) {
      this.tactics = { ...s.tactics }; // 옛 스냅샷 호환: 필드가 없으면 현재 값 유지
      // width는 p.home(정렬 목표 좌표)에서 파생된다. 재계산하지 않으면
      // 되감은 뒤에도 변경 후 width가 스티어링 목표에 남아 재현성이 깨진다.
      this.refreshHomeSlots();
    }
    if ('kickoffLock' in s) this.kickoffLock = s.kickoffLock ? { ...s.kickoffLock } : null;
    // 옛 스냅샷 호환: setPieceHold가 없던 시절엔 홀드 자체가 없었으므로 null이 그 시점의
    // 정확한 상태다(현재 값을 남기면 되감은 뒤에 있지도 않던 홀드가 걸린다).
    this.setPieceHold = s.setPieceHold ? { ...s.setPieceHold } : null;
    // 옛 스냅샷 호환: 지표가 없던 시절이면 현재 값을 그대로 둔다(0으로 밀면 오히려 어긋난다).
    if (s.stats) {
      this.stats = { home: { ...emptyStats(), ...s.stats.home }, away: { ...emptyStats(), ...s.stats.away } };
      this.lastOwnerTeam = s.lastOwnerTeam ?? null;
      // 옛 스냅샷에는 없던 값들이다. 없으면 "날아가는 슛이 없었다"로 두는 게 안전하다.
      this.ball.shotBy = s.shotBy ?? null;
      this.ball.onTargetCounted = s.onTargetCounted ?? false;
    }
    if ('lastRewindTick' in s) this.lastRewindTick = s.lastRewindTick;
    // 옛 스냅샷 호환: commands가 없으면 현재 지시 상태를 그대로 둔다(건드리지 않음).
    if (s.commands) {
      this.all.forEach((p, i) => {
        const c = s.commands[i];
        p.command = c ? { waypoints: c.waypoints.map((w) => ({ ...w })), index: c.index } : null;
      });
    }
    // 옛 스냅샷 호환: homeOffsets가 없던 시절의 스냅샷은 드래그 기준 이동이 아예 없었으므로
    // 0으로 되돌리는 게 그 시점의 정확한 상태다(현재 값을 남겨 두면 오히려 어긋난다).
    // 위 refreshHomeSlots()는 p.home만 다시 계산하고 homeOffset은 건드리지 않으므로,
    // 여기서 복원하는 값이 그대로 유효하다.
    this.all.forEach((p, i) => {
      const o = s.homeOffsets?.[i];
      p.homeOffset = o ? { x: o.x, z: o.z } : { x: 0, z: 0 };
    });
    // 옛 스냅샷 호환: dribbleModes가 없으면 기본값('advance')을 그대로 둔다.
    if (s.dribbleModes) {
      this.all.forEach((p, i) => {
        p.dribbleMode = s.dribbleModes[i] ? 'hold' : 'advance';
      });
    }
    // 옛 스냅샷 호환: yellowCards/sentOff가 없으면 현재 값을 그대로 둔다.
    if (s.yellowCards) {
      this.all.forEach((p, i) => {
        p.yellowCards = s.yellowCards[i];
      });
    }
    if (s.sentOff) {
      this.all.forEach((p, i) => {
        p.sentOff = s.sentOff[i];
      });
    }
    // 옛 스냅샷 호환: injured/subsUsed가 없으면 현재 값을 그대로 둔다.
    if (s.injured) {
      this.all.forEach((p, i) => {
        p.injured = s.injured[i];
      });
    }
    if (s.subsUsed) {
      this.subsUsed = { ...s.subsUsed };
    }
  }
}
