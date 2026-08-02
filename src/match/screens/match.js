import { el } from "../../shared/index.js";
import { state } from "../../app/public.js";
import {
  PARAMS,
  createSimulation,
  RewindBuffer,
} from "../../simulation/index.js";
import { createMatchView, CAM_MODES } from "../render3d/index.js";

const REWIND_SECONDS = 8;
const REWIND_LIMIT = 3; // 감독의 '되감기'는 유한한 자원이다 — 이 서비스의 규칙

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

  let paused = false;
  let rewindsLeft = REWIND_LIMIT;
  let acc = 0;
  let last = performance.now();
  let fpsT = 0;
  let fpsN = 0;
  let raf = 0;
  let renderedEvents = 0;
  let lastPhase = sim.phase;
  let speed = 1; // 1 | 2 | 4 — 재생 배속(UI 상태). Sim/RewindBuffer에는 저장하지 않는다.

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
    text: `↶ ${REWIND_SECONDS}초 되감기`,
    onclick: doRewind,
  });

  function setPaused(v) {
    // 하프타임/풀타임 중에는 '후반 시작' 버튼 없이 일반 재개로 넘어갈 수 없다
    if (!v && sim.phase !== "playing") return;
    paused = v;
    pauseBtn.textContent = paused ? "▶ 재개" : "⏸ 일시정지";
    pauseBtn.classList.toggle("on", paused);
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

  function doRewind() {
    if (rewindsLeft <= 0) return;
    const snap = rewind.rewind(REWIND_SECONDS);
    if (!snap) return;
    sim.restore(snap);
    rewindsLeft--;
    rewindEl.textContent = `${rewindsLeft}회`;
    rewindBtn.disabled = rewindsLeft <= 0;
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
  const speedButtons = [1, 2, 4].map((v) => {
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
      const MAX_STEPS_PER_FRAME = 8; // 브라우저가 못 따라갈 때 안전장치
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
          text: "탑뷰에서 드래그=회전 / 휠=줌 · Space=일시정지 · R=되감기",
        }),
      ]),
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
    view.dispose();
  };
}
