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
  const camEl = el("b", { text: CAM_MODES.broadcast });
  const fpsEl = el("b", { text: "-" });
  const rewindEl = el("b", { text: `${REWIND_LIMIT}회` });
  const feed = el("ul", { class: "feed" });
  const pathStatusEl = el("span", { class: "path-status" });

  let matchPhase = 'kickoffBriefing';
  let paused = true;
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
  let matchResult = null; // fulltime 결과 기록. null인 동안만 경기 루프와 되감기를 허용한다.

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
    if (!v && (sim.phase !== "playing" || matchPhase !== 'playing')) return;
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

  // 일시정지/실점 선택 배너는 동시에 뜨지 않는다. 경기 결과는 별도 모달로 표시한다.
  function updateBanners() {
    const finished = matchResult !== null;
    banner.classList.toggle("show", !finished && paused && sim.phase === "playing" && !concedeChoicePending);
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

    resultDialog.dataset.outcome = outcome;
    resultTitle.textContent =
      outcome === "win" ? "승리" : outcome === "draw" ? "무승부" : "패배";
    resultScore.textContent = `${koreaScore} : ${opponentScore}`;

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

  // 탑뷰 + 드래그로 경로를 지시할 때 그라운드를 가리지 않도록 화면 상단에 붙인다(.pause-banner)
  const banner = el("div", { class: "banner pause-banner" }, [
    el("b", { text: "일시정지 — 지금 지시를 바꿀 수 있습니다" }),
    el("span", { text: "되감은 시점부터 새 전술로 경기가 다시 흘러갑니다." }),
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
      view.sync(real);
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

    updateScoreboard();
    clockEl.textContent = formatTickClock(sim.tick);
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
    if (event.key === 'Tab') {
      event.preventDefault();
      startMatchBtn.focus();
    }
  };
  kickoffDialog.addEventListener('cancel',(event)=>event.preventDefault());
  kickoffDialog.addEventListener('keydown',trapKickoffFocus);
  let briefingKind = 'firstHalf';
  let briefingConfirming = false;
  function openKickoffBriefing(kind) {
    briefingKind = kind;
    briefingConfirming = false;
    const secondHalf = kind === 'secondHalf';
    matchPhase = secondHalf ? 'halftimeBriefing' : 'kickoffBriefing';
    paused = true;
    briefingEyebrow.textContent = secondHalf ? 'GROUP A · MATCH 54 · SECOND HALF' : 'GROUP A · MATCH 54';
    briefingTitle.textContent = secondHalf ? '후반전이 곧 시작됩니다' : '경기가 곧 시작됩니다';
    briefingDescription.textContent = secondHalf
      ? '후반전에는 양 팀의 진영과 골대 위치가 서로 바뀝니다.'
      : '양 팀의 유니폼 색상을 확인한 뒤 경기를 시작하세요.';
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
    if (!kickoffDialog.isConnected) document.body.append(kickoffDialog);
    if (!kickoffDialog.open) kickoffDialog.showModal();
    startMatchBtn.focus();
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
      banner,
      concedeBanner,
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
  openKickoffBriefing('firstHalf');
  last = performance.now();
  raf = requestAnimationFrame(loop);

  // 화면을 떠날 때 반드시 루프와 WebGL 컨텍스트를 정리한다
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("pointerdown", onWindowPointerDown);
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    kickoffDialog.removeEventListener('keydown',trapKickoffFocus);
    kickoffDialog.remove();
    resultDialog.remove();
    view.dispose();
  };
}
