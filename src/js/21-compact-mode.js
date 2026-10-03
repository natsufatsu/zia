  function watchCompactTopRow() {
    const navBar = document.getElementById("nav-bar");
    if (!navBar) {
      return;
    }
    const toolbox = document.getElementById("navigator-toolbox");
    const titlebar = document.getElementById("titlebar");
    const topButtons = document.getElementById("zen-sidebar-top-buttons");

    function inCompactMode() {
      return root.getAttribute("zen-compact-mode") === "true";
    }

    function windowButtons() {
      return window.gZenVerticalTabsManager?.actualWindowButtons || null;
    }

    function moveTopRow() {
      if (!inCompactMode()) {
        return;
      }
      if (!titlebar || !topButtons || !toolbox) {
        return;
      }
      // Zen can move the titlebar into the address-bar row during a later
      // layout update. The workspace label and sidebar buttons stay with
      // the flyout sidebar instead of following that titlebar.
      const home = toolbox.contains(titlebar) ? titlebar : toolbox;
      if (topButtons.parentElement !== home) {
        home.prepend(topButtons);
      }
      // Windows' minimise, maximise and close stay top right, where Zen puts
      // them; only macOS's traffic lights join the sidebar's top row.
      if (window.gZenVerticalTabsManager?.isWindowsStyledButtons) {
        return;
      }
      const buttons = windowButtons();
      if (buttons && buttons.parentElement !== topButtons) {
        topButtons.prepend(buttons);
      }
    }

    const watcher = new MutationObserver((records) => {
      if (records.some((record) =>
        record.target === navBar || record.target === toolbox || record.target === titlebar ||
        [...record.addedNodes, ...record.removedNodes].some((node) =>
          node === titlebar || node === topButtons || node.contains?.(titlebar) || node.contains?.(topButtons)
        )
      )) {
        moveTopRow();
        followCover();
      }
    });
    watcher.observe(navBar, { childList: true, subtree: true });
    if (toolbox) watcher.observe(toolbox, { childList: true });
    if (titlebar) watcher.observe(titlebar, { childList: true });
    window.addEventListener("unload", () => watcher.disconnect(), { once: true });

    // Zen 1.23 can reveal a sidebar using only the implicit-hover mark.
    const SIDEBAR_SHOWN_ATTRS = ["zen-has-hover", "zen-has-implicit-hover", "zen-user-show", "zen-has-empty-tab", "flash-popup", "has-popup-menu", "movingtab", "zen-compact-mode-active"];

    function syncPanelOpen() {
      const shown = inCompactMode() && !!toolbox && SIDEBAR_SHOWN_ATTRS.some((name) => toolbox.hasAttribute(name));
      setFlag("zia-panel-open", shown);
      // Freeze a reversed slide at its new starting edge immediately; waiting
      // for another frame lets the old clip advance while the sidebar waits.
      cancelAnimationFrame(coverFrame);
      cover();
    }

    // The top toolbar stays up while the sidebar is out, cut away only where
    // the sidebar covers it (see-through, the address showed through it).
    // Read the geometry once per change, then let Firefox animate the clip
    // with the sidebar's own transition rather than polling every frame.
    const toolbarElements = () => [
      document.getElementById("zen-appcontent-navbar-container"),
      document.getElementById("urlbar"),
    ].filter(Boolean);
    function clipUnder(el, box, over, raw = false) {
      let start = 0;
      let end = 0;
      if (over && el.getAttribute("breakout-extend") !== "true") {
        const across = over.bottom > box.top && over.top < box.bottom &&
          (raw || (over.right > box.left && over.left < box.right));
        if (across) {
          const onLeft = root.getAttribute("zen-right-side") !== "true";
          const amount = onLeft ? over.right - box.left : box.right - over.left;
          const inset = raw ? amount : Math.ceil(Math.min(box.width, Math.max(0, amount)));
          start = onLeft ? inset : 0;
          end = onLeft ? 0 : inset;
        }
      }
      return start || end || raw ? `inset(0 ${end}px 0 ${start}px)` : "";
    }
    let coverFrame = 0;
    const clipAnimations = new Map();
    const pendingMotions = new WeakSet();
    function applyClip(el, clip, from, to, motion) {
      clipAnimations.get(el)?.cancel();
      clipAnimations.delete(el);
      if (el.style.clipPath !== clip) el.style.clipPath = clip;
      if (!motion || from === to) return;
      const animation = el.animate([{ clipPath: from }, { clipPath: to }], {
        ...motion.effect.getTiming(), fill: "both",
      });
      animation.playbackRate = motion.playbackRate;
      if (motion.startTime !== null) animation.startTime = motion.startTime;
      else if (motion.currentTime !== null) animation.currentTime = motion.currentTime;
      clipAnimations.set(el, animation);
      animation.finished.then(() => {
        if (clipAnimations.get(el) === animation) {
          clipAnimations.delete(el);
          animation.cancel();
        }
      }, () => {});
    }
    // Zen 1.23 slides with translate rather than left/right. Its horizontal
    // values are px, percentages, or an additive calc mixing the two.
    function horizontalTranslate(value, width) {
      if (value === "none") return 0;
      const x = value.startsWith("calc(") ? value.slice(5, value.indexOf(")")) : value.split(/\s+/)[0];
      const unit = /[+-]?\s*(?:\d*\.)?\d+(?:px|%)/g;
      const terms = x.match(unit);
      if (!terms || x.replace(unit, "").replace(/[\s+-]/g, "")) return NaN;
      return terms.reduce((sum, term) => sum + parseFloat(term.replace(/\s/g, "")) *
        (term.endsWith("%") ? width / 100 : 1), 0);
    }
    function cover() {
      coverFrame = 0;
      const targets = toolbarElements();
      const elements = targets.filter((el) => !toolbox?.contains(el));
      const style = inCompactMode() && toolbox ? getComputedStyle(toolbox) : null;
      let over = null;
      let fromOver = null;
      let toOver = null;
      let motion = null;
      if (style && style.visibility !== "hidden") {
        // getAnimations updates CSS transitions before reading their endpoints.
        const axis = root.getAttribute("zen-right-side") === "true" ? "right" : "left";
        motion = toolbox.getAnimations().find((animation) =>
          [axis, "translate"].includes(animation.transitionProperty) && animation.playState !== "finished"
        );
        // Firefox can revise a reversed transition's starting keyframe when
        // its pending start resolves. Re-read once then, rather than mirroring
        // the provisional endpoint throughout the slide.
        if (motion?.pending && !pendingMotions.has(motion)) {
          pendingMotions.add(motion);
          motion.ready.then(() => {
            if (window.closed) return;
            cancelAnimationFrame(coverFrame);
            cover();
          }, () => {});
        }
        const box = toolbox.getBoundingClientRect();
        const left = box.left + (parseFloat(style.paddingLeft) || 0);
        const right = box.right - (parseFloat(style.paddingRight) || 0);
        over = { left, right, top: box.top, bottom: box.bottom, width: Math.max(0, right - left) };
        if (motion) {
          const frames = motion.effect.getKeyframes();
          const translated = motion.transitionProperty === "translate";
          const property = translated ? "translate" : axis;
          const position = (value) => translated ? horizontalTranslate(value || "none", box.width) : parseFloat(value);
          const origin = position(style[property]);
          const first = position(frames[0]?.[property]);
          const last = position(frames.at(-1)?.[property]);
          if ([origin, first, last].every(Number.isFinite)) {
            const shifted = (value) => {
              const delta = (value - origin) * (translated || axis === "left" ? 1 : -1);
              return { ...over, left: over.left + delta, right: over.right + delta };
            };
            fromOver = shifted(first);
            toOver = shifted(last);
          } else {
            motion = null;
          }
        }
      }
      // Finish every geometry read before changing any styles.
      const clips = elements.map((el) => {
        const box = over ? el.getBoundingClientRect() : null;
        const from = clipUnder(el, box, fromOver);
        const to = clipUnder(el, box, toOver);
        const animate = motion && (from || to) && el.getAttribute("breakout-extend") !== "true";
        return { el, clip: clipUnder(el, box, motion ? toOver : over),
          from: animate ? clipUnder(el, box, fromOver, true) : null,
          to: animate ? clipUnder(el, box, toOver, true) : null, motion: animate ? motion : null };
      });
      for (const el of new Set([...targets, ...clipAnimations.keys()])) {
        if (!elements.includes(el)) applyClip(el, "");
      }
      for (const clip of clips) applyClip(clip.el, clip.clip, clip.from, clip.to, clip.motion);
    }
    function followCover() {
      if (!coverFrame) {
        coverFrame = requestAnimationFrame(cover);
      }
    }

    let panelWatcher = null;
    if (toolbox) {
      panelWatcher = new MutationObserver(syncPanelOpen);
      panelWatcher.observe(toolbox, { attributes: true, attributeFilter: SIDEBAR_SHOWN_ATTRS });
      toolbox.addEventListener("transitionend", (event) => {
        if (event.target === toolbox && ["left", "right", "translate", "visibility"].includes(event.propertyName)) followCover();
      });
    }

    window.addEventListener("resize", followCover);
    const urlbar = document.getElementById("urlbar");
    urlbar?.addEventListener("focus", followCover, true);
    urlbar?.addEventListener("blur", followCover, true);
    const breakoutWatcher = new MutationObserver(followCover);
    if (urlbar) {
      breakoutWatcher.observe(urlbar, { attributes: true, attributeFilter: ["breakout-extend"] });
    }
    const sizes = new ResizeObserver(followCover);
    for (const el of [toolbox, document.getElementById("zen-appcontent-navbar-container"), urlbar]) {
      if (el) sizes.observe(el);
    }

    const modeWatcher = new MutationObserver(() => {
      moveTopRow();
      syncPanelOpen();
    });
    modeWatcher.observe(root, { attributes: true, attributeFilter: ["zen-compact-mode", "zen-right-side", "zen-sidebar-expanded", "zen-single-toolbar"] });
    window.addEventListener("unload", () => {
      cancelAnimationFrame(coverFrame);
      sizes.disconnect();
      breakoutWatcher.disconnect();
      panelWatcher?.disconnect();
      modeWatcher.disconnect();
      for (const animation of clipAnimations.values()) animation.cancel();
      clipAnimations.clear();
    }, { once: true });

    moveTopRow();
    syncPanelOpen();
  }
