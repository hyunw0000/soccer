import { countries, el } from "../../shared/index.js";
import { gameProgress, recordKoreaMatch, retryKoreaMatch, setState, state } from "../../app/public.js";
import {
  PARAMS,
  createSimulation,
  RewindBuffer,
} from "../../simulation/index.js";
import { createLiveTacticsPanel } from "../../tactics/index.js";
import { createMatchView, CAM_MODES } from "../render3d/index.js";

const REWIND_LIMIT = 2; // 감독의 '되감기'는 유한한 자원이다 — 이 서비스의 규칙
const REWIND_IDLE_LABEL = "↶ 실점 시에만 되감기 가능"; // 겨냥할 실점이 없을 때(대기 상태)

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
  // 지금 치르는 대회 경기. 결과를 어디에 기록할지, 이기면 어디로 가는지가 여기서 나온다.
  // 전술 화면이 만든 상대와 어긋나면 기록하지 않는다 — 엉뚱한 라운드에 점수가 남지 않게.
  const runStepCandidate = gameProgress().activeStep;
  const runStep = runStepCandidate?.opponentTeamId === matchSetup.awayTeam.id ? runStepCandidate : null;
  const captainNum =
    matchSetup.homeTeam.players.find((p) => p.id === matchSetup.homeTeam.lineup.captainId)?.num ?? null;

  sim.kickoff({ kickoffTeam: 'home' }); // 시작 시 양팀이 동시에 공으로 몰려드는 문제 방지

  const rewind = new RewindBuffer();

  const stage = el("div", { class: "stage" });
  const scoreEl = el("div", {
    class: "score",
    text: `${homeCode} 0 : 0 ${awayCode}`,
  });
  const clockEl = el("b", { text: "0'" });
  const possEl = el("b", { text: "-" });
  const camEl = el("b", { text: CAM_MODES.broadcast });
  const fpsEl = el("b", { text: "-" });
  const rewindEl = el("b", { text: `${REWIND_LIMIT}회` });
  const feed = el("ul", { class: "feed" });
  const pathStatusEl = el("span", { class: "path-status" });

  let paused = false;
  let matchResult = null; // 경기 종료 후에만 채워진다 — 결과 화면이 떠 있다는 뜻이기도 하다
  let concedeChoicePending = false; // 실점 직후 "되돌릴지/진행할지" 명시적으로 물어보는 중인지
  let lastNotifiedConcedeTick = null; // 같은 실점에 배너를 두 번 띄우지 않으려는 표시
  let rewindsLeft = REWIND_LIMIT;
  let acc = 0;
  let last = performance.now();
  let fpsT = 0;
  let fpsN = 0;
  let raf = 0;
  let renderedEvents = 0;
  let lastPhase = sim.phase;
  let speed = 1; // 1 | 2 | 3 — 재생 배속(UI 상태). Sim/RewindBuffer에는 저장하지 않는다.

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

  function setPaused(v) {
    // 하프타임/풀타임 중에는 '후반 시작' 버튼 없이 일반 재개로 넘어갈 수 없다
    if (!v && sim.phase !== "playing") return;
    paused = v;
    pauseBtn.textContent = paused ? "▶ 재개" : "⏸ 일시정지";
    pauseBtn.classList.toggle("on", paused);
    if (!paused) {
      // 어떤 경로(버튼/스페이스바)로 재개하든 실점 선택 배너는 닫힌다 — 재개 = "이대로 진행"
      concedeChoicePending = false;
      // 재개하면 경로 지시 UI 흔적을 정리한다 — 이미 내려진 지시(sim.command) 자체는 그대로 진행된다
      pathStatusEl.textContent = "";
      view?.setPathPoints(null);
    }
    updateBanners();
  }

  // 배너 네 개(일시정지/전후반/실점 선택/경기 결과)는 동시에 뜨지 않는다 —
  // 경기 결과가 가장 우선이고, 그 다음이 실점 선택이다.
  function updateBanners() {
    const finished = matchResult !== null;
    banner.classList.toggle("show", !finished && paused && sim.phase === "playing" && !concedeChoicePending);
    phaseBanner.classList.toggle("show", !finished && sim.phase !== "playing" && !concedeChoicePending);
    concedeBanner.classList.toggle("show", !finished && concedeChoicePending);
    resultBanner.classList.toggle("show", finished);
    updateSpeedButtons();
  }

  // 실점한 그 순간 자동으로 멈추고 "되돌릴지/진행할지"를 명시적으로 물어본다 —
  // 그냥 흘러가게 두면 되감기 기능이 있는 의미가 없다.
  function showConcedeChoice(ev) {
    concedeChoicePending = true;
    concedeTitle.textContent = `${formatEventClock(ev)} 실점했습니다`;
    concedeSub.textContent = `되돌리면 ${formatTickClock(sim.getRewindTargetTick() ?? ev.tick)}으로 돌아가 전술을 다시 짤 수 있습니다.`;
    concedeRewindBtn.textContent = `⏪ 되돌리기 (${rewindsLeft}회 남음)`;
    concedeRewindBtn.disabled = rewindsLeft <= 0 || !sim.canRewind();
    setPaused(true); // setPaused가 updateBanners()를 호출해 concedeBanner도 같이 뜬다
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

  function renderPhaseBanner() {
    if (sim.phase === "halftime") {
      phaseTitle.textContent = "전반 종료";
      phaseSub.textContent =
        "후반 시작을 누르면 원정팀 킥오프로 다시 시작합니다.";
      phaseBanner.replaceChildren(phaseTitle, phaseSub, secondHalfBtn);
    } else if (sim.phase === "fulltime") {
      finishMatch();
    }
  }

  const teamName = (teamId) => countries[teamId]?.nameKo ?? teamId;

  /**
   * 경기 종료 — 결과를 대회 진행에 기록하고 결과 화면을 띄운다.
   * 이 게임의 규칙상 이겨야만 다음 라운드가 열린다. 무승부와 패배는 똑같이 탈락이고,
   * 그 자리에서 바로 다시 시도할 수 있다.
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

    resultBanner.dataset.outcome = outcome;
    resultTitle.textContent =
      outcome === "win" ? "승리" : outcome === "draw" ? "무승부" : "패배";
    resultScore.textContent = `${homeCode} ${koreaScore} : ${opponentScore} ${awayCode}`;

    const nextStep = progress?.nextStep ?? null;
    if (!runStep) {
      resultSub.textContent = "이 경기는 대회 기록에 반영되지 않습니다.";
    } else if (progress?.status === "champion") {
      resultSub.textContent = "우승! 대한민국이 2026 월드 챔피언십을 들어 올렸습니다.";
    } else if (outcome === "win" && nextStep) {
      resultSub.textContent = runStep.stage === "group"
        ? `A조 2위로 32강에 진출했습니다. 다음 상대는 ${teamName(nextStep.opponentTeamId)}입니다.`
        : `${runStep.advanceLabel}에 진출했습니다. 다음 상대는 ${teamName(nextStep.opponentTeamId)}입니다.`;
    } else {
      resultSub.textContent = `${runStep.roundLabel}에서 탈락했습니다. 이 대회에서는 무승부도 패배와 같습니다.`;
    }

    const canRetry = Boolean(runStep) && outcome !== "win";
    const canAdvance = outcome === "win" && Boolean(nextStep);
    retryBtn.hidden = !canRetry;
    advanceBtn.hidden = !canAdvance;
    if (canAdvance) advanceBtn.textContent = `▶ ${nextStep.roundLabel} 준비하기`;

    setPaused(true);
    updateBanners();
  }

  // tick을 "68:22"(분:초) 형태로 — 1 clockSecond = 게임 1분 스케일이다
  function formatTickClock(tick) {
    const clockSeconds = tick * PARAMS.dt;
    const minute = Math.floor(clockSeconds);
    const sec = Math.floor((clockSeconds - minute) * 60);
    return `${minute}:${String(sec).padStart(2, "0")}`;
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
    const snap = rewind.findNearestTick(targetTick);
    if (!snap) return;
    concedeChoicePending = false; // R키로 바로 되감아도 실점 선택 배너는 닫아야 한다
    sim.restore(snap);
    sim.markRewindUsed();
    rewindsLeft--;
    rewindEl.textContent = `${rewindsLeft}회`;
    renderedEvents = Math.min(renderedEvents, sim.events.length);
    feed.replaceChildren(...[...sim.events].map(eventNode));
    // 스냅샷에는 되감은 시점의 전술이 들어 있다. 시계는 되돌리되 감독의 지시는 지금 것을 유지한다.
    sim.applyTactics(livePlan);
    syncTacticSliders();
    if (sim.phase !== lastPhase) {
      lastPhase = sim.phase;
      renderPhaseBanner();
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
    // 그래서 stage가 아니라 window에서 좌표만 보고 판단한다.
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
      view.setPathPoints(pathPoints);
    }
  }

  function onWindowPointerUp() {
    if (!isDrawingPath) return;
    isDrawingPath = false;
    view.setOrbitEnabled(true);
    if (pathPoints.length > 1 && pathPlayer) {
      sim.setCommand(`${pathPlayer.team}:${pathPlayer.idx}`, pathPoints.slice(1)); // 시작점(현재 위치) 제외
      pathStatusEl.textContent = `#${pathPlayer.num} ${pathPlayer.name}에게 경로를 지시했습니다`;
    } else {
      pathStatusEl.textContent = "";
    }
    pathPlayer = null;
  }

  const banner = el("div", { class: "banner" }, [
    el("b", { text: "일시정지 — 지금 지시를 바꿀 수 있습니다" }),
    el("span", { text: "되감은 시점부터 새 전술로 경기가 다시 흘러갑니다." }),
  ]);

  // 전/후반 전환 배너 — 일시정지 배너와 구분되는 별도 배너
  const secondHalfBtn = el("button", {
    class: "ctl",
    text: "▶ 후반 시작",
    onclick: () => {
      sim.startSecondHalf();
      setPaused(false);
      view.sync(0);
    },
  });
  const phaseTitle = el("b", { text: "" });
  const phaseSub = el("span", { text: "" });
  const phaseBanner = el("div", { class: "banner phase-banner" }, [
    phaseTitle,
    phaseSub,
  ]);

  // 실점 순간 "되돌릴지/진행할지" 명시적으로 묻는 배너 — 조용히 지나가지 않는다
  const concedeTitle = el("b", { text: "" });
  const concedeSub = el("span", { text: "" });
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
    concedeTitle,
    concedeSub,
    el("div", { class: "concede-actions" }, [concedeRewindBtn, concedeContinueBtn]),
  ]);

  function hideConcedeChoice() {
    concedeChoicePending = false;
    updateBanners();
  }

  // 경기 종료 결과 화면 — 승/무/패와 그 결과가 대회에서 뜻하는 바를 함께 보여 준다
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
  const resultBanner = el("div", { class: "banner result-banner" }, [
    resultTitle,
    resultScore,
    resultSub,
    el("div", { class: "result-actions" }, [
      retryBtn,
      advanceBtn,
      el("button", {
        class: "ctl",
        type: "button",
        text: "대회 화면으로",
        onclick: () => ctx.navigate("tournament"),
      }),
    ]),
  ]);

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

  function eventNode(ev) {
    return el("li", { class: `ev ${ev.team}` }, [
      el("span", { class: "evmin", text: `${ev.minute}'` }),
      el("span", { text: ev.text }),
    ]);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const real = (now - last) / 1000;
    last = now;

    if (!paused && sim.phase !== "fulltime") {
      acc += Math.min(real, 0.1) * speed;
      let stepsThisFrame = 0;
      const MAX_STEPS_PER_FRAME = 6; // 브라우저가 못 따라갈 때 안전장치 (최대 배속 3x 기준)
      while (acc >= PARAMS.dt && stepsThisFrame < MAX_STEPS_PER_FRAME) {
        sim.step();
        rewind.maybeRecord(sim);
        acc -= PARAMS.dt;
        stepsThisFrame++;
      }
      view.sync(real);
    }
    view.render();

    if (sim.phase !== lastPhase) {
      lastPhase = sim.phase;
      renderPhaseBanner();
      if (sim.phase === "halftime") setPaused(true);
      else updateBanners();
    }

    // 실점 감지 — 방금 돈 틱들 사이에 우리 팀 실점이 새로 생겼으면 자동 정지하고 선택을 받는다.
    // 그냥 지나가면 되감기 기능이 있는 의미가 없다.
    for (let i = renderedEvents; i < sim.events.length; i++) {
      const ev = sim.events[i];
      if (ev.type === "goal" && ev.team === "away" && ev.tick !== lastNotifiedConcedeTick) {
        lastNotifiedConcedeTick = ev.tick;
        showConcedeChoice(ev);
        break;
      }
    }

    scoreEl.textContent = `${homeCode} ${sim.score.home} : ${sim.score.away} ${awayCode}`;
    clockEl.textContent = `${sim.matchMinute}'`;
    updateRewindButton();
    const o = sim.playerByKey(sim.ball.ownerKey);
    possEl.textContent = o
      ? `${o.team === "home" ? homeCode : awayCode} #${o.num} ${o.name}`
      : "경합 중";

    while (renderedEvents < sim.events.length)
      feed.prepend(eventNode(sim.events[renderedEvents++]));

    fpsN++;
    fpsT += real;
    if (fpsT >= 0.5) {
      fpsEl.textContent = String(Math.round(fpsN / fpsT));
      fpsN = 0;
      fpsT = 0;
    }
  }

  const onKey = (e) => {
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

  root.append(
    el("div", { class: "screen match", "data-match-tag": runStep?.eyebrow ?? "FRIENDLY MATCH" }, [
      stage,
      banner,
      phaseBanner,
      concedeBanner,
      resultBanner,
      el("div", { class: "hud" }, [
        scoreEl,
        el("div", { class: "row" }, [
          el("span", { text: "경기 시간" }),
          clockEl,
        ]),
        el("div", { class: "row" }, [el("span", { text: "공 소유" }), possEl]),
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
      el("div", { class: "controls" }, [
        ...camButtons,
        el("span", { class: "sep" }),
        pauseBtn,
        rewindBtn,
        el("button", {
          class: "ctl",
          text: "↺ 킥오프",
          onclick: () => {
            sim.kickoff();
            view.sync(0);
          },
        }),
        tacticsBtn,
      ]),
      tacticsPanel.node,
      el("p", { class: "hint" }, [
        el("span", {
          text: "탑뷰에서 드래그=회전 / 휠=줌 · Space=일시정지 · T=전술 · R=되감기 · 일시정지+탑뷰에서 우리 선수 드래그=경로 지시",
        }),
      ]),
      pathStatusEl,
    ]),
  );

  view = createMatchView(stage, sim, captainNum);
  view.sync(0);
  last = performance.now();
  raf = requestAnimationFrame(loop);

  // 화면을 떠날 때 반드시 루프와 WebGL 컨텍스트를 정리한다
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("pointerdown", onWindowPointerDown);
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    view.dispose();
  };
}
