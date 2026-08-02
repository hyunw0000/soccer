import { el } from "../../shared/index.js";
import { state } from "../../app/public.js";
import {
  PARAMS,
  createSimulation,
  RewindBuffer,
} from "../../simulation/index.js";
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
      // 재개하면 경로 지시 UI 흔적을 정리한다 — 이미 내려진 지시(sim.command) 자체는 그대로 진행된다
      pathStatusEl.textContent = "";
      view?.setPathPoints(null);
    }
    updateBanners();
  }

  // 일시정지 배너와 전/후반 배너는 동시에 뜨지 않는다 — phase가 playing일 때만 일시정지 배너를 쓴다
  function updateBanners() {
    banner.classList.toggle("show", paused && sim.phase === "playing");
    phaseBanner.classList.toggle("show", sim.phase !== "playing");
    updateSpeedButtons();
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
      phaseTitle.textContent = "경기 종료";
      phaseSub.textContent = `최종 스코어 KOR ${sim.score.home} : ${sim.score.away} WLD`;
      phaseBanner.replaceChildren(phaseTitle, phaseSub);
    }
  }

  // 실점 이벤트 시각을 "68:22" 형태로 — ev.minute(분)에 clockSeconds 소수부(초)를 붙인다
  function formatEventClock(ev) {
    const clockSeconds = ev.tick * PARAMS.dt;
    const sec = Math.floor((clockSeconds - ev.minute) * 60);
    return `${ev.minute}:${String(sec).padStart(2, "0")}`;
  }

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
        : `⏪ ${formatEventClock(concede)} 실점 직전으로`;
    rewindBtn.disabled = rewindsLeft <= 0 || !sim.canRewind();
  }

  function doRewind() {
    if (rewindsLeft <= 0) return;
    if (!sim.canRewind()) return;
    const targetTick = sim.getRewindTargetTick();
    if (targetTick === null) return; // canRewind()가 true면 항상 있어야 하지만 방어적으로
    const snap = rewind.findNearestTick(targetTick);
    if (!snap) return;
    sim.restore(snap);
    sim.markRewindUsed();
    rewindsLeft--;
    rewindEl.textContent = `${rewindsLeft}회`;
    renderedEvents = Math.min(renderedEvents, sim.events.length);
    feed.replaceChildren(...[...sim.events].map(eventNode));
    liveTactics.forEach(({ key, input }) => {
      input.value = String(Math.round(sim.tactics[key] * 100));
    });
    if (sim.phase !== lastPhase) {
      lastPhase = sim.phase;
      renderPhaseBanner();
    }
    view.sync(0);
    setPaused(true);
    updateRewindButton();
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

  // 경기 중 실시간 전술 변경
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
        oninput: (e) =>
          sim.applyTactics({ [key]: Number(e.target.value) / 100 }),
      });
      const node = el("label", { class: "live-slider" }, [
        el("span", { text: label }),
        input,
      ]);
      return { key, input, node };
    },
  );

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
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);

  root.append(
    el("div", { class: "screen match" }, [
      stage,
      banner,
      phaseBanner,
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
        el("button", {
          class: "ctl",
          text: "전술 변경 ↩",
          onclick: () => ctx.navigate("tactics"),
        }),
      ]),
      el("p", { class: "hint" }, [
        el("span", {
          text: "탑뷰에서 드래그=회전 / 휠=줌 · Space=일시정지 · R=되감기 · 일시정지+탑뷰에서 우리 선수 드래그=경로 지시",
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
