  const REALTIME_TINT_PREF = "zia.toolbar.realtime-tint";
  const REALTIME_SAMPLE_MS = 100;
  const REALTIME_SMOOTH_MS = 250;
  const realtimeColors = new WeakMap();
  let realtimeTimer = 0;
  let realtimeFrame = 0;
  let realtimeSampling = false;
  let realtimeEpoch = 0;
  let realtimeLastSample = -Infinity;
  let realtimeStopped = false;

  const realtimeTintOn = () => siteColorOn() && Services.prefs.getBoolPref(REALTIME_TINT_PREF, false);
  const realtimeVisible = () => !document.hidden &&
    !(window.STATE_MINIMIZED !== undefined && window.windowState === window.STATE_MINIMIZED);

  function realtimeState(browser) {
    const state = realtimeColors.get(browser);
    return state?.windowGlobal === browser?.browsingContext?.currentWindowGlobal ? state : null;
  }

  function realtimeCachedColor(browser) {
    return realtimeTintOn() ? realtimeState(browser)?.shown.map(Math.round) : null;
  }

  // Keep fractional channels between frames, so small changes can accumulate.
  // The time-based coefficient makes smoothing independent of frame rate.
  function smoothRealtimeColor(shown, target, elapsed) {
    const amount = 1 - Math.exp(-Math.max(0, elapsed) / REALTIME_SMOOTH_MS);
    return target.map((value, i) => shown[i] + (value - shown[i]) * amount);
  }

  function paintRealtimeTint(now) {
    realtimeFrame = 0;
    const browser = gBrowser.selectedBrowser;
    const state = realtimeState(browser);
    if (realtimeStopped || !realtimeTintOn() || !realtimeVisible() || !state ||
        isLoading(browser) || isErrorPage(browser)) {
      return;
    }
    state.shown = smoothRealtimeColor(state.shown, state.target, now - state.paintedAt);
    state.paintedAt = now;
    const settled = state.shown.every((value, i) => Math.abs(value - state.target[i]) < 0.5);
    if (settled) state.shown = state.target.slice();
    applyColor(state.shown.map(Math.round));
    if (!settled) realtimeFrame = requestAnimationFrame(paintRealtimeTint);
  }

  function queueRealtimePaint(state) {
    if (!realtimeFrame) {
      state.paintedAt = performance.now();
      realtimeFrame = requestAnimationFrame(paintRealtimeTint);
    }
  }

  async function sampleRealtimeTint() {
    realtimeTimer = 0;
    if (realtimeStopped || !realtimeTintOn() || !realtimeVisible() || realtimeSampling) return;
    realtimeLastSample = performance.now();
    const browser = gBrowser.selectedBrowser;
    if (!browser || isLoading(browser) || isErrorPage(browser)) {
      requestRealtimeSample();
      return;
    }
    const epoch = realtimeEpoch;
    const request = colorRequestId;
    const windowGlobal = browser.browsingContext?.currentWindowGlobal;
    realtimeSampling = true;
    try {
      // Use exactly the same top-edge/dominant-colour sampler as normal mode.
      const reading = await sampleTopColor(browser);
      if (epoch !== realtimeEpoch || request !== colorRequestId || realtimeStopped ||
          !realtimeTintOn() || !realtimeVisible() || browser !== gBrowser.selectedBrowser ||
          windowGlobal !== browser.browsingContext?.currentWindowGlobal ||
          isLoading(browser) || isErrorPage(browser) || !reading?.rgb) return;
      let state = realtimeState(browser);
      const target = [...reading.rgb.slice(0, 3), reading.rgb[3] ?? 255];
      if (!state) {
        // Start from this tab's existing colour, never another tab's filter.
        const cached = colorCache.get(browser);
        const shown = cached ? [...cached.slice(0, 3), cached[3] ?? 255] : target.slice();
        state = {windowGlobal, shown, target, paintedAt: performance.now()};
        realtimeColors.set(browser, state);
      } else {
        state.target = target;
      }
      queueRealtimePaint(state);
    } catch (err) {
      noteError("site colour: realtime tint", err);
    } finally {
      realtimeSampling = false;
      requestRealtimeSample();
    }
  }

  function requestRealtimeSample() {
    if (realtimeStopped || !realtimeTintOn() || !realtimeVisible() ||
        realtimeTimer || realtimeSampling) return;
    // A slow snapshot delays the next one; captures never overlap.
    const delay = Math.max(0, REALTIME_SAMPLE_MS - (performance.now() - realtimeLastSample));
    realtimeTimer = setTimeout(sampleRealtimeTint, delay);
  }

  function stopRealtimeTint() {
    realtimeEpoch++;
    clearTimeout(realtimeTimer);
    cancelAnimationFrame(realtimeFrame);
    realtimeTimer = realtimeFrame = 0;
  }

  function watchRealtimeTint() {
    const changed = () => {
      stopRealtimeTint();
      colorRequestId++;
      pendingColor = unsureColor = checkSuspect = null;
      setFlag("zia-realtime-tint", realtimeTintOn());
      snapColorForTab(gBrowser.selectedBrowser);
      if (realtimeTintOn()) {
        requestRealtimeSample();
      } else {
        safely("site colour: mode change", () => updateColor());
      }
    };
    const visibility = () => {
      stopRealtimeTint();
      if (realtimeVisible()) requestRealtimeSample();
    };
    Services.prefs.addObserver(REALTIME_TINT_PREF, changed);
    Services.prefs.addObserver("zia.toolbar.site-color", changed);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("sizemodechange", visibility);
    gBrowser.tabContainer.addEventListener("TabSelect", () => {
      stopRealtimeTint();
      requestRealtimeSample();
    });
    window.addEventListener("unload", () => {
      realtimeStopped = true;
      stopRealtimeTint();
      Services.prefs.removeObserver(REALTIME_TINT_PREF, changed);
      Services.prefs.removeObserver("zia.toolbar.site-color", changed);
    }, {once: true});
    setFlag("zia-realtime-tint", realtimeTintOn());
    requestRealtimeSample();
  }
