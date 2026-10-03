  // Use the media tab's own space, not whichever space is currently visible.
  function mediaWorkspaceColor(element) {
    const browser = element.__ziaCard?.browser;
    const tab = browser && gBrowser.getTabForBrowser(browser);
    const manager = window.gZenWorkspaces;
    const id = tab?.getAttribute("zen-workspace-id") || manager?.activeWorkspace;
    try {
      const workspace = manager?.getWorkspaceFromId?.(id);
      const colors = workspace?.theme?.gradientColors || [];
      const color = (colors.find((entry) => entry.isPrimary) || colors[Math.floor(colors.length / 2)])?.c;
      if (Array.isArray(color) && color.length >= 3 && color.slice(0, 3).every(Number.isFinite)) {
        return `rgb(${color.slice(0, 3).join(",")})`;
      }
      if (typeof color === "string" && CSS.supports("color", color)) return color;
      const space = manager?.workspaceElement?.(id);
      return getComputedStyle(space || root).getPropertyValue("--zen-primary-color").trim() || "#806b76";
    } catch {
      return "#806b76";
    }
  }

  const workspaceTints = new Map();
  function readableWorkspaceTint(color) {
    if (workspaceTints.has(color)) return workspaceTints.get(color);
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#806b76";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    let rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const luminance = (values) => values.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    // Preserve the workspace hue, limiting brightness for the white labels.
    while (luminance(rgb) > 0.12) rgb = rgb.map((value) => value * 0.96);
    const tint = `rgb(${rgb.map(Math.round).join(", ")})`;
    if (workspaceTints.size >= 64) workspaceTints.clear();
    workspaceTints.set(color, tint);
    return tint;
  }

  function updateMediaWorkspace(element) {
    const color = readableWorkspaceTint(mediaWorkspaceColor(element));
    if (element.style.getPropertyValue("--zia-media-space-bg") !== color) {
      element.style.setProperty("--zia-media-space-bg", color);
    }
  }

  function watchMediaWorkspace() {
    let frame = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        for (const element of document.querySelectorAll(".zen-media-card")) updateMediaWorkspace(element);
      });
    };
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(root, { attributes: true, attributeFilter: ["style", "zen-default-theme"] });
    const tabObserver = new MutationObserver(schedule);
    tabObserver.observe(gBrowser.tabContainer, {
      subtree: true, attributes: true, attributeFilter: ["zen-workspace-id"],
    });
    window.addEventListener("ZenWorkspacesUIUpdate", schedule);
    Services.prefs.addObserver("zen.workspaces.active", schedule);
    window.addEventListener("unload", () => {
      themeObserver.disconnect();
      tabObserver.disconnect();
      Services.prefs.removeObserver("zen.workspaces.active", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    }, { once: true });
    schedule();
  }

  function watchMediaOpacity() {
    const prefix = "zia.media-player.opacity.";
    const defaults = Services.prefs.getDefaultBranch("");
    const settings = [["collapsed", 40], ["expanded", 90]];
    for (const [state, value] of settings) {
      defaults.setStringPref(prefix + state, String(value));
    }
    const update = () => {
      for (const [state, fallback] of settings) {
        let value = fallback;
        try {
          const input = Services.prefs.getStringPref(prefix + state, String(fallback))
            .trim().replace(/%$/, "").trim();
          const number = input === "" ? NaN : Number(input);
          if (Number.isFinite(number)) value = Math.max(0, Math.min(100, number));
        } catch {}
        root.style.setProperty(`--zia-media-opacity-${state}`, `${value}%`);
      }
    };
    Services.prefs.addObserver(prefix, update);
    window.addEventListener("unload", () => Services.prefs.removeObserver(prefix, update), { once: true });
    update();
  }
