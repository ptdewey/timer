/* Timer & Stopwatch — no dependencies, all timing is timestamp-based so
 * backgrounded tabs don't accumulate drift. */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  const pad = (n, len = 2) => String(n).padStart(len, "0");

  /** 65_000 -> "01:05" , 3_725_000 -> "1:02:05" */
  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  /** 65_430 -> "01:05.43" , with hours when needed */
  function formatStopwatch(ms) {
    const t = Math.max(0, ms);
    const h = Math.floor(t / 3_600_000);
    const m = Math.floor((t % 3_600_000) / 60_000);
    const s = Math.floor((t % 60_000) / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return h > 0
      ? `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`
      : `${pad(m)}:${pad(s)}.${pad(cs)}`;
  }

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /* ------------------------------------------------------------------ */
  /* beep                                                                */
  /* ------------------------------------------------------------------ */

  let audioCtx = null;

  function primeAudio() {
    if (audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }

  function beep(times = 3) {
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();

    const start = audioCtx.currentTime;
    for (let i = 0; i < times; i++) {
      const t = start + i * 0.28;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === times - 1 ? 1046 : 784;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    }
  }

  /* ================================================================== */
  /* TIMER                                                               */
  /* ================================================================== */

  const timerEls = {
    pane: document.querySelector(".pane--timer"),
    ring: $("timer-ring"),
    display: $("timer-display"),
    status: $("timer-status"),
    toggle: $("timer-toggle"),
    reset: $("timer-reset"),
    hours: $("timer-hours"),
    minutes: $("timer-minutes"),
    seconds: $("timer-seconds"),
    form: $("timer-config"),
    presets: document.querySelectorAll("[data-preset]"),
  };

  const timer = {
    total: 5 * 60 * 1000, // full duration of the current setting
    remaining: 5 * 60 * 1000, // ms left
    deadline: 0, // performance.now() target while running
    running: false,
    finished: false,
    rafId: 0,
    timeoutId: 0,
  };

  function readConfig() {
    const h = clamp(parseInt(timerEls.hours.value, 10) || 0, 0, 99);
    const m = clamp(parseInt(timerEls.minutes.value, 10) || 0, 0, 59);
    const s = clamp(parseInt(timerEls.seconds.value, 10) || 0, 0, 59);
    return ((h * 60 + m) * 60 + s) * 1000;
  }

  function writeConfig(ms) {
    const total = Math.round(ms / 1000);
    timerEls.hours.value = Math.floor(total / 3600);
    timerEls.minutes.value = Math.floor((total % 3600) / 60);
    timerEls.seconds.value = total % 60;
  }

  function renderTimer() {
    timerEls.display.textContent = formatClock(timer.remaining);
    const progress = timer.total > 0 ? timer.remaining / timer.total : 0;
    timerEls.ring.style.setProperty("--progress", progress.toFixed(4));

    timerEls.pane.classList.toggle("is-running", timer.running);
    timerEls.pane.classList.toggle("is-finished", timer.finished);

    timerEls.toggle.textContent = timer.running
      ? "Pause"
      : timer.finished || timer.remaining <= 0
        ? "Restart"
        : timer.remaining < timer.total
          ? "Resume"
          : "Start";

    timerEls.status.textContent = timer.finished
      ? "time's up"
      : timer.running
        ? "running"
        : timer.remaining < timer.total
          ? "paused"
          : "ready";

    // config is locked while running or paused mid-countdown, but editable again
    // once the timer has finished (picking a new duration re-arms it)
    const locked = timer.running || (timer.remaining < timer.total && timer.remaining > 0);
    for (const input of [timerEls.hours, timerEls.minutes, timerEls.seconds]) {
      input.disabled = locked;
    }
    for (const chip of timerEls.presets) {
      chip.disabled = timer.running;
      chip.setAttribute("aria-pressed", String(timer.total === Number(chip.dataset.preset) * 1000));
    }

    updateTitle();
    renderBoth();
  }

  function updateTitle() {
    if (timer.running) {
      document.title = `${formatClock(timer.remaining)} · Timer`;
    } else if (timer.finished) {
      document.title = "Time's up!";
    } else {
      document.title = "Timer & Stopwatch";
    }
  }

  function timerTick() {
    if (!timer.running) return;
    timer.remaining = Math.max(0, timer.deadline - performance.now());

    if (timer.remaining <= 0) {
      finishTimer();
      return;
    }

    renderTimer();
    timer.rafId = requestAnimationFrame(timerTick);
  }

  function startTimer() {
    const now = performance.now();

    if (timer.finished || timer.remaining <= 0) {
      timer.remaining = timer.total;
      timer.finished = false;
    }
    if (timer.remaining <= 0) return; // zero-length timer, nothing to run

    primeAudio();
    timer.deadline = now + timer.remaining;
    timer.running = true;

    cancelAnimationFrame(timer.rafId);
    timer.rafId = requestAnimationFrame(timerTick);

    // backup so the alarm still fires if rAF is throttled in a hidden tab
    clearTimeout(timer.timeoutId);
    timer.timeoutId = setTimeout(() => {
      if (timer.running) finishTimer();
    }, timer.remaining);

    renderTimer();
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.remaining = Math.max(0, timer.deadline - performance.now());
    timer.running = false;
    cancelAnimationFrame(timer.rafId);
    clearTimeout(timer.timeoutId);
    renderTimer();
  }

  function stopTimer() {
    timer.running = false;
    timer.finished = false;
    cancelAnimationFrame(timer.rafId);
    clearTimeout(timer.timeoutId);
  }

  function finishTimer() {
    timer.remaining = 0;
    timer.running = false;
    timer.finished = true;
    cancelAnimationFrame(timer.rafId);
    clearTimeout(timer.timeoutId);
    beep(3);
    renderTimer();

    // drop the "finished" state once the user is done looking at it
    setTimeout(() => {
      if (!timer.running && timer.finished) {
        timer.finished = false;
        renderTimer();
      }
    }, 60_000);
  }

  function resetTimer() {
    stopTimer();
    timer.total = readConfig();
    if (timer.total <= 0) timer.total = 5 * 60 * 1000;
    timer.remaining = timer.total;
    writeConfig(timer.total);
    renderTimer();
  }

  function applyConfig() {
    if (timer.running) return;
    timer.total = readConfig();
    timer.remaining = timer.total;
    timer.finished = false;
    renderTimer();
  }

  timerEls.toggle.addEventListener("click", () => {
    timer.running ? pauseTimer() : startTimer();
  });

  timerEls.reset.addEventListener("click", resetTimer);

  timerEls.form.addEventListener("submit", (e) => e.preventDefault());

  for (const input of [timerEls.hours, timerEls.minutes, timerEls.seconds]) {
    input.addEventListener("input", applyConfig);
    input.addEventListener("blur", () => {
      input.value = clamp(parseInt(input.value, 10) || 0, Number(input.min), Number(input.max));
      applyConfig();
    });
  }

  for (const chip of timerEls.presets) {
    chip.addEventListener("click", () => {
      if (timer.running) return;
      stopTimer();
      writeConfig(Number(chip.dataset.preset) * 1000);
      applyConfig();
    });
  }

  /* ================================================================== */
  /* STOPWATCH                                                           */
  /* ================================================================== */

  const swEls = {
    pane: document.querySelector(".pane--stopwatch"),
    display: $("stopwatch-display"),
    status: $("stopwatch-status"),
    toggle: $("stopwatch-toggle"),
    lap: $("stopwatch-lap"),
    reset: $("stopwatch-reset"),
    laps: $("stopwatch-laps"),
  };

  const sw = {
    elapsed: 0, // accumulated ms across pauses
    startedAt: 0, // performance.now() when the current run began
    running: false,
    laps: [], // { total, split }
    rafId: 0,
  };

  function swNow() {
    return sw.running ? sw.elapsed + (performance.now() - sw.startedAt) : sw.elapsed;
  }

  function renderStopwatch() {
    swEls.display.textContent = formatStopwatch(swNow());
    swEls.pane.classList.toggle("is-running", sw.running);

    swEls.toggle.textContent = sw.running ? "Pause" : sw.elapsed > 0 ? "Resume" : "Start";
    swEls.status.textContent = sw.running ? "running" : sw.elapsed > 0 ? "paused" : "ready";
    swEls.lap.disabled = !sw.running && sw.elapsed === 0;
    renderBoth();
  }

  function swTick() {
    if (!sw.running) return;
    swEls.display.textContent = formatStopwatch(swNow());
    sw.rafId = requestAnimationFrame(swTick);
  }

  function startStopwatch() {
    if (sw.running) return;
    primeAudio();
    sw.startedAt = performance.now();
    sw.running = true;
    cancelAnimationFrame(sw.rafId);
    sw.rafId = requestAnimationFrame(swTick);
    renderStopwatch();
  }

  function pauseStopwatch() {
    if (!sw.running) return;
    sw.elapsed = swNow();
    sw.running = false;
    cancelAnimationFrame(sw.rafId);
    renderStopwatch();
  }

  function resetStopwatch() {
    cancelAnimationFrame(sw.rafId);
    sw.running = false;
    sw.elapsed = 0;
    sw.startedAt = 0;
    sw.laps = [];
    renderLaps();
    renderStopwatch();
  }

  function addLap() {
    const total = swNow();
    if (total <= 0) return;
    const prev = sw.laps.length ? sw.laps[sw.laps.length - 1].total : 0;
    sw.laps.push({ total, split: total - prev });
    renderLaps();
  }

  function renderLaps() {
    swEls.laps.innerHTML = "";

    if (!sw.laps.length) return;

    // highlight the fastest split when there are at least two
    let bestIndex = -1;
    if (sw.laps.length > 1) {
      bestIndex = sw.laps.reduce(
        (best, lap, i) => (lap.split < sw.laps[best].split ? i : best),
        0,
      );
      const min = sw.laps[bestIndex].split;
      // don't crown a lap if every split is identical
      if (sw.laps.every((l) => l.split === min)) bestIndex = -1;
    }

    const frag = document.createDocumentFragment();
    sw.laps.forEach((lap, i) => {
      const li = document.createElement("li");
      if (i === bestIndex) li.classList.add("is-best");

      const label = document.createElement("span");
      label.textContent = `Lap ${i + 1}`;

      const splitEl = document.createElement("span");
      const split = document.createElement("span");
      split.textContent = formatStopwatch(lap.split);
      const total = document.createElement("span");
      total.textContent = `  ${formatStopwatch(lap.total)}`;
      total.style.opacity = "0.45";
      splitEl.append(split, total);

      li.append(label, splitEl);
      frag.append(li);
    });

    swEls.laps.append(frag);
  }

  swEls.toggle.addEventListener("click", () => {
    sw.running ? pauseStopwatch() : startStopwatch();
  });
  swEls.reset.addEventListener("click", resetStopwatch);
  swEls.lap.addEventListener("click", addLap);

  /* ------------------------------------------------------------------ */
  /* start / pause both                                                  */
  /* ------------------------------------------------------------------ */

  const bothEls = { button: $("both-toggle") };

  function renderBoth() {
    const running = timer.running && sw.running;
    bothEls.button.classList.toggle("is-running", running);
    bothEls.button.setAttribute("aria-label", running ? "Pause both clocks" : "Start both clocks");
    bothEls.button.title = running ? "Pause both (B)" : "Start both (B)";
  }

  function toggleBoth() {
    if (timer.running && sw.running) {
      pauseTimer();
      pauseStopwatch();
    } else {
      // whatever is already running keeps running; the rest starts
      if (!timer.running) startTimer();
      if (!sw.running) startStopwatch();
    }
    renderBoth();
  }

  bothEls.button.addEventListener("click", toggleBoth);

  /* ================================================================== */
  /* APPEARANCE                                                          */
  /* ================================================================== */

  const STORAGE_KEY = "timer-appearance";
  const HEX = /^#[0-9a-f]{6}$/i;

  const DEFAULTS = {
    timerColor: "#f0a03c",
    stopwatchColor: "#51c7d4",
    theme: "system",
  };

  const SWATCHES = [
    "#f0a03c", "#f2688a", "#a78bfa", "#5b9cf8",
    "#51c7d4", "#4ade80", "#a3e635", "#e2e8f0",
  ];

  const appearance = { ...DEFAULTS };
  const root = document.documentElement;
  const darkQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  const setEls = {
    dock: $("settings-dock"),
    toggle: $("settings-toggle"),
    panel: $("settings-panel"),
    close: $("settings-close"),
    reset: $("settings-reset"),
    timerColor: $("timer-color"),
    stopwatchColor: $("stopwatch-color"),
    timerSwatches: $("timer-swatches"),
    stopwatchSwatches: $("stopwatch-swatches"),
    themeChoices: document.querySelectorAll("[data-theme-choice]"),
  };

  /** WCAG relative luminance, used to pick readable text on a custom accent */
  function channel(v) {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }

  function luminance(hex) {
    return (
      0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
      0.7152 * channel(parseInt(hex.slice(3, 5), 16)) +
      0.0722 * channel(parseInt(hex.slice(5, 7), 16))
    );
  }

  /** near-black or white, whichever contrasts more with `hex` */
  function readableOn(hex) {
    const l = luminance(hex);
    const onDark = (l + 0.05) / 0.0539; // #0b0d12
    const onLight = 1.05 / (l + 0.05); // #ffffff
    return onDark >= onLight ? "#0b0d12" : "#ffffff";
  }

  function applyTheme() {
    const resolved =
      appearance.theme === "light" || appearance.theme === "dark"
        ? appearance.theme
        : darkQuery && darkQuery.matches
          ? "dark"
          : "light";
    root.dataset.theme = resolved;
  }

  function applyColors() {
    // a value left at its default defers to the theme's own palette
    if (appearance.timerColor.toLowerCase() === DEFAULTS.timerColor) {
      root.style.removeProperty("--timer");
    } else {
      root.style.setProperty("--timer", appearance.timerColor);
    }

    if (appearance.stopwatchColor.toLowerCase() === DEFAULTS.stopwatchColor) {
      root.style.removeProperty("--stopwatch");
    } else {
      root.style.setProperty("--stopwatch", appearance.stopwatchColor);
    }

    // recompute readable text against whatever the palette resolved to
    const cs = getComputedStyle(root);
    const timerHex = cs.getPropertyValue("--timer").trim();
    const swHex = cs.getPropertyValue("--stopwatch").trim();
    root.style.setProperty(
      "--on-timer",
      readableOn(HEX.test(timerHex) ? timerHex : DEFAULTS.timerColor),
    );
    root.style.setProperty(
      "--on-stopwatch",
      readableOn(HEX.test(swHex) ? swHex : DEFAULTS.stopwatchColor),
    );
  }

  function loadAppearance() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return; // storage blocked or corrupt: keep the defaults
    }
    if (!saved || typeof saved !== "object") return;

    if (typeof saved.timerColor === "string" && HEX.test(saved.timerColor)) {
      appearance.timerColor = saved.timerColor;
    }
    if (typeof saved.stopwatchColor === "string" && HEX.test(saved.stopwatchColor)) {
      appearance.stopwatchColor = saved.stopwatchColor;
    }
    if (saved.theme === "system" || saved.theme === "dark" || saved.theme === "light") {
      appearance.theme = saved.theme;
    }
  }

  function saveAppearance() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      /* private mode / quota: settings just won't persist */
    }
  }

  const swatchButtons = { timerColor: [], stopwatchColor: [] };

  function buildSwatches(container, key) {
    for (const color of SWATCHES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.style.setProperty("--swatch", color);
      button.setAttribute("aria-label", `Use ${color}`);
      button.addEventListener("click", () => {
        appearance[key] = color;
        commitAppearance();
      });
      container.append(button);
      swatchButtons[key].push(button);
    }
  }

  function syncAppearance() {
    setEls.timerColor.value = appearance.timerColor;
    setEls.stopwatchColor.value = appearance.stopwatchColor;

    for (const key of Object.keys(swatchButtons)) {
      swatchButtons[key].forEach((button, i) => {
        const active = SWATCHES[i].toLowerCase() === appearance[key].toLowerCase();
        button.setAttribute("aria-pressed", String(active));
      });
    }

    for (const choice of setEls.themeChoices) {
      choice.setAttribute(
        "aria-pressed",
        String(choice.dataset.themeChoice === appearance.theme),
      );
    }
  }

  function commitAppearance() {
    applyTheme();
    applyColors();
    syncAppearance();
    saveAppearance();
  }

  function setPanelOpen(open) {
    setEls.panel.hidden = !open;
    setEls.toggle.setAttribute("aria-expanded", String(open));
    setEls.dock.classList.toggle("is-open", open);
    (open ? setEls.close : setEls.toggle).focus();
  }

  setEls.toggle.addEventListener("click", () => setPanelOpen(setEls.panel.hidden));
  setEls.close.addEventListener("click", () => setPanelOpen(false));

  setEls.reset.addEventListener("click", () => {
    Object.assign(appearance, DEFAULTS);
    commitAppearance();
  });

  setEls.timerColor.addEventListener("input", () => {
    if (!HEX.test(setEls.timerColor.value)) return;
    appearance.timerColor = setEls.timerColor.value.toLowerCase();
    applyColors();
    syncAppearance();
    saveAppearance();
  });

  setEls.stopwatchColor.addEventListener("input", () => {
    if (!HEX.test(setEls.stopwatchColor.value)) return;
    appearance.stopwatchColor = setEls.stopwatchColor.value.toLowerCase();
    applyColors();
    syncAppearance();
    saveAppearance();
  });

  for (const choice of setEls.themeChoices) {
    choice.addEventListener("click", () => {
      appearance.theme = choice.dataset.themeChoice;
      commitAppearance();
    });
  }

  // click outside the dock closes the panel
  document.addEventListener("click", (e) => {
    if (setEls.panel.hidden) return;
    if (setEls.dock.contains?.(e.target)) return;
    setPanelOpen(false);
  });

  if (darkQuery && typeof darkQuery.addEventListener === "function") {
    darkQuery.addEventListener("change", () => {
      if (appearance.theme !== "system") return;
      applyTheme();
      applyColors();
    });
  }

  /* ------------------------------------------------------------------ */
  /* keyboard shortcuts                                                  */
  /* ------------------------------------------------------------------ */

  document.addEventListener("keydown", (e) => {
    if (!setEls.panel.hidden) {
      if (e.key === "Escape") setPanelOpen(false);
      return; // the panel is open: leave the clocks alone
    }

    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "t" || e.key === "T") {
      timer.running ? pauseTimer() : startTimer();
    } else if (e.key === "s" || e.key === "S") {
      sw.running ? pauseStopwatch() : startStopwatch();
    } else if (e.key === "l" || e.key === "L") {
      if (sw.running) addLap();
    } else if (e.key === "b" || e.key === "B") {
      toggleBoth();
    } else if (e.key === "r" || e.key === "R") {
      resetTimer();
      resetStopwatch();
    }
  });

  /* ------------------------------------------------------------------ */
  /* init                                                                */
  /* ------------------------------------------------------------------ */

  // a timer that was left running in a hidden tab should resync on return
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (timer.running) timerTick();
      if (sw.running) swTick();
    }
  });

  loadAppearance();
  applyTheme();
  buildSwatches(setEls.timerSwatches, "timerColor");
  buildSwatches(setEls.stopwatchSwatches, "stopwatchColor");
  applyColors();
  syncAppearance();

  resetTimer();
  renderStopwatch();

  // release the boot guard once the initial state has been painted
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove("booting"));
  });
  setTimeout(() => root.classList.remove("booting"), 300);
})();
