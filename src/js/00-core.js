// Zia: built from src/js by scripts/build.sh. Edit the parts in src/js, not this file.
(() => {
  if (window.__ziaLoaded) {
    return;
  }
  window.__ziaLoaded = true;

  const root = document.documentElement;

  // Errors Zia can carry on past (a pref that isn't set, a tab that's gone)
  // are logged once per place at debug level instead of vanishing: visible in
  // the Browser Console, but not noisy.
  const notedErrors = new Set();
  function noteError(where, err) {
    if (notedErrors.has(where)) {
      return;
    }
    notedErrors.add(where);
    console.debug(`[Zia] ${where}:`, err);
  }

  function setFlag(name, on) {
    if (on === root.hasAttribute(name)) {
      return;
    }
    if (on) {
      root.setAttribute(name, "true");
    } else {
      root.removeAttribute(name);
    }
  }

  // Zen marks the sidebar while it slides in compact mode. Anything that reads
  // the tab strip's geometry flushes the whole strip's layout, and a long strip
  // (thousands of rows) makes that a frame's worth of work on its own: run on
  // every frame of the slide, it is what made tucking the sidebar away stall.
  function compactSliding() {
    return root.hasAttribute("zen-compact-animating");
  }

  // ...so the work waits for the slide to settle instead. Bounded by a fallback,
  // in case the attribute is left behind.
  function whenCompactSettled(run) {
    if (!compactSliding()) {
      run();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      observer.disconnect();
      clearTimeout(fallback);
      run();
    };
    const observer = new MutationObserver(() => {
      if (!compactSliding()) {
        finish();
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["zen-compact-animating"] });
    const fallback = setTimeout(finish, 1000);
  }

  // Address bar position (an option): at the bottom of the page instead of the
  // top. Zen's single toolbar keeps its own layout.
  function urlbarAtBottom() {
    return root.getAttribute("zia-urlbar-position") === "bottom" && root.getAttribute("zen-single-toolbar") !== "true";
  }

