import { CountryFlag,countries, el } from "../../shared/index.js";
import { gameProgress, recordKoreaMatch, retryKoreaMatch, setState, state } from "../../app/public.js";
import {
  PARAMS,
  createSimulation,
  RewindBuffer,
} from "../../simulation/index.js";
import { createLiveTacticsPanel } from "../../tactics/index.js";
import { createMatchView, CAM_MODES } from "../render3d/index.js";
import { getMatchSides } from "../matchSides.js";

const REWIND_LIMIT = 2; // 감독의 '되감기'는 유한한 자원이다 — 이 서비스의 규칙
const REWIND_IDLE_LABEL = "↶ 실점 시에만 되감기 가능"; // 겨냥할 실점이 없을 때(대기 상태)
// 골 세리머니 길이(초). 이 동안 경기는 멈추고 득점 팀이 환호하며, 끝나야 배너(킥오프·되돌리기
// 버튼)가 뜬다. 길게 잡으면 골마다 흐름이 끊기니 짧게 둔다.
const GOAL_CELEBRATION_SECONDS = 2.2;

export default function matchScreen(root, ctx) {
  const matchSetup = state.pendingMatchSetup ?? null;

  let sim;
  try {
    sim = createSimulation(matchSetup);
  } catch (err) {
    root.append(
      el('div', { class: 'screen page' }, [
        el('h2', { class: 'h2', text: '경기를 시작할 수 없습니다' }),
        el('p', { class: 'lead small', text: err.message }),
        el('button', {
          class: 'primary',
          type: 'button',
          text: '전술 설정으로',
          onclick: () => ctx.navigate('tactics', undefined, { replace: true }),
        }),
      ])
    );
    return () => {};
  }

  const homeCode = matchSetup.homeTeam.code ?? matchSetup.homeTeam.id;
  const awayCode = matchSetup.awayTeam.code ?? matchSetup.awayTeam.id;
  const runStepCandidate = gameProgress().activeStep;
  const runStep = runStepCandidate?.opponentTeamId === matchSetup.awayTeam.id ? runStepCandidate : null;
  const matchSides = getMatchSides(matchSetup);
  const koreaEntry = Object.entries(matchSides).find(([,side]) => side.teamId === 'KOR');
  const koreaSide = koreaEntry?.[1] ?? null;
  const captainNum =
    matchSetup.homeTeam.players.find((p) => p.id === matchSetup.homeTeam.lineup.captainId)?.num ?? null;

  sim.kickoff({ kickoffTeam: 'home' }); // 시작 시 양팀이 동시에 공으로 몰려드는 문제 방지

  const rewind = new RewindBuffer();

  const stage = el("div", { class: "stage" });
  const scoreEl = el("div", {
    class: "score",
    text: `${homeCode} 0 : 0 ${awayCode}`,
  });
  function updateScoreboard() {
    const endsSwapped = sim.homeP[0]?.attackDirection === -1;
    scoreEl.textContent = endsSwapped
      ? `${awayCode} ${sim.score.away} : ${sim.score.home} ${homeCode}`
      : `${homeCode} ${sim.score.home} : ${sim.score.away} ${awayCode}`;
  }
  const clockEl = el("b", { text: "00:00" });
  const possEl = el("b", { text: "-" });
  const distEl = el("b", { text: "0.0km" }); // 팀 평균 주행거리 — 전술(특히 압박)의 체력 대가를 감독이 직접 확인하는 지표
  const camEl = el("b", { text: CAM_MODES.broadcast });
  const fpsEl = el("b", { text: "-" });
  const rewindEl = el("b", { text: `${REWIND_LIMIT}회` });
  const feed = el("ul", { class: "feed" });
  const pathStatusEl = el("span", { class: "path-status" });
  // 골 순간 화면 전체에 한 번 번지는 팀 색 글로우. 클릭을 막으면 안 되니 pointer-events는 CSS에서 끈다.
  const goalFlash = el("div", { class: "goal-flash" });

  let matchPhase = 'kickoffBriefing';
  let paused = true;
  let concedeChoicePending = false; // 실점 직후 "되돌릴지/진행할지" 명시적으로 물어보는 중인지
  let koreaGoalPending = false; // 득점 축하 후 상대 킥오프를 사용자가 직접 재개하기 전인지
  let lastNotifiedConcedeTick = null; // 같은 실점에 배너를 두 번 띄우지 않으려는 표시
  let lastNotifiedKoreaGoalTick = null;
  let rewindsLeft = REWIND_LIMIT;
  let acc = 0;
  let last = performance.now();
  let fpsT = 0;
  let fpsN = 0;
  let raf = 0;
  // events 배열은 50개가 넘으면 앞에서 shift()로 밀린다. 배열 인덱스로 "어디까지 그렸는지"를
  // 세면 밀린 만큼 어긋나 이벤트가 중복되거나 씹힌다 — id(고유, 안 변함)로 추적한다.
  let lastRenderedEventId = 0;
  // 스로인처럼 짧은 시간에 같은 종류의 사건이 몰아치면 로그를 한 줄로 합친다(아래 appendFeedEvent).
  // 합친 대상(가장 최근 줄)을 여기 들고 있다가 다음 사건이 같은 묶음이면 새 줄 대신 갱신한다.
  let lastFeedLi = null;
  let lastFeedMeta = null; // { type, team, tick, count }
  let lastPhase = sim.phase;
  let speed = 1; // 1 | 2 | 3 — 재생 배속(UI 상태). Sim/RewindBuffer에는 저장하지 않는다.
  let matchResult = null; // fulltime 결과 기록. null인 동안만 경기 루프와 되감기를 허용한다.
  let championRevealTimer = 0;
  let championEffectTimer = 0;
  let championAnimationFrame = 0;

  // 렌더러는 stage가 DOM에 붙은 뒤에 만든다.
  // 붙기 전에 만들면 clientWidth/Height가 0이라 캔버스가 0x0으로 생성돼 화면이 검게 남는다.
  let view = null;

  const pauseBtn = el("button", {
    class: "ctl",
    text: "⏸ 일시정지",
    onclick: () => setPaused(!paused),
  });
  const rewindBtn = el("button", {
    class: "ctl warn",
    text: REWIND_IDLE_LABEL,
    onclick: doRewind,
  });

  // 골 세리머니 — 골이 들어가면 먼저 이걸 보여 주고, 끝난 뒤에 배너(킥오프 버튼)를 띄운다.
  // { team, startedAt, onDone } 또는 null.
  let celebration = null;

  function startCelebration(team, onDone) {
    celebration = { team, startedAt: performance.now(), onDone };
    setPaused(true); // 세리머니 동안 경기는 멈춘다 — 안 그러면 뒤에서 경기가 계속 흘러간다
    flashGoal(team);
    popScore();
    updateBanners();
  }

  /**
   * 골 순간 화면 가장자리가 득점 팀 색으로 확 밝아졌다 사라진다.
   *
   * 클래스를 뗐다가 강제 리플로우(offsetWidth 읽기) 후 다시 붙인다 — 그냥 다시 붙이면
   * 브라우저가 "이미 있던 클래스"로 보고 애니메이션을 재생하지 않아서, 연속 득점 때
   * 두 번째 골에서는 아무 일도 안 일어난다.
   */
  function flashGoal(team) {
    goalFlash.style.setProperty("--goal-flash-color", matchSides[team].uniformColor);
    goalFlash.classList.remove("on");
    void goalFlash.offsetWidth;
    goalFlash.classList.add("on");
  }

  /** 스코어보드 숫자가 톡 튄다. 위와 같은 이유로 클래스를 재부착한다. */
  function popScore() {
    scoreEl.classList.remove("score-pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("score-pop");
  }

  /** 매 프레임 호출 — 시간이 다 되면 세리머니를 끝내고 미뤄 둔 배너를 띄운다. */
  function tickCelebration(now) {
    if (!celebration) return;
    const t = (now - celebration.startedAt) / 1000;
    if (t < GOAL_CELEBRATION_SECONDS) {
      view?.setCelebration({ team: celebration.team, t });
      return;
    }
    const done = celebration.onDone;
    celebration = null;
    view?.setCelebration(null);
    done?.();
  }

  function setPaused(v) {
    // 하프타임/풀타임 중에는 '후반 시작' 버튼 없이 일반 재개로 넘어갈 수 없다
    if (!v && (sim.phase !== "playing" || matchPhase !== 'playing')) return;
    // 대한민국 득점 뒤에는 일반 재개가 아니라 전용 "킥오프 재개" 버튼으로만 다시 시작한다.
    if (!v && koreaGoalPending) return;
    // 세리머니 중에는 재개를 막는다 — 배너가 아직 안 떴는데 경기가 흘러가면 안 된다.
    if (!v && celebration) return;
    paused = v;
    pauseBtn.textContent = paused ? "▶ 재개" : "⏸ 일시정지";
    pauseBtn.classList.toggle("on", paused);
    if (!paused) {
      // 어떤 경로(버튼/스페이스바)로 재개하든 실점 선택 배너는 닫힌다 — 재개 = "이대로 진행"
      concedeChoicePending = false;
      // 재개하면 경로 지시 UI 흔적을 정리한다 — 이미 내려진 지시(sim.command) 자체는 그대로 진행된다
      pathStatusEl.textContent = "";
      view?.clearPaths();
    }
    updateBanners();
  }

  // 득점/실점 선택/일시정지 배너는 동시에 뜨지 않는다. 경기 결과는 별도 모달로 표시한다.
  function updateBanners() {
    const finished = matchResult !== null;
    // 세리머니 중에는 어떤 배너도 띄우지 않는다 — 환호를 먼저 보여 주고 그 다음이 배너다.
    banner.classList.toggle(
      "show",
      !finished && paused && sim.phase === "playing" && !concedeChoicePending && !koreaGoalPending && !celebration
    );
    koreaGoalBanner.classList.toggle("show", !finished && koreaGoalPending);
    concedeBanner.classList.toggle("show", !finished && concedeChoicePending);
    updateSpeedButtons();
  }

  // 실점한 그 순간 자동으로 멈추고 "되돌릴지/진행할지"를 명시적으로 물어본다 —
  // 그냥 흘러가게 두면 되감기 기능이 있는 의미가 없다.
  function showConcedeChoice(ev) {
    concedeChoicePending = true;
    concedeMoment.textContent = formatEventClock(ev);
    concedeTarget.textContent = formatTickClock(sim.getRewindTargetTick() ?? ev.tick);
    concedeRewindBtn.textContent = `⏪ 운명 되돌리기 · ${rewindsLeft}회 남음`;
    concedeRewindBtn.disabled = rewindsLeft <= 0 || !sim.canRewind();
    setPaused(true); // setPaused가 updateBanners()를 호출해 concedeBanner도 같이 뜬다
  }

  function showKoreaGoal(ev) {
    koreaGoalPending = true;
    koreaGoalClock.textContent = formatEventClock(ev);
    koreaGoalScorer.textContent = ev.text || "대한민국 득점";
    koreaGoalScore.textContent = `${homeCode} ${sim.score.home} : ${sim.score.away} ${awayCode}`;
    setPaused(true);
  }

  function setSpeed(v) {
    speed = v;
    updateSpeedButtons();
  }

  // step()이 안 불리는 동안(일시정지·halftime·fulltime)은 배속이 의미 없으므로 비활성화한다
  function updateSpeedButtons() {
    const disabled = paused || sim.phase !== "playing";
    speedButtons.forEach(({ value, btn }) => {
      btn.classList.toggle("on", value === speed);
      btn.disabled = disabled;
    });
  }

  const teamName = (teamId) => countries[teamId]?.nameKo ?? teamId;

  /**
   * 경기 종료 — 결과를 대회 진행에 기록하고 결과 화면을 띄운다.
   * 조별리그 최종전은 승리 또는 무승부 시 진출하고, 토너먼트는 승리해야 진출한다.
   * 탈락한 경기는 그 자리에서 바로 다시 시도할 수 있다.
   */
  function finishMatch() {
    if (matchResult) return; // 되감기·재렌더로 두 번 기록되지 않게 한다
    const koreaScore = sim.score.home;
    const opponentScore = sim.score.away;
    const outcome =
      koreaScore > opponentScore ? "win" : koreaScore === opponentScore ? "draw" : "loss";
    const progress = runStep
      ? recordKoreaMatch({ matchId: runStep.matchId, koreaScore, opponentScore })
      : null;
    matchResult = { koreaScore, opponentScore, outcome, progress };
    const isKoreaChampion =
      runStep?.matchId === 104 && outcome === "win" && progress?.status === "champion";

    resultDialog.dataset.outcome = outcome;
    resultTitle.textContent =
      outcome === "win" ? "승리" : outcome === "draw" ? "무승부" : "패배";
    resultScore.textContent = `${koreaScore} : ${opponentScore}`;

    const nextStep = progress?.nextStep ?? null;
    if (!runStep) {
      resultSub.textContent = "이 경기는 대회 기록에 반영되지 않습니다.";
    } else if (progress?.status === "champion") {
      resultSub.textContent = "우승! 대한민국이 2026 월드 챔피언십을 들어 올렸습니다.";
    } else if (nextStep && (outcome === "win" || runStep.stage === "group")) {
      resultSub.textContent = runStep.stage === "group"
        ? `${outcome === "draw" ? "무승부로 " : ""}A조 2위를 확정해 32강에 진출했습니다. 다음 상대는 ${teamName(nextStep.opponentTeamId)}입니다.`
        : `${runStep.advanceLabel}에 진출했습니다. 다음 상대는 ${teamName(nextStep.opponentTeamId)}입니다.`;
    } else {
      resultSub.textContent = runStep.stage === "group"
        ? "남아공전 패배로 조별리그에서 탈락했습니다."
        : `${runStep.roundLabel}에서 탈락했습니다. 토너먼트에서는 무승부도 패배와 같습니다.`;
    }

    const advanced = Boolean(nextStep) && (outcome === "win" || runStep?.stage === "group");
    const canRetry = Boolean(runStep) && !advanced;
    const canAdvance = advanced;
    retryBtn.hidden = !canRetry;
    advanceBtn.hidden = !canAdvance;
    if (canAdvance) advanceBtn.textContent = `▶ ${nextStep.roundLabel} 준비하기`;

    setPaused(true);
    updateBanners();
    if (isKoreaChampion) {
      championshipScore.textContent = `${koreaScore} : ${opponentScore}`;
      championRevealTimer = window.setTimeout(openChampionshipCelebration, 500);
      return;
    }
    if (!resultDialog.isConnected) document.body.append(resultDialog);
    if (!resultDialog.open) resultDialog.showModal();
    (canAdvance ? advanceBtn : canRetry ? retryBtn : tournamentBtn).focus();
  }

  // tick을 "68:22"(분:초) 형태로 — 1 clockSecond = 게임 1분 스케일이다
  function formatTickClock(tick) {
    const clockSeconds = tick * PARAMS.dt;
    const minute = Math.floor(clockSeconds);
    const sec = Math.floor((clockSeconds - minute) * 60);
    return `${String(minute).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  // 실점 이벤트 시각
  const formatEventClock = (ev) => formatTickClock(ev.tick);

  // 쿨다운으로 막혀 있을 때 남은 대기 시간(경기 시간 분 단위, 올림). 쿨다운이 아니면 0.
  function cooldownRemainingMinutes() {
    if (sim.lastRewindTick === null) return 0;
    const remaining = PARAMS.rewindCooldownSeconds - (sim.tick - sim.lastRewindTick) * PARAMS.dt;
    return remaining > 0 ? Math.ceil(remaining) : 0;
  }

  // 되감기 버튼의 라벨/활성 상태를 sim 상태에 맞춘다 — 매 프레임 loop()에서도 호출된다.
  // 되감기는 실점이 난 그 순간(concedeRewindWindowSeconds 안)에만 쓸 수 있다 — 그 외엔
  // 항상 대기 라벨이고 버튼도 꺼져 있다. 폴백으로 아무 때나 되감는 경로는 없다.
  function updateRewindButton() {
    const concede = sim.getActiveConcedeEvent();
    const cooldownMinutes = cooldownRemainingMinutes();
    rewindBtn.textContent = !concede
      ? REWIND_IDLE_LABEL
      : cooldownMinutes > 0
        ? `⏳ ${cooldownMinutes}분 후 되감기 가능`
        : `⏪ ${formatTickClock(sim.getRewindTargetTick() ?? concede.tick)}으로 되감기`;
    rewindBtn.disabled = matchResult !== null || rewindsLeft <= 0 || !sim.canRewind();
  }

  function doRewind() {
    if (matchResult) return; // 경기가 끝난 뒤에는 되감을 수 없다 — 결과는 결과다
    if (rewindsLeft <= 0) return;
    if (!sim.canRewind()) return;
    const targetTick = sim.getRewindTargetTick();
    if (targetTick === null) return; // canRewind()가 true면 항상 있어야 하지만 방어적으로
    const snap = rewind.restoreTo(targetTick);
    if (!snap) return;
    concedeChoicePending = false; // R키로 바로 되감아도 실점 선택 배너는 닫아야 한다
    koreaGoalPending = false;
    lastNotifiedKoreaGoalTick = null;
    sim.restore(snap);
    sim.markRewindUsed();
    rewindsLeft--;
    rewindEl.textContent = `${rewindsLeft}회`;
    const feedRows = buildFeedRows(sim.events);
    feed.replaceChildren(...feedRows.map(eventNode));
    const lastRow = feedRows[feedRows.length - 1];
    lastFeedMeta = lastRow ? { type: lastRow.type, team: lastRow.team, tick: lastRow.tick, count: lastRow.count } : null;
    lastFeedLi = lastRow ? feed.lastElementChild : null;
    lastRenderedEventId = sim.events.length ? sim.events[sim.events.length - 1].id : 0;
    // 스냅샷에는 되감은 시점의 전술이 들어 있다. 시계는 되돌리되 감독의 지시는 지금 것을 유지한다.
    sim.applyTactics(livePlan);
    syncTacticSliders();
    if (sim.phase !== lastPhase) {
      lastPhase = sim.phase;
      updateBanners();
    }
    view.sync(0);
    setPaused(true);
    updateRewindButton();
    // 되감기의 목적은 "같은 장면을 다시 보는 것"이 아니라 "다른 선택을 하는 것"이다.
    // 전술을 안 바꾸면 같은 흐름이 그대로 재현되므로, 되돌리자마자 전술 패널을 열어 준다.
    openTacticsPanel();
    resumeAfterTactics = false; // 되감기 직후에는 감독이 직접 재개한다
  }

  // 되감기 후 드래그로 경로 지시 — 일시정지 + 탑뷰에서만 켠다. 그 외 화면(진행 중, 방송캠/공추적)에서는
  // 탑뷰 OrbitControls의 "드래그=회전"이나 자동 추적 카메라와 겹쳐서 오히려 헷갈린다.
  let pathPlayer = null; // 지금 경로를 그리고 있는 대상(Sim의 Player 객체)
  let pathPoints = []; // 드래그로 누적한 필드 좌표들(첫 점 = 선수의 현재 위치)
  let isDrawingPath = false;

  function canDrawPath() {
    return paused && view && view.camMode === "top";
  }

  function onWindowPointerDown(e) {
    if (!canDrawPath()) return;
    // hud/sidepanel/controls가 stage와 형제 요소로 겹쳐 있어서, 화면 위치에 따라 클릭이
    // stage가 아니라 그 오버레이 쪽으로 먼저 잡힐 수 있다(형제라 버블링이 stage로 안 온다) —
    // 그래서 stage가 아니라 window에서 좌표만 보고 판단한다. 다만 시작점(target)이 애초에
    // 오버레이(버튼/패널/배너/다이얼로그) 위였다면 그건 필드 드래그가 아니라 그 UI를 조작하려던
    // 것이다 — 여기서 걸러내지 않으면 그 뒤에 서 있는 선수를 라인으로 잡아버려서(특히 터치에서는
    // pointerdown의 preventDefault가 뒤이은 click 자체를 삼켜버려) "버튼을 눌러도 안 먹는" 현상이 난다.
    if (!stage.contains(e.target)) return;
    const picked = view.pickPlayer(e.clientX, e.clientY);
    if (!picked || picked.team !== "home") return; // 우리 팀 선수만 지시할 수 있다
    pathPlayer = picked;
    pathPoints = [{ x: picked.x, z: picked.z }];
    isDrawingPath = true;
    view.setOrbitEnabled(false); // 드래그가 카메라 회전으로 새지 않게
    pathStatusEl.textContent = `#${picked.num} ${picked.name} 경로 지시 중 — 놓으면 확정됩니다`;
    e.preventDefault();
  }

  function onWindowPointerMove(e) {
    if (!isDrawingPath) return;
    const pt = view.screenToField(e.clientX, e.clientY);
    if (!pt) return;
    const lastPt = pathPoints[pathPoints.length - 1];
    // 너무 촘촘하게 찍으면 계산 낭비라 1.5m 간격으로 솎아낸다
    if (Math.hypot(pt.x - lastPt.x, pt.z - lastPt.z) > 1.5) {
      pathPoints.push(pt);
      // 선수 키로 그린다 — 다른 선수에게 이미 그려 둔 경로는 그대로 남는다.
      view.setPathPoints(`${pathPlayer.team}:${pathPlayer.idx}`, pathPoints);
    }
  }

  function onWindowPointerUp() {
    if (!isDrawingPath) return;
    isDrawingPath = false;
    view.setOrbitEnabled(true);
    if (pathPoints.length > 1 && pathPlayer) {
      sim.setCommand(`${pathPlayer.team}:${pathPlayer.idx}`, pathPoints.slice(1)); // 시작점(현재 위치) 제외
      // 몇 명에게 지시했는지 같이 보여 준다 — 선이 여러 개 남으니 그 수와 맞아야 헷갈리지 않는다.
      const commanded = sim.homeP.filter((p) => p.command).length;
      pathStatusEl.textContent =
        `#${pathPlayer.num} ${pathPlayer.name}에게 경로를 지시했습니다` +
        (commanded > 1 ? ` (총 ${commanded}명)` : "");
    } else if (pathPlayer) {
      // 그리다 말았으면(점이 하나뿐) 그 선수 선만 지운다. 다른 선수 경로는 남긴다.
      view.setPathPoints(`${pathPlayer.team}:${pathPlayer.idx}`, null);
      pathStatusEl.textContent = "";
    }
    pathPlayer = null;
  }

  // 탑뷰 + 드래그로 경로를 지시할 때 그라운드를 가리지 않도록 화면 상단에 붙인다(.pause-banner)
  const banner = el("div", { class: "banner pause-banner" }, [
    el("b", { text: "일시정지 — 지금 지시를 바꿀 수 있습니다" }),
    el("span", { text: "되감은 시점부터 새 전술로 경기가 다시 흘러갑니다." }),
  ]);

  // 대한민국 득점 순간에는 자동 정지한다. Sim은 이미 상대팀 킥오프 위치로 리셋된 상태이며,
  // 감독이 아래 버튼을 눌러야 다음 틱부터 경기가 다시 흐른다.
  const koreaGoalClock = el("span", { class: "korea-goal__clock", text: "" });
  const koreaGoalScorer = el("strong", { class: "korea-goal__scorer", text: "" });
  const koreaGoalScore = el("b", { class: "korea-goal__score", text: "" });
  const koreaGoalBanner = el("div", { class: "banner korea-goal-banner" }, [
    el("p", { class: "korea-goal__eyebrow" }, [
      CountryFlag({ teamId: "KOR", size: "small" }),
      el("span", { text: "KOREA REPUBLIC · GOAL" }),
    ]),
    el("h2", { text: "대한민국 GOAL!" }),
    koreaGoalScorer,
    koreaGoalScore,
    koreaGoalClock,
    el("button", {
      class: "primary korea-goal__resume",
      type: "button",
      text: "상대팀 킥오프로 재개 →",
      onclick: () => {
        koreaGoalPending = false;
        view?.sync(0);
        setPaused(false);
      },
    }),
  ]);

  // 실점 순간 "되돌릴지/진행할지" 명시적으로 묻는 배너 — 조용히 지나가지 않는다
  const concedeMoment = el("strong", { class: "concede-moment", text: "" });
  const concedeTarget = el("strong", { class: "concede-target", text: "" });
  const concedeTitle = el("b", { class: "concede-title" }, [
    concedeMoment,
    el("span", { text: " 실점했습니다" }),
  ]);
  const concedeSub = el("p", { class: "concede-sub" }, [
    el("span", { text: "시간을 " }),
    concedeTarget,
    el("span", { text: "으로 되돌려 전술을 다시 설계할 수 있습니다." }),
  ]);
  const concedeRewindBtn = el("button", {
    class: "ctl warn",
    text: "",
    onclick: () => {
      hideConcedeChoice();
      doRewind();
    },
  });
  const concedeContinueBtn = el("button", {
    class: "ctl",
    text: "▶ 이대로 진행",
    onclick: () => {
      hideConcedeChoice();
      setPaused(false);
    },
  });
  const concedeBanner = el("div", { class: "banner concede-banner" }, [
    el("span", { class: "concede-eyebrow", text: "⚠ GOAL CONCEDED · DECISION MOMENT" }),
    concedeTitle,
    concedeSub,
    el("div", { class: "concede-actions" }, [concedeRewindBtn, concedeContinueBtn]),
  ]);

  function hideConcedeChoice() {
    concedeChoicePending = false;
    updateBanners();
  }

  // 경기 종료 결과 화면 — 시작/후반 안내와 같은 모달 문법으로 팀과 큰 스코어를 보여 준다.
  const resultTitle = el("b", { class: "result-title", text: "" });
  const resultScore = el("strong", { class: "result-score", text: "" });
  const resultSub = el("span", { class: "result-sub", text: "" });
  const retryBtn = el("button", {
    class: "ctl warn",
    type: "button",
    text: "↻ 다시 시도",
    hidden: true,
    onclick: () => {
      if (!runStep) return;
      retryKoreaMatch(runStep.matchId);
      ctx.navigate("tactics");
    },
  });
  const advanceBtn = el("button", {
    class: "ctl primary-ctl",
    type: "button",
    text: "▶ 다음 경기 준비하기",
    hidden: true,
    onclick: () => ctx.navigate("lineup"),
  });
  const tournamentBtn = el("button", {
    class: "ctl",
    type: "button",
    text: "대회 화면으로",
    onclick: () => ctx.navigate("tournament"),
  });
  const resultDialog = el("dialog", {
    class: "kickoff-dialog match-result-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "match-result-title",
  }, [
    el("div", { class: "kickoff-dialog__inner" }, [
      el("header", { class: "kickoff-dialog__header" }, [
        el("p", { class: "kickoff-dialog__eyebrow", text: runStep?.eyebrow ?? "FINAL SCORE" }),
        el("h2", { id: "match-result-title", text: "경기 종료" }),
        resultTitle,
      ]),
      el("div", { class: "match-result-dialog__scoreboard" }, [
        el("div", { class: "match-result-dialog__team" }, [
          CountryFlag({ teamId: matchSetup.homeTeam.id, size: "large" }),
          el("strong", { text: teamName(matchSetup.homeTeam.id) }),
        ]),
        resultScore,
        el("div", { class: "match-result-dialog__team" }, [
          CountryFlag({ teamId: matchSetup.awayTeam.id, size: "large" }),
          el("strong", { text: teamName(matchSetup.awayTeam.id) }),
        ]),
      ]),
      resultSub,
      el("div", { class: "result-actions" }, [
      retryBtn,
      advanceBtn,
        tournamentBtn,
      ]),
    ]),
  ]);
  resultDialog.addEventListener("cancel", (event) => event.preventDefault());

  // Match 104 우승 전용 축하 화면. 경기 결과와 진행 상태는 finishMatch()가 확정하고,
  // 이 레이어는 그 결과를 표현만 한다.
  const championshipOpponentId = runStep?.opponentTeamId ?? matchSetup.awayTeam.id;
  const championshipScore = el("strong", { class: "championship-score", text: "" });
  const championshipConfetti = el("div", {
    class: "championship-confetti",
    "aria-hidden": "true",
  });
  const championshipFireworks = el("div", {
    class: "championship-fireworks",
    "aria-hidden": "true",
  });
  const championshipRecordBtn = el("button", {
    class: "championship-button championship-button--primary",
    type: "button",
    text: "우승 기록 보기 →",
    onclick: () => ctx.navigate("tournament"),
  });
  const championshipReplayBtn = el("button", {
    class: "championship-button",
    type: "button",
    text: "축하 연출 다시 보기",
    onclick: replayChampionshipEffects,
  });
  const managerCelebration = state.managerName
    ? el("p", {
        class: "championship-manager",
        text: `${state.managerName} 감독이 대한민국의 새로운 역사를 완성했습니다.`,
      })
    : null;
  const championshipDialog = el("dialog", {
    class: "championship-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "championship-title",
  }, [
    championshipFireworks,
    championshipConfetti,
    el("section", { class: "championship-card" }, [
      el("header", { class: "championship-header" }, [
        el("p", { class: "championship-eyebrow", text: "FINAL · MATCH 104" }),
        el("b", { class: "championship-world", text: "WORLD CHAMPIONS" }),
      ]),
      el("div", { class: "championship-trophy", "aria-hidden": "true" }, [
        el("span", { class: "championship-trophy__cup" }),
        el("span", { class: "championship-trophy__stem" }),
        el("span", { class: "championship-trophy__base" }),
      ]),
      el("h2", { id: "championship-title", text: "역사를 다시 썼습니다" }),
      el("div", { class: "championship-winner" }, [
        CountryFlag({ teamId: "KOR", size: "large" }),
        el("div", {}, [
          el("strong", { text: "대한민국" }),
          el("span", { text: "2026 월드 챔피언" }),
        ]),
      ]),
      el("div", { class: "championship-scoreboard" }, [
        el("div", { class: "championship-team" }, [
          CountryFlag({ teamId: "KOR", size: "medium" }),
          el("span", { text: "대한민국" }),
        ]),
        championshipScore,
        el("div", { class: "championship-team" }, [
          CountryFlag({ teamId: championshipOpponentId, size: "medium" }),
          el("span", { text: teamName(championshipOpponentId) }),
        ]),
      ]),
      el("p", { class: "championship-copy" }, [
        el("span", { text: "조별리그 탈락의 운명을 되돌리고" }),
        el("strong", { text: "대한민국이 세계 정상에 올랐습니다." }),
      ]),
      managerCelebration,
      el("div", { class: "championship-actions" }, [
        championshipRecordBtn,
        championshipReplayBtn,
      ]),
    ]),
  ]);

  const confettiPalette = ["#f7d774", "#ef3345", "#1877c9", "#fff1c1"];
  function createChampionshipConfetti() {
    return Array.from({ length: 52 }, (_, index) => {
      const left = (index * 37 + 7) % 100;
      const delay = ((index * 17) % 90) / 100;
      const duration = 3.2 + ((index * 13) % 22) / 10;
      const drift = ((index % 9) - 4) * 13;
      const size = 5 + (index % 5) * 2;
      return el("i", {
        class: "championship-confetti__piece",
        style: `--confetti-x:${left}%;--confetti-delay:${delay}s;--confetti-duration:${duration}s;--confetti-drift:${drift}px;--confetti-size:${size}px;--confetti-color:${confettiPalette[index % confettiPalette.length]}`,
      });
    });
  }

  function createChampionshipFireworks() {
    const bursts = [
      ["12%", "14%", "0s", "#f7d774"],
      ["86%", "18%", ".3s", "#ef3345"],
      ["50%", "5%", ".55s", "#fff1ad"],
      ["6%", "48%", ".8s", "#1877c9"],
      ["94%", "45%", "1.05s", "#f7d774"],
    ];
    return bursts.map(([left, top, delay, color]) =>
      el("i", {
        class: "championship-firework",
        style: `--firework-x:${left};--firework-y:${top};--firework-delay:${delay};--firework-color:${color}`,
      }),
    );
  }

  function clearChampionshipEffects() {
    window.clearTimeout(championEffectTimer);
    window.cancelAnimationFrame(championAnimationFrame);
    championEffectTimer = 0;
    championAnimationFrame = 0;
    championshipConfetti.replaceChildren();
    championshipFireworks.replaceChildren();
    championshipDialog.classList.remove("is-celebrating");
  }

  function replayChampionshipEffects() {
    clearChampionshipEffects();
    championshipConfetti.replaceChildren(...createChampionshipConfetti());
    championshipFireworks.replaceChildren(...createChampionshipFireworks());
    championAnimationFrame = window.requestAnimationFrame(() => {
      championshipDialog.classList.add("is-celebrating");
    });
    championEffectTimer = window.setTimeout(clearChampionshipEffects, 6000);
  }

  function openChampionshipCelebration() {
    championRevealTimer = 0;
    if (!championshipDialog.isConnected) document.body.append(championshipDialog);
    if (!championshipDialog.open) championshipDialog.showModal();
    championshipDialog.classList.add("is-visible");
    replayChampionshipEffects();
    championshipRecordBtn.focus();
  }

  const trapChampionshipFocus = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab") return;
    const first = championshipRecordBtn;
    const last = championshipReplayBtn;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  championshipDialog.addEventListener("cancel", (event) => event.preventDefault());
  championshipDialog.addEventListener("keydown", trapChampionshipFocus);

  // 경기 중 실시간 전술 변경 — 슬라이더는 네 값을 직접 미는 즉석 조정이다.
  // 감독이 짠 전술(수비 스타일·깊이·빌드업 …)을 통째로 바꾸는 건 아래 전술 패널이 한다.
  const liveTactics = ["lineHeight", "pressing", "tempo", "width"].map(
    (key) => {
      const label = {
        lineHeight: "라인",
        pressing: "압박",
        tempo: "템포",
        width: "폭",
      }[key];
      const input = el("input", {
        type: "range",
        min: "0",
        max: "100",
        value: String(Math.round(sim.tactics[key] * 100)),
        oninput: (e) => applyTactics({ [key]: Number(e.target.value) / 100 }),
      });
      const node = el("label", { class: "live-slider" }, [
        el("span", { text: label }),
        input,
      ]);
      return { key, input, node };
    },
  );

  // 지금 그라운드에 걸려 있는 전술. 되감기는 시계만 되돌리고 감독의 지시는 되돌리지 않는다 —
  // 되돌린 뒤 바꾼 전술이 다시 옛 값으로 돌아가면 "되감아서 미래를 바꾼다"가 성립하지 않는다.
  let livePlan = { ...sim.tactics };

  /** 전술 변경의 단 하나의 경로 — 시뮬레이션 적용, 슬라이더 동기화, 앱 상태 저장을 함께 한다. */
  function applyTactics(partial) {
    livePlan = { ...livePlan, ...partial };
    sim.applyTactics(livePlan);
    syncTacticSliders();
    // 경기 중에 내린 지시는 경기 뒤에도 남는다. 다음 경기가 옛 값으로 시작하지 않게 한다.
    setState({ tactics: { ...livePlan } });
  }

  function syncTacticSliders() {
    liveTactics.forEach(({ key, input }) => {
      input.value = String(Math.round(livePlan[key] * 100));
    });
  }

  // 경기 화면 안에서 여는 전술 패널. 전술 화면으로 나갔다 오지 않아도 되고,
  // 값을 만지는 즉시 그라운드에 반영된다.
  const tacticsPanel = createLiveTacticsPanel({
    onApply: (tactics) => applyTactics(tactics),
    onClose: () => closeTacticsPanel(),
  });

  let resumeAfterTactics = false;

  function openTacticsPanel() {
    if (tacticsPanel.isOpen) return;
    closeSubPanel(); // 두 패널이 같은 자리에 뜨므로 겹치지 않게 하나만 연다
    // 전술을 고르는 동안 경기가 흘러가면 손댈 틈이 없다. 열면 멈추고, 닫으면 원래대로 돌아간다.
    resumeAfterTactics = !paused && sim.phase === "playing";
    tacticsPanel.open();
    tacticsBtn.classList.add("on");
    if (resumeAfterTactics) setPaused(true);
  }

  function closeTacticsPanel() {
    if (!tacticsPanel.isOpen) return;
    tacticsPanel.close();
    tacticsBtn.classList.remove("on");
    if (resumeAfterTactics) {
      resumeAfterTactics = false;
      setPaused(false);
    }
  }

  const tacticsBtn = el("button", {
    class: "ctl",
    text: "⚙ 전술 지시",
    onclick: () => (tacticsPanel.isOpen ? closeTacticsPanel() : openTacticsPanel()),
  });

  // 경기 중 선수 교체 — 홈만 감독이 직접 조작한다(전술과 같은 비대칭). 부상으로 강제로
  // 빠진 선수도, 그냥 체력 관리 차원의 교체도 같은 패널·같은 sim.substitute() 경로를 쓴다.
  const subCountEl = el("b", { text: `0/${PARAMS.maxSubsPerTeam}` });
  const subListEl = el("div", { class: "lt-body" });
  let resumeAfterSub = false;

  function renderSubPanel() {
    subCountEl.textContent = `${sim.subsUsed.home}/${PARAMS.maxSubsPerTeam}`;
    const subsLeft = sim.subsUsed.home < PARAMS.maxSubsPerTeam;
    const bench = [...sim.homeBench.entries()];
    subListEl.replaceChildren(
      ...sim.homeP.map((p) => {
        const label = `#${p.num} ${p.name} · 체력 ${Math.round(p.energy * 100)}%${p.injured ? " · 부상" : ""}`;
        if (p.sentOff) {
          return el("div", { class: "row" }, [el("span", { text: label }), el("span", { text: "퇴장" })]);
        }
        if (!subsLeft || !bench.length) {
          return el("div", { class: "row" }, [el("span", { text: label })]);
        }
        const select = el(
          "select",
          {},
          bench.map(([id, meta]) => el("option", { value: id, text: `#${meta.num} ${meta.name}` }))
        );
        return el("div", { class: "row" }, [
          el("span", { text: label, style: p.injured ? { color: "#ff8a92" } : {} }),
          select,
          el("button", {
            class: "ctl",
            type: "button",
            text: "교체",
            onclick: () => {
              if (sim.substitute("home", p.idx, select.value)) renderSubPanel();
            },
          }),
        ]);
      })
    );
  }

  const subPanel = el("aside", { class: "live-tactics", hidden: true }, [
    el("div", { class: "lt-head" }, [
      el("div", {}, [el("span", { class: "lt-eyebrow", text: "선수 교체" }), subCountEl]),
      el("button", { class: "lt-close", type: "button", text: "✕", "aria-label": "교체 창 닫기", onclick: () => closeSubPanel() }),
    ]),
    subListEl,
    el("div", { class: "lt-foot" }, [el("span", { class: "lt-note", text: "벤치 선수를 골라 교체합니다 · 팀당 최대 3회" })]),
  ]);

  function openSubPanel() {
    if (!subPanel.hidden) return;
    closeTacticsPanel(); // 두 패널이 같은 자리에 뜨므로 겹치지 않게 하나만 연다
    resumeAfterSub = !paused && sim.phase === "playing";
    if (resumeAfterSub) setPaused(true);
    renderSubPanel();
    subPanel.hidden = false;
    subBtn.classList.add("on");
  }

  function closeSubPanel() {
    if (subPanel.hidden) return;
    subPanel.hidden = true;
    subBtn.classList.remove("on");
    if (resumeAfterSub) {
      resumeAfterSub = false;
      setPaused(false);
    }
  }

  const subBtn = el("button", {
    class: "ctl",
    text: "🔄 선수 교체",
    onclick: () => (subPanel.hidden ? openSubPanel() : closeSubPanel()),
  });

  // 재생 배속 — 시뮬레이션 계산 내용은 그대로, 실제 시간 대비 소비 속도만 바뀐다
  const speedButtons = [1, 2, 3].map((v) => {
    const btn = el("button", {
      class: `ctl${v === speed ? " on" : ""}`,
      text: `${v}x`,
      onclick: () => setSpeed(v),
    });
    return { value: v, btn };
  });

  const camButtons = Object.entries(CAM_MODES).map(([k, label]) =>
    el("button", {
      class: `ctl${k === "broadcast" ? " on" : ""}`,
      text: label,
      onclick: (e) => {
        view.setCam(k);
        camEl.textContent = label;
        e.currentTarget.parentElement
          .querySelectorAll(".ctl")
          .forEach((b) => b.classList.remove("on"));
        e.currentTarget.classList.add("on");
      },
    }),
  );

  // 같은 유형·같은 팀의 사건이 이 틱 수 안에 다시 나면 새 줄을 추가하지 않고 기존 줄에
  // "×N"을 붙인다 — 스로인 스크럼블처럼 실제로 연달아 나는 사건까지 막을 필요는 없지만,
  // 화면에 줄이 우르르 쏟아지는 건 행동로그의 목적(뭐가 있었는지 한눈에 훑기)에 안 맞는다.
  const FEED_MERGE_WINDOW_TICKS = 180; // 3 game-minute 스케일(≈ 실시간 3초)

  function eventNode(ev) {
    const text = ev.count > 1 ? `${ev.text} ×${ev.count}` : ev.text;
    return el("li", { class: `ev ${ev.team}` }, [
      el("span", { class: "evmin", text: `${ev.minute}'` }),
      el("span", { text }),
    ]);
  }

  /** sim.events(원본, 병합 없음)를 화면에 그릴 묶음 단위로 접는다 — 되감기로 피드를 통째로
   * 다시 그릴 때 실시간 누적(appendFeedEvent)과 같은 규칙을 쓰기 위한 공용 로직이다. */
  function buildFeedRows(events) {
    const rows = [];
    for (const ev of events) {
      const prev = rows[rows.length - 1];
      if (prev && prev.type === ev.type && prev.team === ev.team && ev.tick - prev.tick <= FEED_MERGE_WINDOW_TICKS) {
        prev.tick = ev.tick;
        prev.minute = ev.minute;
        prev.count += 1;
      } else {
        rows.push({ ...ev, count: 1 });
      }
    }
    return rows;
  }

  /** 실시간 루프에서 새 사건 하나를 피드에 반영 — 직전 줄과 같은 묶음이면 그 줄을 갱신하고,
   * 아니면 새 줄을 맨 위에 얹는다. */
  function appendFeedEvent(ev) {
    if (
      lastFeedMeta &&
      lastFeedMeta.type === ev.type &&
      lastFeedMeta.team === ev.team &&
      ev.tick - lastFeedMeta.tick <= FEED_MERGE_WINDOW_TICKS
    ) {
      lastFeedMeta.tick = ev.tick;
      lastFeedMeta.count += 1;
      lastFeedLi.querySelector(".evmin").textContent = `${ev.minute}'`;
      lastFeedLi.querySelector("span:last-child").textContent = `${ev.text} ×${lastFeedMeta.count}`;
      return;
    }
    lastFeedMeta = { type: ev.type, team: ev.team, tick: ev.tick, count: 1 };
    lastFeedLi = eventNode(ev);
    feed.prepend(lastFeedLi);
  }

  /**
   * 득점/실점 감지 — 대한민국 득점은 상대 킥오프 전 축하 화면에서 멈추고, 실점은 되돌릴지
   * 선택할 수 있도록 멈춘다. 어느 쪽이든 배너보다 세리머니가 먼저다.
   * sim.events는 50개를 넘으면 앞에서부터 shift되므로 배열 인덱스가 아니라 id로 추적한다.
   */
  function detectGoalEvents(newEvents) {
    for (const ev of newEvents) {
      if (ev.type === "goal" && ev.team === "home" && ev.tick !== lastNotifiedKoreaGoalTick) {
        lastNotifiedKoreaGoalTick = ev.tick;
        startCelebration("home", () => showKoreaGoal(ev));
        return;
      }
      if (ev.type === "goal" && ev.team === "away" && ev.tick !== lastNotifiedConcedeTick) {
        lastNotifiedConcedeTick = ev.tick;
        startCelebration("away", () => showConcedeChoice(ev));
        return;
      }
    }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const real = (now - last) / 1000;
    last = now;
    // 이번 프레임에 새로 생긴 사건 — 골 감지(세리머니)와 아래 이벤트 피드가 같이 쓴다.
    let newEvents = [];

    // 세리머니는 경기가 멈춘 상태에서 도는 연출이라, sim.step()과 별개로 매 프레임 진행한다.
    if (celebration) {
      tickCelebration(now);
      view.sync(real);
    }

    if (matchPhase === 'playing' && !paused && sim.phase !== "fulltime") {
      acc += Math.min(real, 0.1) * speed;
      let stepsThisFrame = 0;
      const MAX_STEPS_PER_FRAME = 6; // 브라우저가 못 따라갈 때 안전장치 (최대 배속 3x 기준)
      while (acc >= PARAMS.dt && stepsThisFrame < MAX_STEPS_PER_FRAME) {
        sim.step();
        rewind.maybeRecord(sim);
        acc -= PARAMS.dt;
        stepsThisFrame++;
      }
      newEvents = sim.events.filter((ev) => ev.id > lastRenderedEventId);
      // 골 감지는 view.sync()보다 **먼저** 한다. sim은 골이 들어간 그 틱에 곧바로 kickoff()으로
      // 선수를 대형에 되돌리므로, 먼저 sync하면 리그가 그 좌표를 따라가 세리머니가 중앙선에서
      // 벌어진다. 여기서 세리머니를 켜 두면 리그가 골 순간의 좌표를 유지한다.
      detectGoalEvents(newEvents);
      if (!celebration) view.sync(real);
    }
    view.render();

    if (sim.phase !== lastPhase) {
      lastPhase = sim.phase;
      if (sim.phase === "halftime") {
        setPaused(true);
        openKickoffBriefing('secondHalf');
      }
      else if (sim.phase === "fulltime") finishMatch();
      else updateBanners();
    }

    updateScoreboard();
    clockEl.textContent = formatTickClock(sim.tick);
    updateRewindButton();
    const o = sim.playerByKey(sim.ball.ownerKey);
    possEl.textContent = o
      ? `${o.team === "home" ? homeCode : awayCode} #${o.num} ${o.name}`
      : "경합 중";
    const outfield = sim.homeP.filter((p) => p.role !== "GK" && !p.sentOff);
    const avgDistanceM = outfield.reduce((s, p) => s + p.distanceRun, 0) / Math.max(1, outfield.length);
    distEl.textContent = `${(avgDistanceM / 1000).toFixed(1)}km`;

    for (const ev of newEvents) appendFeedEvent(ev);
    if (newEvents.length) lastRenderedEventId = newEvents[newEvents.length - 1].id;

    fpsN++;
    fpsT += real;
    if (fpsT >= 0.5) {
      fpsEl.textContent = String(Math.round(fpsN / fpsT));
      fpsN = 0;
      fpsT = 0;
    }
  }

  const onKey = (e) => {
    if (matchPhase === 'kickoffBriefing') return;
    if (e.key === " ") {
      e.preventDefault();
      setPaused(!paused);
    }
    if (e.key.toLowerCase() === "r") doRewind();
    if (e.key.toLowerCase() === "t") {
      // 전술 창은 입력 중(이름 등)이 아닐 때만 단축키로 연다
      if (e.target instanceof HTMLInputElement) return;
      tacticsPanel.isOpen ? closeTacticsPanel() : openTacticsPanel();
    }
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);

  const teamCard = (side,isKorea) => {
    const country = countries[side.teamId];
    return el('article',{class:`kickoff-team${isKorea?' is-korea':''}`},[
      isKorea ? el('b',{class:'kickoff-team__badge',text:'내 팀'}) : null,
      CountryFlag({teamId:side.teamId,size:'large'}),
      el('h3',{text:country?.nameKo ?? side.code}),
      el('div',{
        class:'kickoff-shirt',
        role:'img',
        'aria-label':`${country?.nameKo ?? side.code} ${side.uniformLabel} 유니폼`,
        style:`--uniform-color:${side.uniformColor}`,
      }),
      el('strong',{class:'kickoff-team__color',text:`${side.uniformLabel} 팀`}),
      el('span',{class:'kickoff-team__label',text:side.teamLabel}),
    ]);
  };
  const startMatchBtn = el('button',{
    class:'primary kickoff-dialog__start',
    type:'button',
    text:'경기 시작 →',
  });
  const briefingEyebrow = el('p',{class:'kickoff-dialog__eyebrow'});
  const briefingTitle = el('h2',{id:'kickoff-dialog-title'});
  const briefingDescription = el('p');
  const briefingTeams = el('div',{class:'kickoff-dialog__teams'});
  const briefingNotice = el('p',{class:'kickoff-dialog__notice'});
  const guideCards = [
    {
      number:'01', icon:'◉', title:'원하는 시점으로 경기를 읽으세요',
      description:'하단 카메라 버튼으로 경기 중에도 시점을 즉시 변경할 수 있습니다.',
      features:[['방송캠','실제 중계처럼 경기 전체 흐름 보기','camera-active'],['탑뷰','선수 간격과 공간을 한눈에 파악','camera'],['공 추적','공을 중심으로 결정적인 장면 따라가기','camera']],
      tip:'상황을 읽을 때는 탑뷰, 흐름을 즐길 때는 방송캠을 추천합니다.',
    },
    {
      number:'02', icon:'↗', title:'드래그로 진출 방향을 직접 지시하세요',
      description:'선수 한 명의 움직임을 감독이 직접 설계할 수 있습니다.',
      features:[['Ⅱ 일시정지','경기를 일시정지합니다','pause'],['탑뷰','카메라를 탑뷰로 변경합니다','camera-active'],['↗ 선수 드래그','대한민국 선수를 원하는 방향으로 드래그한 뒤 놓습니다','gesture']],
      tip:'그려진 경로는 재개하는 순간 반영됩니다. 우리 팀 선수에게만 지시할 수 있습니다.',
    },
    {
      number:'03', icon:'⏪', title:'실점했다면 운명을 되돌리세요',
      description:'실점 직후에만 되감기를 선택할 수 있고, 한 경기에서 최대 2회 사용할 수 있습니다.',
      features:[['⏪ 되돌리기','실점 전 장면으로 시간을 되돌립니다','rewind'],['⚙ 전술 지시','되감은 뒤 T 또는 전술 버튼으로 전략 변경','tactics'],['↗ 경로 지시','탑뷰 드래그 경로까지 바꾼 뒤 재개','gesture']],
      tip:'같은 전술로 재개하면 같은 위기가 반복될 수 있습니다. 반드시 다른 선택을 만들어 보세요.',
    },
    {
      number:'04', icon:'⚙', title:'경기의 속도와 전술을 장악하세요',
      description:'경기는 언제든 멈추고, 속도와 전술을 실시간으로 조정할 수 있습니다.',
      features:[['Space · Ⅱ','일시정지 또는 경기 재개','pause'],['1×  2×  3×','원하는 경기 진행 속도 선택','speed'],['⚙ 전술 지시','라이브 전술 패널 열기 또는 닫기','tactics']],
      tip:'후반전에는 진영과 골대가 바뀌며 스코어보드의 국가 위치도 함께 전환됩니다.',
    },
  ];
  const guideProgress = el('div',{class:'match-guide__progress'});
  const guideCard = el('article',{class:'match-guide__card','aria-live':'polite'});
  const guidePrevBtn = el('button',{class:'ctl match-guide__nav',type:'button',text:'← 이전'});
  const guideNextBtn = el('button',{class:'primary match-guide__next',type:'button',text:'다음 →'});
  const guidePanel = el('section',{class:'match-guide'},[
    guideProgress,
    guideCard,
    el('div',{class:'match-guide__actions'},[guidePrevBtn,guideNextBtn]),
  ]);
  const kickoffDialog = el('dialog',{
    class:'kickoff-dialog',
    role:'dialog',
    'aria-modal':'true',
    'aria-labelledby':'kickoff-dialog-title',
  },[
    el('div',{class:'kickoff-dialog__inner'},[
      el('header',{class:'kickoff-dialog__header'},[
        briefingEyebrow,
        briefingTitle,
        briefingDescription,
      ]),
      guidePanel,
      briefingTeams,
      briefingNotice,
      startMatchBtn,
    ]),
  ]);
  const trapKickoffFocus = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }
  };
  kickoffDialog.addEventListener('cancel',(event)=>event.preventDefault());
  kickoffDialog.addEventListener('keydown',trapKickoffFocus);
  let briefingKind = 'firstHalf';
  let briefingConfirming = false;
  let guideIndex = 0;
  let showingGuide = false;

  function renderGuideCard() {
    const card = guideCards[guideIndex];
    guideProgress.replaceChildren(...guideCards.map((_,index)=>el('span',{
      class:index===guideIndex?'is-active':'',
      text:String(index+1).padStart(2,'0'),
    })));
    guideCard.replaceChildren(
      el('div',{class:'match-guide__card-head'},[
        el('span',{class:'match-guide__number',text:`GUIDE ${card.number}`}),
        el('span',{class:'match-guide__icon','aria-hidden':'true',text:card.icon}),
      ]),
      el('h3',{text:card.title}),
      el('p',{class:'match-guide__description',text:card.description}),
      el('div',{class:'match-guide__features'},card.features.map(([label,text,kind])=>
        el('div',{class:'match-guide__feature'},[
          el('span',{
            class:`ctl match-guide__control match-guide__control--${kind}`,
            'aria-hidden':'true',
            text:label,
          }),
          el('span',{text}),
        ]),
      )),
      el('p',{class:'match-guide__tip'},[
        el('b',{text:'COACH TIP'}),
        el('span',{text:card.tip}),
      ]),
    );
    guidePrevBtn.disabled = guideIndex === 0;
    guideNextBtn.textContent = guideIndex === guideCards.length-1 ? '경기 정보 확인 →' : '다음 →';
  }

  function showMatchBriefing(secondHalf) {
    showingGuide = false;
    guidePanel.hidden = true;
    briefingTeams.hidden = false;
    briefingNotice.hidden = false;
    startMatchBtn.hidden = false;
    briefingEyebrow.textContent = secondHalf ? 'GROUP A · MATCH 54 · SECOND HALF' : 'GROUP A · MATCH 54';
    briefingTitle.textContent = secondHalf ? '후반전이 곧 시작됩니다' : '경기가 곧 시작됩니다';
    briefingDescription.textContent = secondHalf
      ? '후반전에는 양 팀의 진영과 골대 위치가 서로 바뀝니다.'
      : '양 팀의 유니폼 색상을 확인한 뒤 경기를 시작하세요.';
    startMatchBtn.focus();
  }

  guidePrevBtn.addEventListener('click',()=>{
    if (guideIndex === 0) return;
    guideIndex--;
    renderGuideCard();
    guidePrevBtn.focus();
  });
  guideNextBtn.addEventListener('click',()=>{
    if (guideIndex < guideCards.length-1) {
      guideIndex++;
      renderGuideCard();
      guideNextBtn.focus();
      return;
    }
    showMatchBriefing(false);
  });

  function openKickoffBriefing(kind) {
    briefingKind = kind;
    briefingConfirming = false;
    const secondHalf = kind === 'secondHalf';
    matchPhase = secondHalf ? 'halftimeBriefing' : 'kickoffBriefing';
    paused = true;
    const leftSide = secondHalf ? matchSides.away : matchSides.home;
    const rightSide = secondHalf ? matchSides.home : matchSides.away;
    briefingTeams.replaceChildren(
      teamCard(leftSide,leftSide.teamId==='KOR'),
      el('strong',{class:'kickoff-dialog__versus',text:'VS'}),
      teamCard(rightSide,rightSide.teamId==='KOR'),
    );
    briefingNotice.textContent = secondHalf
      ? `골대 위치가 바뀝니다. 대한민국은 오른쪽 진영의 ${koreaSide?.uniformLabel ?? ''} 팀입니다.`
      : koreaSide
        ? `대한민국은 왼쪽 진영의 ${koreaSide.uniformLabel} 팀입니다.`
        : '대한민국의 유니폼 색상을 확인하세요.';
    startMatchBtn.textContent = secondHalf ? '후반 시작 →' : '경기 시작 →';
    if (secondHalf) {
      showMatchBriefing(true);
    } else {
      showingGuide = true;
      guideIndex = 0;
      briefingEyebrow.textContent = 'HOW TO CHANGE HISTORY';
      briefingTitle.textContent = '경기 운영 가이드';
      briefingDescription.textContent = '네 장의 카드를 넘기며 감독이 사용할 수 있는 기능을 확인하세요.';
      guidePanel.hidden = false;
      briefingTeams.hidden = true;
      briefingNotice.hidden = true;
      startMatchBtn.hidden = true;
      renderGuideCard();
    }
    if (!kickoffDialog.isConnected) document.body.append(kickoffDialog);
    if (!kickoffDialog.open) kickoffDialog.showModal();
    (showingGuide ? guideNextBtn : startMatchBtn).focus();
  }
  startMatchBtn.addEventListener('click',()=>{
    if (briefingConfirming) return;
    briefingConfirming = true;
    if (briefingKind === 'secondHalf') {
      sim.startSecondHalf({ swapEnds:true });
      updateScoreboard();
      view.sync(0);
    }
    matchPhase = 'playing';
    paused = false;
    kickoffDialog.close();
    last = performance.now();
    updateBanners();
    pauseBtn.focus();
  });

  root.append(
    el("div", { class: "screen match", "data-match-tag": runStep?.eyebrow ?? "FRIENDLY MATCH" }, [
      stage,
      goalFlash,
      banner,
      koreaGoalBanner,
      concedeBanner,
      el("div", { class: "hud" }, [
        scoreEl,
        el("div", { class: "row" }, [
          el("span", { text: "경기 시간" }),
          clockEl,
        ]),
        el("div", { class: "row" }, [el("span", { text: "공 소유" }), possEl]),
        el("div", { class: "row" }, [el("span", { text: "평균 주행거리" }), distEl]),
        el("div", { class: "row" }, [el("span", { text: "카메라" }), camEl]),
        el("div", { class: "row" }, [
          el("span", { text: "남은 되감기" }),
          rewindEl,
        ]),
        el("div", { class: "row" }, [el("span", { text: "FPS" }), fpsEl]),
      ]),
      el("div", { class: "sidepanel" }, [
        el("b", {
          class: "panel-title",
          text: `${state.managerName || "감독"}의 지시`,
        }),
        ...liveTactics.map((t) => t.node),
        el("b", { class: "panel-title", text: "재생 속도" }),
        el(
          "div",
          { class: "speed-row" },
          speedButtons.map((s) => s.btn),
        ),
        el("b", { class: "panel-title", text: "경기 기록" }),
        feed,
      ]),
      tacticsPanel.node,
      subPanel,
      el("div", { class: "bottom-bar" }, [
        pathStatusEl,
        el("p", { class: "hint" }, [
          el("span", {
            text: "탑뷰에서 드래그=회전 / 휠=줌 · Space=일시정지 · T=전술 · R=되감기 · 일시정지+탑뷰에서 우리 선수 드래그=경로 지시",
          }),
        ]),
        el("div", { class: "controls" }, [
          ...camButtons,
          el("span", { class: "sep" }),
          pauseBtn,
          rewindBtn,
          tacticsBtn,
          subBtn,
        ]),
      ]),
    ]),
  );

  // 화면을 떠날 때 반드시 루프와 WebGL 컨텍스트를 정리한다
  const cleanup = () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(championRevealTimer);
    clearChampionshipEffects();
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("pointerdown", onWindowPointerDown);
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    kickoffDialog.removeEventListener('keydown',trapKickoffFocus);
    championshipDialog.removeEventListener("keydown", trapChampionshipFocus);
    championshipDialog.classList.remove("is-visible");
    kickoffDialog.remove();
    resultDialog.remove();
    championshipDialog.remove();
    view?.dispose();
  };

  try {
    view = createMatchView(stage, sim, captainNum);
  } catch (err) {
    // WebGL을 못 쓰는 환경(구형 기기·GPU 차단·컨텍스트 한도 초과)에서 WebGLRenderer는 던진다.
    // 여기서 그대로 던지면 router가 root를 이미 비운 뒤라 사용자에게는 백지만 남고, 이 화면의
    // cleanup도 등록되지 않아 keydown 리스너가 영영 안 떨어진다. 위 '경기를 시작할 수 없습니다'와
    // 같은 방식으로 되돌아갈 길을 준다.
    stage.append(
      el('div', { class: 'screen page' }, [
        el('h2', { class: 'h2', text: '3D 경기 화면을 열 수 없습니다' }),
        el('p', {
          class: 'lead small',
          text: `이 브라우저·기기에서 WebGL을 사용할 수 없습니다. (${err.message})`,
        }),
        el('button', {
          class: 'primary',
          type: 'button',
          text: '전술 설정으로',
          onclick: () => ctx.navigate('tactics', undefined, { replace: true }),
        }),
      ])
    );
    return cleanup;
  }

  view.sync(0);
  openKickoffBriefing('firstHalf');
  last = performance.now();
  raf = requestAnimationFrame(loop);

  return cleanup;
}
