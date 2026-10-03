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

  // Address bar position (an option): at the bottom of the page instead of the
  // top. Zen's single toolbar keeps its own layout.
  function urlbarAtBottom() {
    return root.getAttribute("zia-urlbar-position") === "bottom" && root.getAttribute("zen-single-toolbar") !== "true";
  }

  // Every reading looks at the same band at the top of the page, 24px deep.
  // The checker below used to read deeper than the rest, so on a page with
  // a thin strip of another colour along its top edge the two disagreed,
  // and the toolbar flicked between them for as long as the page was open.
  const TOP_BAND = 24;
  const STRIP_SCALE = 0.5;
  const FULL_VIEW_SCALE = 0.125;
  const TOP_BAND_ROWS = TOP_BAND * FULL_VIEW_SCALE;
  const SCROLL_SAMPLE_INTERVAL = 50;
  const scrollPositions = new WeakMap();
  const LIGHT_THRESHOLD = 150;
  const INK_MAX = 90;
  const BLACKISH = 12;
  const ERROR_PAGE_COLOR = [0, 0, 0];
  const ERROR_PAGES = /^about:(neterror|certerror|httpsonlyerror|blocked|tabcrashed)/;
  const errorBrowsers = new WeakSet();
  const colorCache = new WeakMap();
  let colorRequestId = 0;

  const MIN_COLOR_SHARE = 0.6;
  const SAME_COLOR_DISTANCE = 10;
  let pendingColor = null;

  let appliedColorKey = null;

  // a reading unlike the site's remembered colour, waiting on a second
  const UNSURE_RECHECK = 200;
  let unsureColor = null;

  // Off leaves the toolbar in the theme's own colour instead of the site's.
  const siteColorOn = () => Services.prefs.getBoolPref("zia.toolbar.site-color", true);

  function applyColor(rgb) {
    if (!siteColorOn()) {
      rgb = null;
    }
    const key = rgb ? rgb.join(",") : "fallback";
    if (key === appliedColorKey) {
      return;
    }
    appliedColorKey = key;
    if (!rgb) {
      root.style.removeProperty("--zia-site-bg");
      updateInkTint(null);
      setFlag("zia-site-light", false);
      setFlag("zia-site-dark", true);
      setFlag("zia-site-mid", false);

      const fallback = fallbackColor();
      updateDarkSiteInk(fallback, brightnessOf(fallback),  true);
      return;
    }
    root.style.setProperty("--zia-site-bg", cssColor(rgb));
    updateInkTint(rgb);
    const brightness = brightnessOf(rgb);
    const light = wantsDarkInk(rgb);
    // A vivid colour (a strong red, say) is treated as mid even when it's a
    // little darker: the dark sites' soft grey ink, and the fainter rest of
    // the address, all but vanished on it.
    const vivid = !light && brightness >= 40 && Math.max(...rgb.slice(0, 3)) - Math.min(...rgb.slice(0, 3)) >= 110;
    const mid = !light && (brightness >= INK_MAX || vivid);
    setFlag("zia-site-light", light);
    setFlag("zia-site-dark", brightness < INK_MAX && !vivid);
    // Between the two (a strong red, say), white text stays but nothing on
    // the toolbar is left faint.
    setFlag("zia-site-mid", mid);
    updateDarkSiteInk(rgb, mid ? INK_MAX : brightness);
  }

  // The toolbar's text and buttons take the site's own hue, as in Dia: on
  // a cream page they're a soft brown (Dia's own, measured) rather than a
  // neutral grey. Grey pages (no hue to speak of) stay neutral.
  function updateInkTint(rgb) {
    if (!rgb) {
      root.style.removeProperty("--zia-ink-h");
      root.style.removeProperty("--zia-ink-s");
      return;
    }
    const [r, g, b] = rgb.slice(0, 3).map((c) => c / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d > 0.0001) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) {
        h = 60 * (((g - b) / d) % 6);
      } else if (max === g) {
        h = 60 * ((b - r) / d + 2);
      } else {
        h = 60 * ((r - g) / d + 4);
      }
    }
    root.style.setProperty("--zia-ink-h", `${Math.round((h + 360) % 360)}`);
    // a third of the site's saturation, as Dia does
    root.style.setProperty("--zia-ink-s", `${Math.round(Math.min(s, 1) * 34)}%`);
  }

  function updateDarkSiteInk(rgb, brightness, inkOnly = false) {
    if (!rgb || brightness >= INK_MAX) {
      root.style.removeProperty("--zia-dark-ink");
      root.style.removeProperty("--zia-urlbar-hover-bg");
      return;
    }
    const base = rgb.slice(0, 3);
    // White on black and near-black pages (GitHub's #0d1117 read as a
    // brightness of 3, and got the dim grey meant for greyer darks), as
    // in Dia; the soft grey only from there up.
    const t = brightness <= BLACKISH ? 0 : Math.min(1, (brightness - BLACKISH) / (INK_MAX - 44 - BLACKISH));
    const level = brightness <= BLACKISH ? 251 : Math.round(150 + t * 26);
    root.style.setProperty("--zia-dark-ink", `hsl(var(--zia-ink-h, 0) var(--zia-ink-s, 0%) ${((level / 255) * 100).toFixed(1)}%)`);
    if (inkOnly) {
      root.style.removeProperty("--zia-urlbar-hover-bg");
      return;
    }
    const hover =

      brightness >= 10 ? base.map((c) => Math.round(c * 0.45)) : base.map((c) => Math.round(c + (255 - c) * 0.1));
    root.style.setProperty("--zia-urlbar-hover-bg", `rgb(${hover.join(", ")})`);
  }

  function fallbackColor() {
    const text = getComputedStyle(root).getPropertyValue("--zia-fallback-bg").trim();
    const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (hex) {
      const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
      return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    }
    const parsed = parseColor(text);
    return parsed[3] ? parsed.slice(0, 3) : [18, 18, 18];
  }

  function showFallbackColor() {
    colorRequestId++;
    applyColor(null);
  }

  function showErrorColor() {
    colorRequestId++;
    applyColor(ERROR_PAGE_COLOR);
  }

  function isErrorPage(browser) {
    if (!browser) {
      return false;
    }
    if (errorBrowsers.has(browser)) {
      return true;
    }
    const uris = [
      browser.browsingContext?.currentWindowGlobal?.documentURI?.spec,
      browser.documentURI?.spec,
    ];
    return uris.some((uri) => ERROR_PAGES.test(uri || ""));
  }

  function isLoading(browser) {
    if (!browser) {
      return false;
    }
    if (gBrowser.getTabForBrowser(browser)?.hasAttribute("busy")) {
      return true;
    }
    try {
      return !!browser.webProgress?.isLoadingDocument;
    } catch (err) {
      return false;
    }
  }

  // When the scroll position isn't known the whole view is drawn small (one
  // row is 8px of page) and its top rows read
  async function sampleTopColor(browser) {
    const windowGlobal = browser?.browsingContext?.currentWindowGlobal;
    const width = browser?.clientWidth;
    if (!windowGlobal || !width) {
      return null;
    }
    const backing = browser.getAttribute("transparent") === "true" ? "transparent" : "rgb(255, 255, 255)";

    const pos = scrollPositions.get(browser);
    const bitmap = pos
      ? await windowGlobal.drawSnapshot(new DOMRect(pos.x, pos.y, width, TOP_BAND), STRIP_SCALE, backing)
      : await windowGlobal.drawSnapshot(null, FULL_VIEW_SCALE, backing);

    sampleTopColor.canvas ||= document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    const canvas = sampleTopColor.canvas;
    canvas.width = bitmap.width;
    canvas.height = pos ? bitmap.height : Math.min(TOP_BAND_ROWS, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] >> 3) << 13) | ((data[i + 1] >> 3) << 8) | ((data[i + 2] >> 3) << 3) | (data[i + 3] >> 5);
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0, a: 0 };
      bucket.count++;
      bucket.r += data[i];
      bucket.g += data[i + 1];
      bucket.b += data[i + 2];
      bucket.a += data[i + 3];
      buckets.set(key, bucket);
    }
    let best = null;
    for (const bucket of buckets.values()) {
      if (!best || bucket.count > best.count) {
        best = bucket;
      }
    }
    if (!best) {
      return null;
    }
    let rgb = [best.r, best.g, best.b, best.a].map((v) => Math.round(v / best.count));
    if (rgb[3] < 255) {
      rgb = colorOver(rgb, chromeBackdrop(browser));
    }
    return {
      rgb: rgb[3] === 255 ? rgb.slice(0, 3) : rgb,
      share: best.count / (data.length / 4),
    };
  }
  function parseColor(text) {
    const parts = text.match(/[\d.]+/g)?.map(Number) || [];
    return parts.length >= 3 ? [parts[0], parts[1], parts[2], Math.round((parts[3] ?? 1) * 255)] : [0, 0, 0, 0];
  }

  function colorOver(top, bottom) {
    const ta = top[3] / 255;
    const ba = (bottom[3] / 255) * (1 - ta);
    const a = ta + ba;
    if (!a) {
      return [0, 0, 0, 0];
    }
    return [0, 1, 2].map((i) => Math.round((top[i] * ta + bottom[i] * ba) / a)).concat(Math.round(a * 255));
  }

  function chromeBackdrop(browser) {
    const shared = document.getElementById("zen-appcontent-navbar-wrapper")?.parentElement;
    const layers = [];
    for (let el = browser; el && el !== shared; el = el.parentElement) {
      layers.push(el);
    }
    let color = [0, 0, 0, 0];
    for (const el of layers.reverse()) {
      color = colorOver(parseColor(getComputedStyle(el).backgroundColor), color);
    }
    return color;
  }

  function cssColor([r, g, b, a = 255]) {
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  }

  function brightnessOf([r, g, b, a = 255]) {
    const behind = matchMedia("(prefers-color-scheme: dark)").matches ? 0 : 255;
    return ((r * 299 + g * 587 + b * 114) / 1000) * (a / 255) + behind * (1 - a / 255);
  }

  // How far white text stands out on a colour (WCAG contrast, 1 to 21).
  function whiteContrastOn([r, g, b, a = 255]) {
    const behind = matchMedia("(prefers-color-scheme: dark)").matches ? 0 : 255;
    const channel = (c) => {
      const v = (c * (a / 255) + behind * (1 - a / 255)) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    return 1.05 / (luminance + 0.05);
  }

  // Dark text on light colours, and on bright mid colours (a vivid green,
  // say) that white text can't be read on, though they're not light.
  const MIN_WHITE_CONTRAST = 3;
  function wantsDarkInk(rgb) {
    return brightnessOf(rgb) > LIGHT_THRESHOLD || whiteContrastOn(rgb) < MIN_WHITE_CONTRAST;
  }

  function colorDistance(a, b) {
    if (!a || !b) {
      return Infinity;
    }
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs((a[3] ?? 255) - (b[3] ?? 255));
  }

  async function updateColor(fromScroll = false, duringLoad = false) {
    const browser = gBrowser.selectedBrowser;
    if (realtimeTintOn()) {
      requestRealtimeSample();
      return;
    }
    if (!siteColorOn()) {
      applyColor(null);
      return;
    }

    if (isErrorPage(browser)) {
      showErrorColor();
      return;
    }
    if (isLoading(browser) && !duringLoad) {
      return;
    }

    const id = ++colorRequestId;
    let reading = null;
    try {
      reading = await sampleTopColor(browser);
    } catch (err) {
      noteError("site colour: updateColor", err);
    }
    if (id !== colorRequestId || browser !== gBrowser.selectedBrowser || (isLoading(browser) && !duringLoad)) {
      return;
    }

    const known = colorCache.has(browser);
    const current = colorCache.get(browser) ?? null;
    let rgb = reading?.rgb ?? null;

    // A reading that disagrees with the site's remembered colour is often a
    // passing splash (Discord is white for a moment before its dark page),
    // and by the time it arrived the page had moved on, so the toolbar
    // flashed. It's only believed when a second reading a moment later
    // agrees, which a site that really has changed colour still gives.
    if (!fromScroll && rgb) {
      const remembered = rememberedSiteColor(browser);
      if (remembered && colorDistance(rgb, remembered) > CHECK_DISTANCE) {
        if (unsureColor?.browser !== browser || colorDistance(rgb, unsureColor.rgb) > CHECK_DISTANCE) {
          unsureColor = { browser, rgb };
          setTimeout(() => updateColor(false, isLoading(browser)), UNSURE_RECHECK);
          return;
        }
      }
    }
    unsureColor = null;

    if (known && fromScroll) {
      if (reading && reading.share < MIN_COLOR_SHARE) {
        pendingColor = null;
        return;
      }

      if (colorDistance(rgb, current) <= SAME_COLOR_DISTANCE) {
        pendingColor = null;
        return;
      }

      if (rgb) {
        if (colorDistance(rgb, pendingColor) > SAME_COLOR_DISTANCE) {
          pendingColor = rgb;
          requestScrollSample();
          return;
        }
      }
    }
    pendingColor = null;
    applyColor(rgb);
    colorCache.set(browser, rgb);

    if (!fromScroll && rgb) {
      rememberSiteColor(browser, rgb);
    }
  }

  // The colour checker. The toolbar's colour is read when a page loads, for
  // a few seconds after, and on scrolling, so a page that changes later (a
  // banner closing, a header recolouring itself, a slideshow) or whose very
  // top edge is a thin line of another colour could leave it wrong. Every
  // few seconds, while the tab is showing and settled, Zia reads the top of
  // the page again. If two readings in a row agree with
  // each other and not with the toolbar, the toolbar changes to match and
  // the site's remembered colour is corrected. It also checks when the
  // window comes back into view or is resized.
  const CHECK_EVERY = 3000;
  const CHECK_DISTANCE = 24;
  let checkSuspect = null;
  let checking = false;

  async function checkColor() {
    const browser = gBrowser.selectedBrowser;
    if (realtimeTintOn() || checking || document.hidden || !siteColorOn() || !browser || isErrorPage(browser) || isLoading(browser) ||
        scrollTimer || scrollSampling || !colorCache.has(browser)) {
      return;
    }
    checking = true;
    const id = colorRequestId;
    let reading = null;
    try {
      reading = await sampleTopColor(browser);
    } catch (err) {
      noteError("site colour: checkColor", err);
    } finally {
      checking = false;
    }
    // Something else read or changed the colour meanwhile, or the tab changed
    if (id !== colorRequestId || browser !== gBrowser.selectedBrowser || isLoading(browser) || !reading?.rgb) {
      checkSuspect = null;
      return;
    }
    const shown = colorCache.get(browser);
    if (reading.share < MIN_COLOR_SHARE || colorDistance(reading.rgb, shown) <= CHECK_DISTANCE) {
      checkSuspect = null;
      return;
    }
    if (!checkSuspect || checkSuspect.browser !== browser || colorDistance(reading.rgb, checkSuspect.rgb) > SAME_COLOR_DISTANCE) {
      checkSuspect = { browser, rgb: reading.rgb };
      return;
    }
    checkSuspect = null;
    applyColor(reading.rgb);
    colorCache.set(browser, reading.rgb);
    rememberSiteColor(browser, reading.rgb);
  }

  function watchColorDrift() {
    setInterval(checkColor, CHECK_EVERY);
    const soon = () => setTimeout(checkColor, 400);
    document.addEventListener("visibilitychange", soon);
    window.addEventListener("focus", soon);
    window.addEventListener("resize", () => {
      clearTimeout(watchColorDrift.resizeTimer);
      watchColorDrift.resizeTimer = setTimeout(checkColor, 500);
    });
    gBrowser.tabContainer.addEventListener("TabSelect", () => {
      checkSuspect = null;
    });
  }

  // Optionally the address bar's pop-up takes the toolbar's colour as it
  // opens, so it reads as the same bar growing. The colour is copied once,
  // when the pop-up opens, and kept until it closes: scrolling the page
  // underneath (which can recolour the toolbar) doesn't change it. With the
  // toolbar in the theme's colour, or Zen's own pop-up, nothing changes.
  const POP_UP_SITE_COLOR_PREF = "zia.urlbar.site-color";

  function freezePopUpColor(urlbar) {
    const text = root.style.getPropertyValue("--zia-site-bg").trim();
    if (
      !text ||
      !siteColorOn() ||
      !Services.prefs.getBoolPref(POP_UP_SITE_COLOR_PREF, false) ||
      urlbar.hasAttribute("zia-classic") ||
      urlbar.getAttribute("zen-floating-urlbar") === "true"
    ) {
      return;
    }
    // A see-through colour is laid over what the page would show behind it,
    // so the pop-up is solid.
    const behind = matchMedia("(prefers-color-scheme: dark)").matches ? [0, 0, 0, 255] : [255, 255, 255, 255];
    const rgb = colorOver(parseColor(text), behind);
    urlbar.style.setProperty("--zia-pop-site-bg", cssColor(rgb.slice(0, 3)));
    urlbar.setAttribute("zia-pop-site", wantsDarkInk(rgb) ? "light" : "dark");
  }

  function watchPopUpColor() {
    const urlbar = gURLBar?.textbox || document.getElementById("urlbar");
    if (!urlbar) {
      return;
    }
    let open = urlbar.hasAttribute("breakout-extend");
    new MutationObserver(() => {
      const nowOpen = urlbar.hasAttribute("breakout-extend");
      if (nowOpen === open) {
        return;
      }
      open = nowOpen;
      if (nowOpen) {
        freezePopUpColor(urlbar);
      } else {
        urlbar.removeAttribute("zia-pop-site");
        urlbar.style.removeProperty("--zia-pop-site-bg");
      }
    }).observe(urlbar, { attributes: true, attributeFilter: ["breakout-extend"] });
  }

  const SITE_COLORS_PREF = "zia.siteColors";
  const SITE_COLORS_MAX = 200;
  let siteColors = null;
  let siteColorsSaveTimer = null;

  function siteKey(browser) {
    try {
      const uri = browser.currentURI;
      return /^https?$/.test(uri.scheme) ? uri.host : "";
    } catch (err) {
      return "";
    }
  }

  function loadSiteColors() {
    if (siteColors) {
      return siteColors;
    }
    siteColors = new Map();
    try {
      const saved = JSON.parse(Services.prefs.getStringPref(SITE_COLORS_PREF, "{}"));
      for (const [host, value] of Object.entries(saved)) {
        siteColors.set(host, value);
      }
    } catch (err) {
      noteError("site colour: loadSiteColors", err);
    }
    return siteColors;
  }

  function rememberSiteColor(browser, rgb) {
    const host = siteKey(browser);
    if (!host) {
      return;
    }
    const colors = loadSiteColors();
    const value = rgb.join(",");
    if (colors.get(host) === value) {
      return;
    }
    colors.delete(host);
    colors.set(host, value);
    while (colors.size > SITE_COLORS_MAX) {
      colors.delete(colors.keys().next().value);
    }

    if (!siteColorsSaveTimer) {
      siteColorsSaveTimer = setTimeout(() => {
        siteColorsSaveTimer = null;
        Services.prefs.setStringPref(SITE_COLORS_PREF, JSON.stringify(Object.fromEntries(siteColors)));
      }, 20000);
    }
  }

  function rememberedSiteColor(browser) {
    const host = siteKey(browser);
    const value = host && loadSiteColors().get(host);
    return value ? value.split(",").map(Number) : null;
  }

  function snapColorForTab(browser) {
    pendingColor = null;
    setFlag("zia-color-snap", true);
    if (isErrorPage(browser)) {
      showErrorColor();
    } else if (isLoading(browser) || (!colorCache.has(browser) && !realtimeCachedColor(browser))) {
      showFallbackColor();
    } else {
      colorRequestId++;
      applyColor(realtimeCachedColor(browser) || colorCache.get(browser));
    }
    requestAnimationFrame(() => requestAnimationFrame(() => setFlag("zia-color-snap", false)));
  }

  function scheduleColor(delay) {
    setTimeout(() => updateColor(), delay);
  }

  let pageHelperWorks = false;
  let scrollTimer = null;
  let scrollSampling = false;
  let lastScrollSample = 0;

  function requestScrollSample() {
    if (realtimeTintOn()) {
      requestRealtimeSample();
      return;
    }
    if (scrollTimer) {
      return;
    }
    const wait = Math.max(0, SCROLL_SAMPLE_INTERVAL - (Date.now() - lastScrollSample));
    scrollTimer = setTimeout(async () => {
      scrollTimer = null;
      if (scrollSampling) {
        requestScrollSample();
        return;
      }
      scrollSampling = true;
      lastScrollSample = Date.now();
      try {
        await updateColor(true);
      } finally {
        scrollSampling = false;
      }
    }, wait);
  }

  window.ziaOnPagePainted = (browser) => {
    if (browser !== gBrowser.selectedBrowser || isErrorPage(browser)) {
      return;
    }
    updateColor(false, true);

    setTimeout(() => updateColor(false, isLoading(browser)), 150);
    setTimeout(() => updateColor(false, isLoading(browser)), 450);

    setTimeout(() => updateColor(false, isLoading(browser)), 1200);
    setTimeout(() => updateColor(false, isLoading(browser)), 2800);
    // pages that recolour their header once their scripts run (GitHub)
    setTimeout(() => updateColor(false, isLoading(browser)), 5000);
  };

  window.ziaOnPageScroll = (browser, position) => {
    if (position) {
      pageHelperWorks = true;
      scrollPositions.set(browser, { x: position.x || 0, y: position.y || 0 });
    }
    if (browser !== gBrowser.selectedBrowser || isLoading(browser) || isErrorPage(browser)) {
      return;
    }
    requestScrollSample();
  };

  function watchScrollInput() {
    const panels = document.getElementById("tabbrowser-tabpanels");
    if (!panels) {
      return;
    }
    const SCROLL_KEYS = new Set([
      "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ",
    ]);
    let followUps = [];
    const onInput = () => {
      if (pageHelperWorks) {
        return;
      }
      window.ziaOnPageScroll(gBrowser.selectedBrowser);
      followUps.forEach(clearTimeout);
      followUps = [250, 600, 1200].map((ms) =>
        setTimeout(() => window.ziaOnPageScroll(gBrowser.selectedBrowser), ms)
      );
    };
    panels.addEventListener("wheel", onInput, { passive: true, capture: true });
    panels.addEventListener("mouseup", onInput, { capture: true });
    window.addEventListener("keyup", (event) => {
      if (SCROLL_KEYS.has(event.key)) {
        onInput();
      }
    });
  }

  // PDFs in Dia's look (actors/ZiaPdfChild.sys.mjs). The query string
  // changes every session: Firefox caches these modules by address, and
  // would otherwise keep running an older copy after Zia updates.
  function registerPdfActor() {
    const version = `?v=${Date.now()}`;
    try {
      ChromeUtils.registerWindowActor("ZiaPdf", {
        parent: { esModuleURI: `chrome://sine/content/zia/actors/ZiaPdfParent.sys.mjs${version}` },
        child: {
          esModuleURI: `chrome://sine/content/zia/actors/ZiaPdfChild.sys.mjs${version}`,
          events: { DOMContentLoaded: {} },
        },
        allFrames: false,
        messageManagerGroups: ["browsers"],
        // Firefox only starts a helper inside a website's process when told
        // it's safe there; this one's browser side does nothing.
        safeForUntrustedWebProcess: true,
      });
    } catch (err) {
      if (err?.name !== "NotSupportedError") {
        console.error("[Zia] Could not register the PDF view:", err);
      }
    }
  }

  function registerScrollActor() {
    try {
      ChromeUtils.registerWindowActor("Zia", {
        parent: { esModuleURI: "chrome://sine/content/zia/actors/ZiaParent.sys.mjs" },
        child: {
          esModuleURI: "chrome://sine/content/zia/actors/ZiaChild.sys.mjs",
          events: {
            scroll: { capture: true, mozSystemGroup: true },
            DOMContentLoaded: {},
            pageshow: {},
          },
        },
        allFrames: false,
        messageManagerGroups: ["browsers"],
        // Firefox only starts a helper inside a website's process when told
        // it's safe there; this one only reports how far a page scrolled.
        safeForUntrustedWebProcess: true,
      });
    } catch (err) {
      if (err?.name !== "NotSupportedError") {
        console.error("[Zia] Could not register scroll helper:", err);
      }
    }
  }
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
  const loader = {
    shown: 0,
    target: 0,
    active: false,
    finishing: false,
    estimateTimer: null,
    hideTimer: null,
    frame: null,
  };

  function urlbarElement() {
    return gURLBar.textbox || document.getElementById("urlbar");
  }

  function drawProgress() {
    urlbarElement()?.style.setProperty("--zia-load-progress", loader.shown.toFixed(4));
  }

  function animateLoader() {
    loader.frame = null;
    const diff = loader.target - loader.shown;
    const next = loader.shown + (Math.abs(diff) < 0.001 ? diff : diff * (loader.finishing ? 0.3 : 0.12));
    loader.shown = Math.max(loader.shown, next);
    drawProgress();

    if (loader.finishing && loader.shown >= 0.999) {
      loader.finishing = false;
      loader.hideTimer = setTimeout(() => setFlag("zia-loading", false), 150);
      return;
    }
    if (loader.active || loader.finishing) {
      loader.frame = requestAnimationFrame(animateLoader);
    }
  }

  function runLoader() {
    if (!loader.frame) {
      loader.frame = requestAnimationFrame(animateLoader);
    }
  }

  function stopLoaderTimers() {
    clearInterval(loader.estimateTimer);
    clearTimeout(loader.hideTimer);
    loader.estimateTimer = null;
    loader.hideTimer = null;
  }

  function startLoader(from = 0.02, fresh = false) {
    const stillShowing = loader.active || loader.finishing || root.hasAttribute("zia-loading");
    stopLoaderTimers();
    loader.active = true;
    loader.finishing = false;

    if (fresh || !stillShowing) {
      loader.shown = from;
      loader.target = Math.max(from, 0.25);
      drawProgress();
    } else {
      loader.target = Math.max(loader.target, loader.shown, from);
    }

    setFlag("zia-loading", true);

    loader.estimateTimer = setInterval(() => {
      if (loader.target < 0.9) {
        loader.target += (0.9 - loader.target) * 0.06;
      }
    }, 250);
    runLoader();
  }

  function reportRealProgress(fraction) {
    if (loader.active && fraction > loader.target) {
      loader.target = Math.min(0.95, fraction);
    }
  }

  function finishLoader() {
    if (!loader.active) {
      return;
    }
    stopLoaderTimers();
    loader.active = false;
    loader.finishing = true;
    loader.target = 1;
    runLoader();
  }

  function cancelLoader() {
    stopLoaderTimers();
    loader.active = false;
    loader.finishing = false;
    setFlag("zia-loading", false);
  }

  let titleEl = null;
  let plainEl = null;

  function createTitleElement() {
    const inputBox = gURLBar.inputField?.parentNode;
    if (!inputBox) {
      return;
    }
    titleEl = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    titleEl.id = "zia-url-title";
    const host = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    host.className = "zia-url-title-host";
    const rest = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    rest.className = "zia-url-title-rest";
    titleEl.append(host, rest);
    inputBox.append(titleEl);

    plainEl = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    plainEl.id = "zia-url-plain";
    const plainHost = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    plainHost.className = "zia-url-title-host";
    const plainRest = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    plainRest.className = "zia-url-title-rest";
    plainEl.append(plainHost, plainRest);
    inputBox.append(plainEl);
  }

  const TITLE_ONLY_PREF = "zia.urlbar.title-only";

  function titleOnly() {
    try {
      return Services.prefs.getBoolPref(TITLE_ONLY_PREF, false);
    } catch (err) {
      return false;
    }
  }

  function watchTitleOnly() {
    const apply = () => updateTitle();
    Services.prefs.addObserver(TITLE_ONLY_PREF, apply);
    window.addEventListener("unload", () => Services.prefs.removeObserver(TITLE_ONLY_PREF, apply));
  }

  function updateTitle() {
    if (!titleEl) {
      return;
    }
    const urlbar = gURLBar.textbox || document.getElementById("urlbar");
    const browser = gBrowser.selectedBrowser;
    const uri = browser?.currentURI;

    let host = "";
    try {
      if (uri && /^https?$/.test(uri.scheme)) {
        host = uri.displayHost.replace(/^www\./, "");
      }
    } catch (err) {
      host = "";
    }

    const title = (browser?.contentTitle || "").trim();
    const valid = urlbar.getAttribute("pageproxystate") === "valid";

    // Multiview reads as a browser feature ("Multiview · 3"), not a website.
    if (valid && isMultiviewURI(uri)) {
      titleEl.firstChild.textContent = title || "Multiview";
      titleEl.lastChild.textContent = "";
      if (plainEl) {
        plainEl.firstChild.textContent = title || "Multiview";
        plainEl.lastChild.textContent = "";
      }
      urlbar.setAttribute("zia-has-title", "true");
      return;
    }

    if (!host || !valid || isErrorPage(browser)) {
      urlbar.removeAttribute("zia-has-title");
      return;
    }

    let isHomePage = false;
    try {
      const path = uri.filePath || "/";
      isHomePage = (path === "/" || path === "") && !uri.query && !uri.ref;
    } catch (err) {
      isHomePage = false;
    }
    const hasTitle = /[\p{L}\p{N}]/u.test(title);
    // Title only (an option): the title alone, in the domain's place and
    // colour, even on a site's home page; a page with none shows its domain
    if (titleOnly() && hasTitle) {
      titleEl.firstChild.textContent = title;
      titleEl.lastChild.textContent = "";
    } else {
      titleEl.firstChild.textContent = host;
      titleEl.lastChild.textContent = !isHomePage && hasTitle && title !== host ? ` / ${title}` : "";
    }

    if (plainEl) {
      let path = "";
      try {
        path = uri.pathQueryRef || "";
      } catch (err) {
        path = "";
      }
      plainEl.firstChild.textContent = host;
      plainEl.lastChild.textContent = path === "/" ? "" : path;
    }

    urlbar.setAttribute("zia-has-title", "true");
  }

  let urlbarTyping = false;
  // What was last typed
  let typedValue = "";

  // A site's address with nothing after it ends in a bare "/", which Zia
  // leaves off: youtube.com, not youtube.com/.
  const BARE_SLASH = /^([^/?#\s]+)\/$/;

  function plainAddress(value) {
    return typeof value === "string"
      ? value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(BARE_SLASH, "$1")
      : value;
  }

  function neverShowScheme() {
    const ui = window.gZenUIManager;
    if (ui && typeof ui.urlbarTrim === "function" && !ui.urlbarTrim.ziaWrapped) {
      const original = ui.urlbarTrim.bind(ui);
      const trimmed = (url) => (urlbarTyping && gURLBar.focused ? original(url) : plainAddress(original(url)));
      trimmed.ziaWrapped = true;
      ui.urlbarTrim = trimmed;
    }

    const input = gURLBar?.inputField || document.querySelector("#urlbar .urlbar-input");
    if (!input || input.ziaSchemeStripped) {
      return;
    }
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (!desc?.get || !desc?.set) {
      return;
    }
    input.ziaSchemeStripped = true;
    Object.defineProperty(input, "value", {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return desc.get.call(this);
      },
      set(next) {
        const typing = urlbarTyping && gURLBar.focused;
        // While typing, the only writes are Firefox's own, like autofill
        // completing "yo" to "youtube.com/": that loses its bare "/" too.
        // Typed characters don't come through here. A "/" typed on the end
        // stays, though: autofill writes "twitch.tv/" back for it, and
        // taking that off undid the key press.
        const keepSlash = typing && typedValue.endsWith("/");
        desc.set.call(
          this,
          typing ? (typeof next === "string" && !keepSlash ? next.replace(BARE_SLASH, "$1") : next) : plainAddress(next)
        );

        if (holdWholeSelection && gURLBar.focused) {
          this.select();
        }
      },
    });
    input.addEventListener("input", (event) => {
      if (event.isTrusted) {
        urlbarTyping = true;
        // (up to the caret: an autofilled ending after it may already be in)
        typedValue = desc.get.call(input).slice(0, input.selectionStart ?? undefined);
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        urlbarTyping = false;
      }
    });
    input.addEventListener("blur", () => {
      urlbarTyping = false;
      typedValue = "";
    });
  }

  let holdWholeSelection = false;

  function holdSelectionOnRewrite(input) {
    if (input.ziaSelectionHeld) {
      return;
    }
    input.ziaSelectionHeld = true;
    const setRange = input.setSelectionRange;
    input.setSelectionRange = function (start, end, direction) {
      if (holdWholeSelection && gURLBar.focused) {
        return setRange.call(this, 0, this.value.length, direction);
      }
      return setRange.call(this, start, end, direction);
    };
  }

  function keepWholeUrlSelected(urlbar) {
    const input = urlbar.querySelector(".urlbar-input") || gURLBar.inputField;
    if (!input) {
      return;
    }
    holdSelectionOnRewrite(input);
    let closedLength = -1;
    urlbar.addEventListener(
      "mousedown",
      (event) => {
        const opening = !urlbar.hasAttribute("breakout-extend") && !gURLBar.focused;
        closedLength = opening ? input.value.length : -1;

        holdWholeSelection = opening && event.button === 0;
      },
      true
    );
    const release = () => {
      holdWholeSelection = false;
    };
    urlbar.addEventListener("keydown", release, true);
    input.addEventListener("input", release);
    input.addEventListener("blur", release);
    const fix = () => {
      if (closedLength < 0) {
        return;
      }
      const { selectionStart, selectionEnd, value } = input;
      if (selectionStart === 0 && selectionEnd === closedLength && closedLength < value.length) {
        input.select();
        closedLength = -1;
      }
    };
    new MutationObserver(() => {
      if (!urlbar.hasAttribute("breakout-extend")) {
        closedLength = -1;
        return;
      }
      requestAnimationFrame(fix);
      for (const ms of [30, 100, 200]) {
        setTimeout(fix, ms);
      }
      setTimeout(() => {
        closedLength = -1;
      }, 400);
    }).observe(urlbar, { attributes: true, attributeFilter: ["breakout-extend"] });
  }

  function revertTypedTextOnLeave(urlbar) {
    const input = urlbar.querySelector(".urlbar-input") || gURLBar.inputField;
    if (!input || typeof gURLBar.handleRevert !== "function") {
      return;
    }
    let navigatingAt = 0;
    urlbar.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          navigatingAt = Date.now();
        }
      },
      true
    );
    urlbar.addEventListener(
      "mousedown",
      (event) => {
        if (event.target.closest?.(".urlbarView, #urlbar-go-button")) {
          navigatingAt = Date.now();
        }
      },
      true
    );
    input.addEventListener("blur", () => {
      const browser = gBrowser.selectedBrowser;
      setTimeout(() => {
        if (gURLBar.focused || !document.hasFocus() || Date.now() - navigatingAt < 1500) {
          return;
        }
        if (urlbar.hasAttribute("zen-newtab")) {
          return;
        }
        try {
          if (browser && browser !== gBrowser.selectedBrowser) {
            if (browser.userTypedValue) {
              browser.userTypedValue = null;
            }
            return;
          }
          if (gBrowser.userTypedValue == null && !gURLBar.valueIsTyped) {
            return;
          }
          gURLBar.handleRevert();
          updateTitle();
        } catch (err) {
          console.error("[Zia] Could not restore the address:", err);
        }
      }, 0);
    });
  }

  let openOffset = 0;

  function desiredOpenTop() {
    return parseFloat(getComputedStyle(root).getPropertyValue("--zia-urlbar-open-top")) || 0;
  }

  let closedTextRect = null;
  let openOffsetX = 0;

  let clickedUrlbarAt = 0;

  function rememberClosedText() {
    const urlbar = gURLBar.textbox || document.getElementById("urlbar");
    if (!urlbar || urlbar.hasAttribute("breakout-extend") || root.getAttribute("zia-split") === "true") {
      return;
    }
    // At the bottom, the opened pop-up is pinned by its bottom edge to where
    // the closed bar sits, so it grows upwards instead of off the screen.
    const bar = urlbar.getBoundingClientRect();
    if (bar.width) {
      root.style.setProperty("--zia-url-left", `${Math.round(bar.left)}px`);
      root.style.setProperty("--zia-url-width", `${Math.round(bar.width)}px`);
      root.style.setProperty("--zia-url-bottom", `${Math.round(window.innerHeight - bar.bottom)}px`);
    }
    const title = document.getElementById("zia-url-title");
    const input = urlbar.querySelector(".urlbar-input");
    const titleRect = title?.getBoundingClientRect();
    const rect = titleRect?.width ? titleRect : input?.getBoundingClientRect();
    if (rect?.width) {
      closedTextRect = { left: rect.left, centerY: rect.top + rect.height / 2 };
    }
  }

  function alignOpenedUrlbar() {
    const urlbar = gURLBar.textbox || document.getElementById("urlbar");

    if (urlbar?.getAttribute("zen-floating-urlbar") === "true" && !urlbarAtBottom()) {
      root.style.setProperty("--zia-urlbar-open-offset", "0px");
      root.style.setProperty("--zia-urlbar-open-offset-x", "0px");
      return;
    }
    if (!urlbar?.hasAttribute("breakout-extend")) {
      return;
    }
    if (root.getAttribute("zia-split") === "true") {
      return;
    }
    const input = urlbar.querySelector(".urlbar-input");
    const inputRect = input?.getBoundingClientRect();

    // At the bottom the pop-up grows upwards from the bar, so the text always
    // stays where it was, however the bar was opened.
    const openedByClick = urlbarAtBottom() || Date.now() - clickedUrlbarAt < 1500;
    if (!openedByClick && openOffsetX) {
      openOffsetX = 0;
      root.style.setProperty("--zia-urlbar-open-offset-x", "0px");
    }
    if (openedByClick && closedTextRect && inputRect?.width) {
      const dx = closedTextRect.left - inputRect.left;
      const dy = closedTextRect.centerY - (inputRect.top + inputRect.height / 2);
      if (Math.abs(dx) > 0.5) {
        openOffsetX += dx;
        root.style.setProperty("--zia-urlbar-open-offset-x", `${openOffsetX}px`);
      }
      if (Math.abs(dy) > 0.5) {
        openOffset += dy;
        root.style.setProperty("--zia-urlbar-open-offset", `${openOffset}px`);
      }
      return;
    }

    const top = urlbar.getBoundingClientRect().top;
    const diff = desiredOpenTop() - top;
    if (Math.abs(diff) > 0.5) {
      openOffset += diff;
      root.style.setProperty("--zia-urlbar-open-offset", `${openOffset}px`);
    }
  }

  function alignOpenedUrlbarSoon() {
    // Straight away, before the opened bar is first drawn, so the text doesn't
    // visibly jump; the later passes only catch late layout changes.
    alignOpenedUrlbar();
    requestAnimationFrame(alignOpenedUrlbar);
    setTimeout(alignOpenedUrlbar, 60);
    setTimeout(alignOpenedUrlbar, 200);
  }


  // Restarts a CSS animation keyed on an attribute, then clears it.
  function replayAttribute(el, name, ms, value = "true") {
    el.removeAttribute(name);
    el.getBoundingClientRect();
    el.setAttribute(name, value);
    clearTimeout(el.ziaReplayTimers?.[name]);
    el.ziaReplayTimers = { ...el.ziaReplayTimers, [name]: setTimeout(() => el.removeAttribute(name), ms) };
  }

  // Back and forward slide through when clicked; reload and stop turn into
  // each other as a page starts and finishes loading (the motion itself is
  // in the CSS, keyed on these attributes).
  function animateNavButtons() {
    for (const id of ["back-button", "forward-button"]) {
      const button = document.getElementById(id);
      button?.addEventListener(
        "click",
        (event) => {
          if (event.button === 0 && !button.hasAttribute("disabled")) {
            replayAttribute(button, "zia-slide", 420);
          }
        },
        true
      );
    }
    const reload = document.getElementById("reload-button");
    const container = document.getElementById("stop-reload-button");
    if (!reload || !container) {
      return;
    }
    let showingStop = reload.hasAttribute("displaystop");
    new MutationObserver(() => {
      const now = reload.hasAttribute("displaystop");
      if (now === showingStop) {
        return;
      }
      showingStop = now;
      replayAttribute(container, "zia-morph", 450, now ? "to-stop" : "to-reload");
      // Reload's hover look (its arrowhead drawn back) isn't kept while
      // stop's showing: coming back, reload grew in whole and then snapped
      // to that look. It springs into it once it's in, if still hovered.
      if (now) {
        reload.ziaReloadCut?.(0, true);
      } else {
        // (once the grow-in has let go of it: its animation holds the
        // arrowhead's turn until then, and eased in under it, it jumped
        // to wherever the ease had got to as the animation ended)
        setTimeout(() => {
          if (!reload.hasAttribute("displaystop") && !container.hasAttribute("zia-morph") && container.matches(":hover")) {
            reload.ziaReloadCut?.(RELOAD_HOVER_CUT);
          }
        }, 470);
      }
    }).observe(reload, { attributes: true, attributeFilter: ["displaystop"] });
  }

  // Reload on hover: the arrowhead draws back 20 degrees round the circle
  // and the arc shortens with it, on Zia's spring. The CSS reads the angle
  // from --zia-reload-cut, eased here frame by frame.
  const RELOAD_HOVER_CUT = 20;
  const RELOAD_HOVER_MS = 380;

  // Shared by the reload hover animation; keep it with its remaining caller.
  const cubicBezier = (x1, y1, x2, y2) => (t) => {
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u - t;
      const dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
      if (Math.abs(x) < 1e-5 || !dx) {
        break;
      }
      u = Math.min(1, Math.max(0, u - x / dx));
    }
    return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  };

  function springReloadHover() {
    const button = document.getElementById("reload-button");
    if (!button) {
      return;
    }
    const ease = cubicBezier(0.3, 1.35, 0.5, 1);
    let cut = 0;
    let frame = 0;
    const go = (target) => {
      cancelAnimationFrame(frame);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        cut = target;
        button.style.setProperty("--zia-reload-cut", `${cut}deg`);
        return;
      }
      const from = cut;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / RELOAD_HOVER_MS);
        cut = from + (target - from) * ease(t);
        button.style.setProperty("--zia-reload-cut", `${cut}deg`);
        if (t < 1) {
          frame = requestAnimationFrame(step);
        }
      };
      frame = requestAnimationFrame(step);
    };
    button.addEventListener("mouseenter", () => {
      // (not while it's coming back in from stop: that springs it after)
      if (!button.parentElement?.hasAttribute("zia-morph")) {
        go(RELOAD_HOVER_CUT);
      }
    });
    button.addEventListener("mouseleave", () => go(0));
    button.ziaReloadCut = (target, instant = false) => {
      if (instant) {
        cancelAnimationFrame(frame);
        cut = target;
        button.style.setProperty("--zia-reload-cut", `${cut}deg`);
        return;
      }
      go(target);
    };
  }
  let workspaceSlot = null;
  let spaceLabel = null;
  let spaceLabelRequest = 0;
  const spaceIconCache = new Map();
  let movedIndicator = null;
  let movedFromSpace = null;
  let spaceAttrObserver = null;
  const MIRRORED_SPACE_ATTRS = ["haspinnedtabs", "collapsedpinnedtabs"];
  // The space's name left where Zen puts it, above the tabs, rather than
  // moved up beside the window buttons
  const SPACE_NAME_IN_LIST_PREF = "zia.sidebar.space-name-in-list";
  const spaceNameInList = () => Services.prefs.getBoolPref(SPACE_NAME_IN_LIST_PREF, false);

  function createWorkspaceSlot() {
    const topButtons = document.getElementById("zen-sidebar-top-buttons");
    if (!topButtons || !window.gZenWorkspaces) {
      return;
    }
    workspaceSlot = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    workspaceSlot.id = "zia-workspace-slot";
    const buttonBox = topButtons.querySelector(".titlebar-buttonbox-container");
    if (buttonBox) {
      buttonBox.after(workspaceSlot);
    } else {
      topButtons.prepend(workspaceSlot);
    }

    let queued = false;
    const onSpaceSwitch = () => {
      if (queued) {
        return;
      }
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!window.closed) {
          warmSpaceIcons();
          placeWorkspaceIndicator();
        }
      });
    };
    for (const type of ["ZenWorkspacesUIUpdate", "ZenWorkspaceDataChanged", "AfterWorkspacesSessionRestore"]) {
      window.addEventListener(type, onSpaceSwitch);
    }
    Services.prefs.addObserver(SPACE_NAME_IN_LIST_PREF, onSpaceSwitch);
    window.addEventListener("unload", () => Services.prefs.removeObserver(SPACE_NAME_IN_LIST_PREF, onSpaceSwitch));
    Services.prefs.addObserver("zen.workspaces.active", onSpaceSwitch);
    window.addEventListener("unload", () => Services.prefs.removeObserver("zen.workspaces.active", onSpaceSwitch));
    gBrowser.tabContainer.addEventListener("TabSelect", onSpaceSwitch);
    placeWorkspaceIndicator();
    warmSpaceIcons();

    setTimeout(onSpaceSwitch, 500);
    setTimeout(onSpaceSwitch, 2000);
  }

  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  function syncSpaceLabel(indicator) {
    if (!indicator) {
      return;
    }
    let workspace = null;
    try {
      workspace = gZenWorkspaces.getActiveWorkspace();
    } catch (err) {
      return;
    }
    if (!workspace) {
      return;
    }

    let label = spaceLabel || indicator.querySelector("#zia-space-label");
    if (!label) {
      label = document.createElementNS(XHTML_NS, "div");
      label.id = "zia-space-label";
    }
    spaceLabel = label;
    if (label.parentNode !== indicator) {
      indicator.prepend(label);
    }

    const rawIcon = typeof workspace.icon === "string" ? workspace.icon : "";

    const visibleIcon = rawIcon.replace(/[\s\u200b-\u200f\u2060\ufe00-\ufe0f\p{Cf}]/gu, "");
    const hasIcon = visibleIcon !== "";
    const icon = hasIcon ? rawIcon.trim() : "";

    const blank = /^[\s\u200b-\u200f\u2060\ufe00-\ufe0f]+|[\s\u200b-\u200f\u2060\ufe00-\ufe0f]+$/gu;
    let text = label.querySelector(".zia-space-name");
    if (!text) {
      label.textContent = "";
      text = document.createElementNS(XHTML_NS, "span");
      text.className = "zia-space-name";
      label.appendChild(text);
    }
    const name = (workspace.name || "").replace(blank, "");
    const request = ++spaceLabelRequest;
    const apply = (svg) => {
      text.textContent = name;
      const mark = label.querySelector(".zia-space-svg");
      label.removeAttribute("zia-icon");
      label.removeAttribute("zia-has-icon");
      label.removeAttribute("zia-has-svg");
      if (!hasIcon || (icon.endsWith(".svg") && !svg)) {
        mark?.remove();
        return;
      }
      if (!icon.endsWith(".svg")) {
        mark?.remove();
        label.setAttribute("zia-icon", icon);
        label.setAttribute("zia-has-icon", "true");
        return;
      }
      label.setAttribute("zia-has-svg", "true");
      let svgSlot = mark;
      if (!svgSlot) {
        svgSlot = document.createElementNS(XHTML_NS, "span");
        svgSlot.className = "zia-space-svg";
        label.prepend(svgSlot);
      }
      if (svgSlot.dataset.src !== icon || !svgSlot.firstChild) {
        svgSlot.replaceChildren(svg.cloneNode(true));
        svgSlot.dataset.src = icon;
      }
    };
    if (!hasIcon || !icon.endsWith(".svg") || !isOwnIconUrl(icon)) {
      apply(null);
      return;
    }
    const entry = readSpaceIcon(icon);
    if (entry.node) {
      apply(entry.node);
      return;
    }
    // Keep the complete previous label while a new icon is being loaded.
    // Cached icons are replaced synchronously, before the next browser paint.
    if (!text.textContent) {
      text.textContent = name;
    }
    entry.promise.then((node) => {
      if (request === spaceLabelRequest && label.isConnected) {
        apply(node);
      }
    });
  }

  function warmSpaceIcons() {
    for (const workspace of window.gZenWorkspaces?.getWorkspaces?.() || []) {
      const icon = typeof workspace.icon === "string" ? workspace.icon.trim() : "";
      if (icon.endsWith(".svg") && isOwnIconUrl(icon)) {
        readSpaceIcon(icon);
      }
    }
  }

  function readSpaceIcon(icon) {
    const cached = spaceIconCache.get(icon);
    if (cached) {
      return cached;
    }
    const entry = { node: null, promise: null };
    spaceIconCache.set(icon, entry);
    entry.promise = fetch(icon)
      .then((response) => response.text())
      .then((source) => {
        const colored = source
          .replace(/context-fill-opacity/g, "1")
          .replace(/context-stroke-opacity/g, "1")
          .replace(/context-fill/g, "currentColor")
          .replace(/context-stroke/g, "currentColor")
          .replace(/\bfill="(?:#000(?:000)?|black)"/gi, 'fill="currentColor"')
          .replace(/\bstroke="(?:#000(?:000)?|black)"/gi, 'stroke="currentColor"')
          .replace(/fill\s*:\s*(?:#000(?:000)?|black)/gi, "fill:currentColor")
          .replace(/stroke\s*:\s*(?:#000(?:000)?|black)/gi, "stroke:currentColor");
        const parsed = new DOMParser().parseFromString(colored, "image/svg+xml");
        const node = parsed.documentElement;
        if (!node || node.localName !== "svg") {
          throw new Error("Invalid workspace SVG");
        }
        cleanSvg(node);
        entry.node = document.importNode(node, true);
        return entry.node;
      })
      .catch(() => {
        // A resource mapping may not exist yet during the first icon-pack
        // startup. Drop failures so the next update can try again.
        spaceIconCache.delete(icon);
        return null;
      });
    return entry;
  }

  const OWN_ICON_SCHEMES = ["chrome:", "resource:"];

  function isOwnIconUrl(icon) {
    try {
      return OWN_ICON_SCHEMES.includes(new URL(icon, "chrome://browser/content/browser.xhtml").protocol);
    } catch (err) {
      return false;
    }
  }

  // An icon is only shapes: drop anything that could run or load something
  // before it goes into the browser's own window.
  function cleanSvg(svg) {
    for (const node of svg.querySelectorAll("script, foreignObject, iframe, embed, object, audio, video")) {
      node.remove();
    }
    for (const node of [svg, ...svg.querySelectorAll("*")]) {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        const isLink = name === "href" || name.endsWith(":href") || name === "src";
        if (name.startsWith("on") || (isLink && !value.startsWith("#")) || value.startsWith("javascript:")) {
          node.removeAttributeNode(attr);
        }
      }
    }
  }

  function removeSpaceLabel(indicator) {
    indicator?.querySelector("#zia-space-label")?.remove();
  }

  function mirrorSpaceAttributes(space) {
    for (const name of MIRRORED_SPACE_ATTRS) {
      if (space?.hasAttribute(name)) {
        workspaceSlot.setAttribute(name, space.getAttribute(name));
      } else {
        workspaceSlot.removeAttribute(name);
      }
    }
  }

  function placeWorkspaceIndicator() {
    if (!workspaceSlot) {
      return;
    }
    let space = null;
    let indicator = null;
    try {
      space = gZenWorkspaces.activeWorkspaceElement;
      indicator = space?.indicator;
    } catch (err) {
      return;
    }

    const inList = spaceNameInList();
    setFlag("zia-space-name-in-list", inList);
    if (inList) {
      indicator = null;
      spaceAttrObserver?.disconnect();
      mirrorSpaceAttributes(null);
    }

    if (movedIndicator && movedIndicator !== indicator && movedFromSpace?.isConnected) {
      removeSpaceLabel(movedIndicator);
      movedFromSpace.prepend(movedIndicator);
      movedIndicator = null;
      movedFromSpace = null;
    }

    if (indicator && indicator.parentNode !== workspaceSlot) {
      workspaceSlot.append(indicator);
      movedIndicator = indicator;
      movedFromSpace = space;
    }

    if (inList) {
      setFlag("zia-workspace-slot", false);
      return;
    }

    syncSpaceLabel(indicator);

    spaceAttrObserver?.disconnect();
    mirrorSpaceAttributes(space);
    if (space) {
      spaceAttrObserver = new MutationObserver(() => mirrorSpaceAttributes(space));
      spaceAttrObserver.observe(space, { attributes: true, attributeFilter: MIRRORED_SPACE_ATTRS });
    }
    setFlag("zia-workspace-slot", !!indicator);
  }

  function searchEngineHomePage(engine) {
    try {
      if (engine.searchForm) {
        return engine.searchForm;
      }
    } catch (err) {
      noteError("new tabs: searchEngineHomePage", err);
    }
    try {
      const prePath = engine.getSubmission("zia").uri.prePath;
      return prePath ? `${prePath}/` : null;
    } catch (err) {
      return null;
    }
  }

  let searchHomeUrl = null;
  // the address Zia itself made the new tab page, so it only ever undoes
  // its own: a new tab page an extension set is left as it is
  let ziaNewTabUrl = null;

  // An extension's new tab page (Yet another speed dial and the like), if
  // one is in charge, put back after Zia's own is undone
  async function restoreExtensionNewTab(AboutNewTabModule) {
    try {
      const { ExtensionSettingsStore } = ChromeUtils.importESModule("resource://gre/modules/ExtensionSettingsStore.sys.mjs");
      await ExtensionSettingsStore.initialize();
      const setting = ExtensionSettingsStore.getSetting("url_overrides", "newTabURL");
      if (setting?.value) {
        AboutNewTabModule.newTabURL = setting.value;
      }
    } catch (err) {
      noteError("new tabs: restoreExtensionNewTab", err);
    }
  }

  // the new tab page as it is now: Zia's, an extension's, or Zen's own
  function currentNewTabUrl() {
    try {
      const AboutNewTabModule =
        window.AboutNewTab ||
        ChromeUtils.importESModule("resource:///modules/AboutNewTab.sys.mjs").AboutNewTab;
      return AboutNewTabModule.newTabURL || "about:newtab";
    } catch (err) {
      return "about:newtab";
    }
  }

  function newTabSearchEnabled() {
    return Services.prefs.getBoolPref("zia.newtab.search-engine", true);
  }

  async function applyNewTabPage() {
    try {
      const AboutNewTabModule =
        window.AboutNewTab ||
        ChromeUtils.importESModule("resource:///modules/AboutNewTab.sys.mjs").AboutNewTab;

      if (!newTabSearchEnabled()) {
        searchHomeUrl = null;
        // only Zia's own page is undone (turned off while running); one an
        // extension set stays, and is put back if Zia had replaced it
        if (ziaNewTabUrl && AboutNewTabModule.newTabURL === ziaNewTabUrl) {
          AboutNewTabModule.resetNewTabURL();
          await restoreExtensionNewTab(AboutNewTabModule);
        }
        ziaNewTabUrl = null;
        return;
      }

      const search =
        Services.search ||
        ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs").SearchService;
      await search.init();
      const engine = await search.getDefault();
      searchHomeUrl = (engine && searchEngineHomePage(engine)) || null;
      if (!searchHomeUrl) {
        console.warn("[Zia] Couldn't find the search engine's home page; keeping Zen's new tab page.");
        return;
      }
      try {
        AboutNewTabModule.newTabURL = searchHomeUrl;
        ziaNewTabUrl = searchHomeUrl;
      } catch (err) {
        noteError("new tabs: applyNewTabPage", err);
      }
    } catch (err) {
      console.error("[Zia] Could not set the new tab page:", err);
    }
  }

  function redirectBlankNewTab(browser, location, flags) {
    if (!searchHomeUrl || !newTabSearchEnabled()) {
      return;
    }
    if (flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) {
      return;
    }
    if (location?.spec !== "about:newtab") {
      return;
    }
    try {
      browser.loadURI(Services.io.newURI(searchHomeUrl), {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_REPLACE_HISTORY,
      });
    } catch (err) {
      console.error("[Zia] Could not open the search page in the new tab:", err);
    }
  }

  // Optional: Cmd/Ctrl+T leaves the address bar ready to type in, with the
  // search page showing behind it (off: the page's own search box)
  const focusAddressBarOnNewTab = () => Services.prefs.getBoolPref("zia.newtab.focus-address-bar", false);

  function keepNewTabUrlbar(tab) {
    const focus = () => {
      if (gBrowser.selectedTab !== tab || tab.ziaTypedInPage) {
        return;
      }
      if (!gURLBar.focused) {
        gURLBar.focus();
        gURLBar.select();
      }
    };
    // the search page loading after can pull focus to its own box: put it
    // back, until something's been typed or clicked in the page
    tab.linkedBrowser?.addEventListener("mousedown", () => (tab.ziaTypedInPage = true), { once: true });
    requestAnimationFrame(focus);
    for (const ms of [250, 700, 1500]) {
      setTimeout(() => {
        if (document.activeElement === tab.linkedBrowser) {
          focus();
        }
      }, ms);
    }
  }

  function closeNewTabUrlbar(tab) {
    if (!searchHomeUrl || !newTabSearchEnabled()) {
      return;
    }
    if (focusAddressBarOnNewTab()) {
      keepNewTabUrlbar(tab);
      return;
    }
    requestAnimationFrame(() => {
      try {
        const urlbar = gURLBar;
        if (!urlbar?.focused) {
          return;
        }
        if (gBrowser.selectedTab !== tab) {
          return;
        }
        urlbar.view?.close();
        urlbar.blur();
        gBrowser.selectedBrowser?.focus();
      } catch (err) {
        noteError("new tabs: closeNewTabUrlbar", err);
      }
    });
  }

  function watchNewTabPage() {
    applyNewTabPage();
    gBrowser.tabContainer.addEventListener("TabOpen", (event) => closeNewTabUrlbar(event.target));
    Services.obs.addObserver(applyNewTabPage, "browser-search-engine-modified");
    Services.prefs.addObserver("zia.newtab.search-engine", applyNewTabPage);
    window.addEventListener("unload", () => {
      Services.obs.removeObserver(applyNewTabPage, "browser-search-engine-modified");
      Services.prefs.removeObserver("zia.newtab.search-engine", applyNewTabPage);
    });
  }

  // Closing one of a split's two tabs: Zen breaks the split up, each tab a
  // row of its own again, so the closing one shrank away as a row with the
  // one left sliding up from under it, a jump where the split had been. It
  // goes at once, taking no room, and the one left is where the split was.
  function closeSplitTabsInPlace() {
    gBrowser.tabContainer.addEventListener(
      "TabClose",
      (event) => {
        const tab = event.target;
        const split = tab?.group?.hasAttribute?.("split-view-group") ? tab.group : null;
        if (split && split.tabs.filter((t) => !t.closing || t === tab).length <= 2) {
          tab.setAttribute("zia-split-closing", "true");
        }
      },
      true
    );
  }

  function watchTabAnimations() {
    gBrowser.tabContainer.addEventListener("TabOpen", (event) => {
      const tab = event.target;
      if (tab.hasAttribute("zen-essential")) {
        return;
      }
      tab.setAttribute("zia-opening", "true");
      setTimeout(() => tab.removeAttribute("zia-opening"), 350);
    });

    const essentials = document.getElementById("zen-essentials");
    if (!essentials) {
      return;
    }
    const known = new WeakSet(essentials.querySelectorAll(".tabbrowser-tab"));
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node.classList?.contains("tabbrowser-tab") || known.has(node)) {
            continue;
          }
          known.add(node);
          if (node.hasAttribute("zia-to-essential")) {
            continue;
          }
          node.setAttribute("zia-essential-enter", "true");
          setTimeout(() => node.removeAttribute("zia-essential-enter"), 450);
        }
      }
    }).observe(essentials, { childList: true, subtree: true });
  }

  function hideWwwInUrlbar() {
    const original = gURLBar?._zenTrimURL;
    if (typeof original !== "function" || original.__zia) {
      return;
    }
    const wrapped = function (url) {
      let trimmed = original.call(this, url);
      if (typeof trimmed !== "string") {
        return trimmed;
      }
      trimmed = plainAddress(trimmed);
      if (gURLBar.hasAttribute("breakout-extend")) {
        return trimmed;
      }
      return trimmed;
    };
    wrapped.__zia = true;
    gURLBar._zenTrimURL = wrapped;
    try {
      gURLBar.setURI();
    } catch (err) {
      noteError("tab animations and folder bounce: hideWwwInUrlbar", err);
    }
  }
  let edgeFrame = null;
  let edgeRetryTimer = null;
  let edgeRetries = 0;
  const EDGE_MAX_FIX = 24;
  const EDGE_RETRY_MS = 100;
  const EDGE_MAX_RETRIES = 30;

  function visibleRect(el) {
    const rect = el?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function isSliding(el) {
    for (let node = el; node && node.id !== "navigator-toolbox"; node = node.parentElement) {
      const style = getComputedStyle(node);

      const transform = style.transform || "none";
      const moved =
        transform !== "none" &&
        !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(transform) &&
        !/^matrix3d\(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1\)$/.test(transform);
      const translate = style.translate || "none";
      if (moved || !/^(none|0px( 0px)?( 0px)?)$/.test(translate)) {
        return true;
      }
    }
    return false;
  }

  function retryEdgeAlignSoon() {
    if (edgeRetryTimer || edgeRetries >= EDGE_MAX_RETRIES) {
      return;
    }
    edgeRetries++;
    edgeRetryTimer = setTimeout(() => {
      edgeRetryTimer = null;
      scheduleEdgeAlign(true);
    }, EDGE_RETRY_MS);
  }

  const halfPx = (value) => `${Math.round(value * 2) / 2}px`;

  function alignRightEdges() {
    edgeFrame = null;
    const sidebar = document.getElementById("navigator-toolbox");
    if (!sidebar || document.documentElement.getAttribute("zen-sidebar-expanded") !== "true") {
      return;
    }

    let essentialsRight = null;
    let essentialsLeft = null;
    let essentialTile = null;
    // only the essentials on screen: other spaces' are kept too, some shifted
    // aside, and measuring those pushed the tabs out past the sidebar's edge
    const grid = window.gZenWorkspaces?.getCurrentEssentialsContainer?.() || document.getElementById("zen-essentials");
    for (const bg of grid?.querySelectorAll(".tabbrowser-tab[zen-essential] > .tab-stack > .tab-background") || []) {
      const rect = bg.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) === false ? null : visibleRect(bg);
      if (rect) {
        essentialTile ||= bg;
        essentialsRight = Math.max(essentialsRight ?? -Infinity, rect.right);
        essentialsLeft = Math.min(essentialsLeft ?? Infinity, rect.left);
      }
    }
    if (essentialsRight === null) {
      root.style.removeProperty("--zia-tab-right-fix");
      root.style.removeProperty("--zia-folder-right-fix");
      root.style.removeProperty("--zia-folder-left-fix");
      return;
    }

    const space = gZenWorkspaces?.activeWorkspaceElement || sidebar;

    if ((isSliding(space) || isSliding(essentialTile)) && edgeRetries < EDGE_MAX_RETRIES) {
      retryEdgeAlignSoon();
      return;
    }
    const currentFix = (name) => parseFloat(root.style.getPropertyValue(name)) || 0;
    let suspicious = false;

    const tab = [...space.querySelectorAll(".tabbrowser-tab:not([zen-essential])")].find(
      (t) => !t.closest("zen-folder, tab-group:not([split-view-group])") && visibleRect(t.querySelector(".tab-background"))
    );
    // (a tab still opening is measured once it's in place: measured as it
    // came in, the tabs kept a wrong right edge until the sidebar was
    // resized)
    if (tab && (isSliding(tab) || tab.getAnimations().length) && edgeRetries < EDGE_MAX_RETRIES) {
      retryEdgeAlignSoon();
      return;
    }
    if (tab) {
      const rect = visibleRect(tab.querySelector(".tab-background"));

      const fix = rect.right + currentFix("--zia-tab-right-fix") - essentialsRight;
      if (Math.abs(fix) <= EDGE_MAX_FIX) {
        root.style.setProperty("--zia-tab-right-fix", halfPx(fix));
      } else {
        suspicious = true;
      }
    }

    if (suspicious) {
      retryEdgeAlignSoon();
    } else {
      edgeRetries = 0;
    }
  }

  function scheduleEdgeAlign(isRetry = false) {
    if (isRetry !== true) {
      edgeRetries = 0;
    }
    if (!edgeFrame) {
      edgeFrame = requestAnimationFrame(alignRightEdges);
    }
  }

  function scheduleEdgeAlignAfterSwitch() {
    scheduleEdgeAlign();
    setTimeout(scheduleEdgeAlign, 350);
    setTimeout(scheduleEdgeAlign, 800);
  }

  function watchRightEdges() {
    const sidebar = document.getElementById("navigator-toolbox");
    if (!sidebar) {
      return;
    }
    new ResizeObserver(scheduleEdgeAlign).observe(sidebar);
    const essentials = document.getElementById("zen-essentials");
    if (essentials) {
      new ResizeObserver(scheduleEdgeAlign).observe(essentials);
      new MutationObserver(scheduleEdgeAlign).observe(essentials, { childList: true, subtree: true });
    }
    new MutationObserver(scheduleEdgeAlign).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["zen-sidebar-expanded"],
    });
    const tabs = document.getElementById("tabbrowser-tabs");
    if (tabs) {
      new MutationObserver(scheduleEdgeAlign).observe(tabs, {
        subtree: true,
        attributes: true,
        attributeFilter: ["collapsed"],
      });
    }
    gBrowser.tabContainer.addEventListener("TabSelect", () => scheduleEdgeAlign());
    for (const type of ["TabOpen", "TabClose"]) {
      gBrowser.tabContainer.addEventListener(type, () => scheduleEdgeAlignAfterSwitch());
    }
    const onSpaceSwitch = () => scheduleEdgeAlignAfterSwitch();
    for (const type of ["TabGroupExpand", "TabGroupCollapse", "TabGrouped", "TabUngrouped"]) {
      window.addEventListener(type, onSpaceSwitch);
    }
    Services.prefs.addObserver("zen.workspaces.active", onSpaceSwitch);
    window.addEventListener("ZenWorkspacesUIUpdate", onSpaceSwitch);
    window.addEventListener("unload", () => Services.prefs.removeObserver("zen.workspaces.active", onSpaceSwitch));
    scheduleEdgeAlign();
    setTimeout(scheduleEdgeAlign, 600);
    setTimeout(scheduleEdgeAlign, 2000);
  }

  // No scrollbar down the tab list: Zen gives each space's list its own
  // (shown once it overflows), inside its scroll box, where the stylesheet's
  // "no scrollbars" didn't reach. Set on the scroll box itself, for every
  // space, including ones made later.
  function hideTabListScrollbars() {
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbox) {
      return;
    }
    const apply = () => {
      for (const box of document.querySelectorAll("zen-workspace arrowscrollbox, #tabbrowser-arrowscrollbox")) {
        const inner = box.scrollbox || box.shadowRoot?.querySelector('[part~="scrollbox"]');
        if (inner && inner.style.getPropertyValue("scrollbar-width") !== "none") {
          inner.style.setProperty("scrollbar-width", "none", "important");
        }
      }
    };
    let frame = null;
    new MutationObserver(() => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = null;
          apply();
        });
      }
    }).observe(toolbox, { childList: true, subtree: true });
    apply();
  }
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

  const mediaColorCache = new Map();

  function artUrlOf(card) {
    const artwork = card.querySelector(".zen-media-focus-button[zia-art]")?.getAttribute("zia-art");
    if (artwork) {
      return artwork;
    }
    const favicon = card.querySelector(".zen-media-focus-button[zia-favicon]")?.getAttribute("zia-favicon");
    if (favicon) {
      return favicon;
    }
    const img = card.querySelector(".zen-media-focus-button image, .zen-media-focus-button .toolbarbutton-icon");
    if (!img) {
      return "";
    }
    const src = img.getAttribute("src") || img.src || "";
    if (src) {
      return src;
    }
    const listStyle = getComputedStyle(img).listStyleImage || "";
    const match = listStyle.match(/url\(["']?(.*?)["']?\)/);
    return match ? match[1] : "";
  }

  function boost([r, g, b]) {
    const avg = (r + g + b) / 3;
    const k = 1.6;
    return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(avg + (v - avg) * k))));
  }

  function readArtColors(url) {
    return new Promise((resolve) => {
      if (!url) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const size = 24;
          const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);
          const halves = [[0, 0, 0, 0], [0, 0, 0, 0]];
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const i = (y * size + x) * 4;
              if (data[i + 3] < 128) {
                continue;
              }
              const h = halves[x < size / 2 ? 0 : 1];
              h[0] += data[i];
              h[1] += data[i + 1];
              h[2] += data[i + 2];
              h[3]++;
            }
          }
          const colors = halves.map((h) =>
            h[3] ? boost([h[0] / h[3], h[1] / h[3], h[2] / h[3]]) : null
          );
          if (!colors[0] && !colors[1]) {
            resolve(null);
            return;
          }
          const a = colors[0] || colors[1];
          const b = colors[1] || colors[0];
          resolve([`rgb(${a.join(", ")})`, `rgb(${b.join(", ")})`]);
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // The favicon's own colours, strongest first: up to three hues it has a
  // fair amount of, so the selected tab's glow can blend them. Grey, white and
  // black icons give null and the glow stays white.
  function readFaviconPalette(url) {
    return new Promise((resolve) => {
      if (!url) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const size = 32;
          const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);
          const bins = Array.from({ length: 12 }, () => [0, 0, 0, 0]);
          for (let i = 0; i < data.length; i += 4) {
            const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
            if (a < 128) {
              continue;
            }
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const sat = max ? (max - min) / max : 0;
            if (sat < 0.3 || max < 60) {
              continue;
            }
            let hue;
            if (max === r) {
              hue = ((g - b) / (max - min) + 6) % 6;
            } else if (max === g) {
              hue = (b - r) / (max - min) + 2;
            } else {
              hue = (r - g) / (max - min) + 4;
            }
            const bin = bins[Math.floor(hue * 2) % 12];
            bin[0] += r * sat;
            bin[1] += g * sat;
            bin[2] += b * sat;
            bin[3] += sat;
          }
          const ranked = bins.filter((bin) => bin[3] >= 6).sort((x, y) => y[3] - x[3]);
          if (!ranked.length) {
            resolve(null);
            return;
          }
          const top = ranked[0][3];
          const colors = ranked
            .filter((bin) => bin[3] >= top * 0.12)
            .slice(0, 3)
            .map((bin) => bin.slice(0, 3).map((v) => Math.round(v / bin[3])));
          // One colour: blend a lighter and a deeper shade of it instead.
          if (colors.length === 1) {
            const [r, g, b] = colors[0];
            colors.push([r, g, b].map((v) => Math.round(v + (255 - v) * 0.35)));
            colors.push([r, g, b].map((v) => Math.round(v * 0.7)));
          } else if (colors.length === 2) {
            colors.push(colors[0].map((v, k) => Math.round((v + colors[1][k]) / 2)));
          }
          resolve(colors.map((c) => `rgb(${c.join(", ")})`));
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  const faviconPaletteCache = new Map();

  async function faviconPalette(tab) {
    const url = tab.getAttribute("image") || "";
    let palette = faviconPaletteCache.get(url);
    if (palette === undefined) {
      palette = await readFaviconPalette(url);
      faviconPaletteCache.set(url, palette);
    }
    return (tab.getAttribute("image") || "") === url ? palette : undefined;
  }

  async function glowSelectedTab() {
    const tab = gBrowser.selectedTab;
    if (!tab || tab.hasAttribute("zen-essential") || !Services.prefs.getBoolPref("zia.tabs.favicon-glow", false)) {
      return;
    }
    // A split is one pill: its left side glows in the left tab's colours and
    // its right side in the right tab's.
    const split = tab.closest("tab-group[split-view-group]");
    if (split) {
      const tabs = [...split.querySelectorAll(".tabbrowser-tab")];
      const palettes = await Promise.all(tabs.map(faviconPalette));
      if (!tabs.length || palettes.every((palette) => !palette)) {
        split.removeAttribute("zia-glow");
        return;
      }
      const white = "rgba(255, 255, 255, 0.23)";
      const left = palettes[0]?.[0] || white;
      const right = palettes[palettes.length - 1]?.[0] || white;
      split.style.setProperty("--zia-glow-1", left);
      split.style.setProperty("--zia-glow-2", right);
      split.style.setProperty("--zia-glow-3", palettes[0]?.[1] || palettes[palettes.length - 1]?.[1] || white);
      split.setAttribute("zia-glow", "true");
      return;
    }
    const palette = await faviconPalette(tab);
    if (palette === undefined) {
      return;
    }
    if (palette) {
      palette.forEach((color, i) => tab.style.setProperty(`--zia-glow-${i + 1}`, color));
      tab.setAttribute("zia-glow", "true");
    } else {
      tab.removeAttribute("zia-glow");
    }
  }

  function watchSelectedTabGlow() {
    gBrowser.tabContainer.addEventListener("TabSelect", glowSelectedTab);
    gBrowser.tabContainer.addEventListener("TabAttrModified", (event) => {
      if (!event.detail?.changed?.includes("image")) {
        return;
      }
      const split = gBrowser.selectedTab?.closest("tab-group[split-view-group]");
      if (event.target === gBrowser.selectedTab || (split && split.contains(event.target))) {
        glowSelectedTab();
      }
    });
    for (const type of ["TabGrouped", "TabUngrouped"]) {
      window.addEventListener(type, () => setTimeout(glowSelectedTab, 50));
    }
    const onPref = () => {
      glowSelectedTab();
      repaintSoundTabs();
    };
    Services.prefs.addObserver("zia.tabs.favicon-glow", onPref);
    window.addEventListener("unload", () => Services.prefs.removeObserver("zia.tabs.favicon-glow", onPref));
    glowSelectedTab();
  }

  const ARTWORK_WAIT_MS = 1500;

  async function updateCardGlow(card) {
    const url = artUrlOf(card);
    if (card.__ziaArtUrl === url) {
      return;
    }
    card.__ziaArtUrl = url;

    const isArtwork = !!card.querySelector(".zen-media-focus-button[zia-art]");
    if (!isArtwork) {
      if (!card.hasAttribute("zia-glow-ready")) {
        card.setAttribute("zia-glow-pending", "true");
      }
      await new Promise((resolve) => setTimeout(resolve, ARTWORK_WAIT_MS));
      if (card.__ziaArtUrl !== url) {
        return;
      }
    }

    let colors = mediaColorCache.get(url);
    if (colors === undefined) {
      colors = await readArtColors(url);
      mediaColorCache.set(url, colors);
    }
    if (card.__ziaArtUrl !== url) {
      return;
    }
    if (colors) {
      card.style.setProperty("--zia-media-glow-a", colors[0]);
      card.style.setProperty("--zia-media-glow-b", colors[1]);
    } else {
      card.style.removeProperty("--zia-media-glow-a");
      card.style.removeProperty("--zia-media-glow-b");
    }
    card.removeAttribute("zia-glow-pending");
    card.setAttribute("zia-glow-ready", "true");
    card.__ziaColors = colors;
    paintSoundBars(card, colors);
  }

  const soundBarCache = new Map();

  function lighten(color, amount = 0.35) {
    const m = String(color).match(/\d+(\.\d+)?/g);
    if (!m) {
      return "rgb(255, 255, 255)";
    }
    const [r, g, b] = m.map(Number).map((v) => Math.round(v + (255 - v) * amount));
    return `rgb(${r}, ${g}, ${b})`;
  }

  let soundBarToken = 0;
  // Four bars; they shrink into four dots when muted.
  const BAR_X = [1.6, 5.2, 8.8, 12.4];
  const BAR_W = 2;
  const BAR_REST = [
    [4.5, 7],
    [2.5, 11],
    [3.5, 9],
    [5.25, 5.5],
  ];

  // The bars stand still when the system asks for less motion (macOS's
  // Reduce motion, Windows' Animation effects off, GNOME's Reduce
  // animation), unless the "always move" option is on
  const SOUND_BARS_ALWAYS_PREF = "zia.sound-bars.always-move";
  const soundBarsAlwaysMove = () => Services.prefs.getBoolPref(SOUND_BARS_ALWAYS_PREF, false);

  function soundBarImages(colors) {
    const always = soundBarsAlwaysMove();
    const key = `${colors ? colors.join("|") : "white"}|${always}`;
    let images = soundBarCache.get(key);
    if (images) {
      return images;
    }
    const a = colors ? lighten(colors[0]) : "rgb(255, 255, 255)";
    const b = colors ? lighten(colors[1]) : "rgb(255, 255, 255)";
    const gradient = `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="1.6" y1="0" x2="14.4" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
    const moving = [[0.55], [0.68], [0.5], [0.74]];
    const wave =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${gradient}` +
      `<style>rect{transform-box:fill-box;transform-origin:center;animation:grow .26s cubic-bezier(.2,.9,.3,1) both,z .6s .26s ease-in-out infinite alternate}` +
      moving.map(([d], i) => `.b${i}{animation-duration:.26s,${d}s;animation-delay:0s,${(0.26 + i * 0.05).toFixed(2)}s}`).join("") +
      `@keyframes grow{from{height:2px;y:7px}to{height:11px;y:2.5px}}` +
      `@keyframes z{from{transform:scaleY(.22)}to{transform:scaleY(1)}}` +
      (always ? "" : `@media (prefers-reduced-motion:reduce){rect{animation:none;transform:scaleY(.6)}}`) +
      `</style>` +
      `<g fill="url(#g)">` +
      BAR_X.map((x, i) => `<rect class="b${i}" x="${x}" y="2.5" width="${BAR_W}" height="11" rx="1"/>`).join("") +
      `</g></svg>`;
    const dots =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${gradient}` +
      `<style>rect{animation:shrink .28s cubic-bezier(.4,0,.2,1) forwards}@keyframes shrink{to{height:${BAR_W}px;y:${8 - BAR_W / 2}px}}` +
      (always ? "" : `@media (prefers-reduced-motion:reduce){rect{animation-duration:1ms}}`) +
      `</style>` +
      `<g fill="url(#g)">` +
      BAR_X.map((x, i) => `<rect x="${x}" y="${BAR_REST[i][0]}" width="${BAR_W}" height="${BAR_REST[i][1]}" rx="1"/>`).join("") +
      `</g></svg>`;
    const still =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${gradient}` +
      `<g fill="url(#g)">` +
      BAR_X.map((x, i) => `<rect x="${x}" y="${BAR_REST[i][0]}" width="${BAR_W}" height="${BAR_REST[i][1]}" rx="1"/>`).join("") +
      `</g></svg>`;
    const encoded = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
    images = { waveData: encoded(wave), dotsData: encoded(dots), stillData: encoded(still) };
    soundBarCache.set(key, images);
    return images;
  }

  function freshSoundBars(colors) {
    const images = soundBarImages(colors);
    const n = ++soundBarToken;
    return {
      wave: `url("${images.waveData}#${n}")`,
      dots: `url("${images.dotsData}#${n}")`,
      still: `url("${images.stillData}")`,
    };
  }

  function applyCardSoundBars(element) {
    const fresh = freshSoundBars(element.__ziaColors ?? null);
    element.style.setProperty("--zia-sound-wave", fresh.wave);
    element.style.setProperty("--zia-sound-still", fresh.dots);
    element.style.setProperty("--zia-sound-muted", fresh.dots);
  }

  function watchCardSoundState(element) {
    if (element.__ziaSoundWatch) {
      return;
    }
    element.__ziaSoundWatch = true;
    let last = "";
    new MutationObserver(() => {
      const state = `${element.classList.contains("playing")}|${element.hasAttribute("muted")}`;
      if (state !== last) {
        last = state;
        applyCardSoundBars(element);
      }
    }).observe(element, { attributes: true, attributeFilter: ["class", "muted"] });
  }

  const soundBarCards = new Set();

  function paintSoundBars(card, colors) {
    soundBarCards.add(card);
    card.__ziaColors = colors;
    applyCardSoundBars(card);
    watchCardSoundState(card);
    repaintSoundTabs();
  }

  // A tab's bars are drawn before its player has read the artwork's colours
  // (or before Zia knows which player is the tab's), so recolour them as soon
  // as either arrives. Tabs whose colours haven't changed are left alone.
  function repaintSoundTabs() {
    for (const tab of gBrowser.tabs) {
      paintTabSoundBars(tab);
    }
  }

  // The colours of the artwork playing in this tab, from its player card.
  function tabMediaColors(tab) {
    const toolbar = document.getElementById("zen-media-controls-toolbar");
    for (const element of toolbar?.querySelectorAll(".zen-media-card") || []) {
      if (element.__ziaCard?.browser === tab.linkedBrowser) {
        return element.__ziaColors ?? null;
      }
    }
    return null;
  }

  // Until the player has the artwork's colours, the site's own colours stand in.
  function tabFallbackColors(tab) {
    const url = tab.getAttribute("image") || "";
    const palette = faviconPaletteCache.get(url);
    if (palette === undefined) {
      readFaviconPalette(url).then((result) => {
        faviconPaletteCache.set(url, result);
        if (result) {
          paintTabSoundBars(tab);
        }
      });
      return null;
    }
    return palette ? [palette[0], palette[1] || palette[0]] : null;
  }

  // Tab bars are white. With the tint option on, tabs (not essentials) take
  // the artwork's colours instead.
  function applyTabSoundBars(tab) {
    const essential = tab.hasAttribute("zen-essential");
    const tinted = !essential && Services.prefs.getBoolPref("zia.tabs.favicon-glow", false);
    const colors = tinted ? tabMediaColors(tab) || tabFallbackColors(tab) : null;
    const key = `${colors ? colors.join("|") : "white"}|${essential}|${tab.hasAttribute("soundplaying")}|${tab.hasAttribute("muted")}|${soundBarsAlwaysMove()}`;
    if (tab.__ziaSoundKey === key) {
      return;
    }
    tab.__ziaSoundKey = key;
    const fresh = freshSoundBars(colors);
    tab.style.setProperty("--zia-sound-wave", fresh.wave);
    tab.style.setProperty("--zia-sound-muted", fresh.dots);
  }

  // Zen's speaker button makes way for the bars, in the same spot.
  function ensureTabSound(tab) {
    if (tab.querySelector(".zia-tab-sound")) {
      return;
    }
    const content = tab.querySelector(".tab-content");
    if (!content) {
      return;
    }
    const bars = document.createElementNS(XHTML_NS, "span");
    bars.className = "zia-tab-sound";
    bars.setAttribute("role", "button");
    bars.addEventListener("mousedown", (event) => event.stopPropagation());
    bars.addEventListener("click", (event) => {
      event.stopPropagation();
      tab.toggleMuteAudio();
    });
    const before =
      content.querySelector(":scope > .tab-audio-button") || content.querySelector(":scope > .tab-label-container");
    content.insertBefore(bars, before);
  }

  function paintTabSoundBars(tab) {
    if (tab?.hasAttribute("soundplaying") || tab?.hasAttribute("muted")) {
      ensureTabSound(tab);
      applyTabSoundBars(tab);
      const bars = tab.querySelector(".zia-tab-sound");
      bars?.setAttribute("title", tab.hasAttribute("muted") ? "Unmute tab" : "Mute tab");
    }
  }

  function watchTabSoundBars() {
    // the "always move" option changed: every playing tab and player redrawn
    const redrawAll = () => {
      for (const tab of gBrowser.tabs) {
        paintTabSoundBars(tab);
      }
      for (const card of soundBarCards) {
        if (!card.isConnected) {
          soundBarCards.delete(card);
          continue;
        }
        try {
          applyCardSoundBars(card);
        } catch (err) {
          noteError("music and sound bars: redraw", err);
        }
      }
    };
    Services.prefs.addObserver(SOUND_BARS_ALWAYS_PREF, redrawAll);
    window.addEventListener("unload", () => Services.prefs.removeObserver(SOUND_BARS_ALWAYS_PREF, redrawAll));
    gBrowser.tabContainer.addEventListener("TabAttrModified", (event) => {
      const changed = event.detail?.changed || [];
      if (changed.includes("soundplaying") || changed.includes("muted")) {
        paintTabSoundBars(event.target);
      }
      if (changed.includes("image")) {
        for (const element of document.querySelectorAll(".zen-media-card")) {
          const card = element.__ziaCard;
          if (card?.browser === event.target.linkedBrowser) {
            try {
              card.updateIcon();
            } catch (err) {
              noteError("music and sound bars: watchTabSoundBars", err);
            }
          }
        }
      }
    });
    for (const tab of gBrowser.tabs) {
      paintTabSoundBars(tab);
    }
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  let ringCount = 0;

  function ensureRing(button) {
    if (!button || button.querySelector(":scope > .zia-ring")) {
      return;
    }
    const id = `zia-ring-gradient-${++ringCount}`;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "zia-ring");
    svg.setAttribute("viewBox", "0 0 46 46");
    svg.setAttribute("aria-hidden", "true");

    const make = (tag, attrs, parent) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attrs)) {
        el.setAttribute(name, value);
      }
      parent.appendChild(el);
      return el;
    };
    const gradient = make("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "1" }, make("defs", {}, svg));
    make("stop", { offset: "0", style: "stop-color: var(--zia-media-glow-a)" }, gradient);
    make("stop", { offset: "1", style: "stop-color: var(--zia-media-glow-b)" }, gradient);
    const shape = { x: "1", y: "1", width: "44", height: "44", rx: "10", fill: "none", "stroke-width": "2", pathLength: "100" };
    make("rect", { ...shape, class: "zia-ring-track" }, svg);
    make("rect", {
      ...shape,
      class: "zia-ring-fill",
      stroke: `url(#${id})`,
      "stroke-linecap": "round",
      "stroke-dasharray": "0 100",
      "stroke-opacity": "0",
    }, svg);
    button.appendChild(svg);
  }

  const faviconTints = new Map();

  function tintFromColors(colors) {
    const m = String(colors?.[0] || "").match(/\d+(\.\d+)?/g);
    if (!m) {
      return "rgb(44, 44, 46)";
    }

    const [r, g, b] = m.map(Number).map((v) => Math.round(v * 0.32 + 26));
    return `rgb(${r}, ${g}, ${b})`;
  }

  async function showFaviconTile(card, button, art) {
    if (art) {
      button.removeAttribute("zia-favicon");
      button.removeAttribute("zia-initial");
      return;
    }
    const tab = card.browser && gBrowser.getTabForBrowser(card.browser);

    let icon =
      tab?.getAttribute("image") ||
      (tab && gBrowser.getIcon?.(tab)) ||
      card.browser?.mIconURL ||
      (card.browser?.currentURI?.spec ? `page-icon:${card.browser.currentURI.spec}` : "");
    if (/defaultFavicon|globe/i.test(icon)) {
      icon = "";
    }
    if (!icon) {
      let host = "";
      try {
        host = card.browser?.currentURI?.displayHost?.replace(/^www\./, "") || "";
      } catch (err) {
        host = "";
      }
      button.setAttribute("zia-favicon", "");
      button.setAttribute("zia-initial", (host[0] || "♪").toUpperCase());
      button.style.removeProperty("--zia-media-favicon");
      button.style.setProperty("--zia-favicon-tint", "rgb(52, 52, 56)");
      return;
    }
    button.removeAttribute("zia-initial");
    button.setAttribute("zia-favicon", icon);
    button.style.setProperty("--zia-media-favicon", `url("${icon.replace(/"/g, "%22")}")`);
    let tint = faviconTints.get(icon);
    if (!tint) {
      let colors = mediaColorCache.get(icon);
      if (colors === undefined) {
        colors = await readArtColors(icon);
        mediaColorCache.set(icon, colors);
      }
      tint = tintFromColors(colors);
      faviconTints.set(icon, tint);
    }
    if (button.getAttribute("zia-favicon") === icon) {
      button.style.setProperty("--zia-favicon-tint", tint);
    }
  }

  const FLIP_OUT_MS = 200;
  const FLIP_IN_MS = 380;

  function flipArtwork(button, swap) {
    const icon = button.querySelector(":scope > .toolbarbutton-icon") || button.querySelector("image");
    if (!icon || typeof icon.animate !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      swap();
      return;
    }
    button.__ziaFlip?.cancel();
    const turnAway = icon.animate(
      [{ transform: "perspective(240px) rotateY(0deg)" }, { transform: "perspective(240px) rotateY(90deg)" }],
      { duration: FLIP_OUT_MS, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" }
    );
    button.__ziaFlip = turnAway;
    turnAway.finished
      .then(() => {
        swap();
        const turnBack = icon.animate(
          [
            { transform: "perspective(240px) rotateY(-90deg)" },
            { transform: "perspective(240px) rotateY(8deg)", offset: 0.75 },
            { transform: "perspective(240px) rotateY(0deg)" },
          ],
          { duration: FLIP_IN_MS, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" }
        );
        button.__ziaFlip = turnBack;
        turnAway.cancel();
      })
      .catch(() => {
      });
  }

  function setRing(card, fraction) {
    const fill = card.focusButton?.querySelector(".zia-ring-fill");
    if (!fill) {
      return;
    }
    const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;

    fill.style.strokeDasharray = pct > 0.2 ? `${pct.toFixed(2)} 100` : "0 100";
    fill.style.strokeOpacity = pct > 0.2 ? "1" : "0";
  }

  function showTimeLeft(card) {
    const durationEl = card.durationEl;
    const bar = card.progressBar;
    if (!bar || !card.duration || card.duration >= 900_000) {
      setRing(card, 0);
      return;
    }
    const fraction = Number(bar.value) / 100;
    setRing(card, fraction);
    if (durationEl) {
      const played = fraction * card.duration;
      durationEl.textContent = `-${card.formatSecondsToTime(Math.max(0, card.duration - played))}`;
    }
  }

  function watchTimeLeft(card) {
    const el = card.currentTimeEl;
    if (!el || el.__ziaTimeLeft) {
      return;
    }
    el.__ziaTimeLeft = true;

    new MutationObserver(() => showTimeLeft(card)).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  const isStandInArtwork = (src) =>
    !src || /^(jar|chrome|resource|moz-src):/i.test(src) || /defaultFavicon|globe/i.test(src);

  function bestArtwork(artwork) {
    if (!Array.isArray(artwork)) {
      return "";
    }
    artwork = artwork.filter((a) => !isStandInArtwork(a?.src));
    if (!artwork.length) {
      return "";
    }
    const area = (a) =>
      Math.max(
        0,
        ...String(a.sizes || "")
          .split(/\s+/)
          .map((size) => size.split("x").reduce((w, h) => (parseInt(w) || 0) * (parseInt(h) || 0)))
      );
    return [...artwork].sort((x, y) => area(y) - area(x))[0]?.src || "";
  }

  // Zen puts the card away while its video is in picture-in-picture (so
  // pressing the card's own picture-in-picture button took the card with
  // it). With this option on (the default), the card stays: picture-in-
  // picture opens as usual and the card goes on showing and controlling it.
  const KEEP_WITH_PIP_PREF = "zia.media.keep-with-pip";

  function keepWithPip() {
    try {
      return Services.prefs.getBoolPref(KEEP_WITH_PIP_PREF, true);
    } catch (err) {
      return true;
    }
  }

  function keepCardsWithPip() {
    const front = window.gZenMediaController?.frontCard;
    const proto = front && Object.getPrototypeOf(front);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, "shouldBeVisible");
    if (!desc?.get) {
      return false;
    }
    if (desc.get.__zia) {
      return true;
    }
    const original = desc.get;
    const patched = function () {
      try {
        // (fullscreen is Zen's to decide, as before)
        if (keepWithPip() && !this.isSharing && this.controller?.isBeingUsedInPIPModeOrFullscreen && !document.fullscreenElement && !window.fullScreen) {
          return gBrowser.selectedBrowser.browserId !== this.browser.browserId;
        }
      } catch (err) {
        noteError("music and sound bars: keepCardsWithPip", err);
      }
      return original.call(this);
    };
    patched.__zia = true;
    Object.defineProperty(proto, "shouldBeVisible", { ...desc, get: patched });

    const refreshCards = () => {
      for (const element of document.querySelectorAll("#zen-media-controls-toolbar .zen-media-card")) {
        try {
          element.__ziaCard?.refreshVisibility?.();
        } catch (err) {
          noteError("music and sound bars: keepCardsWithPip (2)", err);
        }
      }
    };
    Services.prefs.addObserver(KEEP_WITH_PIP_PREF, refreshCards);
    window.addEventListener("unload", () => Services.prefs.removeObserver(KEEP_WITH_PIP_PREF, refreshCards));
    return true;
  }

  // Kick gives its streams no artwork: the card shows the channel's own
  // picture instead, asked of Kick by the page (actors/ZiaChild.sys.mjs),
  // once per channel.
  const kickAvatars = new Map();

  function kickSlug(browser) {
    try {
      const uri = browser?.currentURI;
      if (!/^(www\.)?kick\.com$/.test(uri?.host || "")) {
        return "";
      }
      const slug = uri.filePath.split("/")[1] || "";
      return /^[\w-]+$/.test(slug) ? slug.toLowerCase() : "";
    } catch (err) {
      return "";
    }
  }

  function kickAvatar(card) {
    const slug = kickSlug(card.browser);
    if (!slug) {
      return "";
    }
    if (kickAvatars.has(slug)) {
      return kickAvatars.get(slug) || "";
    }
    kickAvatars.set(slug, null);
    let actor = null;
    try {
      actor = card.browser.browsingContext?.currentWindowGlobal?.getActor("Zia");
    } catch (err) {
      actor = null;
    }
    if (!actor) {
      kickAvatars.delete(slug);
      return "";
    }
    actor
      .sendQuery("Zia:KickAvatar", { slug })
      .then((pic) => {
        kickAvatars.set(slug, pic || "");
        if (pic && kickSlug(card.browser) === slug) {
          card.updateIcon();
        }
      })
      .catch(() => kickAvatars.delete(slug));
    return "";
  }

  // A YouTube video shows its channel's picture rather than the video's
  // own thumbnail (a setting, off by default), read from the page once per
  // video. The page may still be putting it up: asked again a few times.
  const YOUTUBE_AVATAR_PREF = "zia.media.youtube-channel-art";
  const youTubeAvatars = new Map();

  function youTubeVideo(browser) {
    try {
      const uri = browser?.currentURI;
      if (!/^(www\.|m\.)?youtube\.com$/.test(uri?.host || "")) {
        return "";
      }
      const url = new URL(uri.spec);
      const id = url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|live)\/([\w-]+)/)?.[1] || "";
      return /^[\w-]+$/.test(id) ? id : "";
    } catch (err) {
      return "";
    }
  }

  function youTubeAvatar(card) {
    try {
      if (!Services.prefs.getBoolPref(YOUTUBE_AVATAR_PREF, false)) {
        return "";
      }
    } catch (err) {
      return "";
    }
    const video = youTubeVideo(card.browser);
    if (!video) {
      return "";
    }
    const known = youTubeAvatars.get(video);
    if (known?.pic || known?.asking) {
      return known.pic || "";
    }
    const tries = (known?.tries || 0) + 1;
    if (tries > 6) {
      return "";
    }
    let actor = null;
    try {
      actor = card.browser.browsingContext?.currentWindowGlobal?.getActor("Zia");
    } catch (err) {
      actor = null;
    }
    if (!actor) {
      return "";
    }
    youTubeAvatars.set(video, { asking: true, tries });
    actor
      .sendQuery("Zia:YouTubeAvatar", {})
      .then((pic) => {
        youTubeAvatars.set(video, { pic: pic || "", tries });
        if (youTubeVideo(card.browser) !== video) {
          return;
        }
        if (pic) {
          card.updateIcon();
        } else {
          setTimeout(() => {
            if (youTubeVideo(card.browser) === video) {
              card.updateIcon();
            }
          }, 1500);
        }
      })
      .catch(() => youTubeAvatars.set(video, { tries }));
    return "";
  }

  // A YouTube live stream gives the card a position and a length (the part
  // of the stream it keeps to go back through), so Zen shows it as a video,
  // with a progress line that jumps about. Asked of YouTube's own player (it
  // marks a live stream) every so often, the card shows LIVE instead, as it
  // does for Twitch and Kick.
  const youTubeLiveChecked = new WeakMap();

  function markYouTubeLive(card) {
    const element = card.element;
    const browser = card.browser;
    if (!element || !browser) {
      return;
    }
    let host = "";
    try {
      host = browser.currentURI?.host || "";
    } catch (err) {
      host = "";
    }
    if (!/(^|\.)youtube\.com$/.test(host)) {
      element.removeAttribute("zia-live");
      return;
    }
    const spec = browser.currentURI.spec;
    const last = youTubeLiveChecked.get(element);
    if (last && last.spec === spec && Date.now() - last.at < 10000) {
      return;
    }
    youTubeLiveChecked.set(element, { spec, at: Date.now() });
    let actor = null;
    try {
      actor = browser.browsingContext?.currentWindowGlobal?.getActor("Zia");
    } catch (err) {
      actor = null;
    }
    actor
      ?.sendQuery("Zia:YouTubeLive", {})
      .then((live) => {
        if (card.browser?.currentURI?.spec === spec) {
          element.toggleAttribute("zia-live", !!live);
        }
      })
      .catch(() => {});
  }

  function useMediaArtwork() {
    const front = window.gZenMediaController?.frontCard;
    const proto = front && Object.getPrototypeOf(front);
    if (!proto || typeof proto.updateIcon !== "function" || proto.updateIcon.__zia) {
      return !!proto?.updateIcon?.__zia;
    }
    const originalPosition = proto.updatePosition;
    if (typeof originalPosition === "function") {
      proto.updatePosition = function (...args) {
        const result = originalPosition.apply(this, args);
        try {
          const known = this.element.__ziaCard === this;
          this.element.__ziaCard = this;
          watchTimeLeft(this);
          showTimeLeft(this);
          markYouTubeLive(this);
          if (!known) {
            repaintSoundTabs();
          }
        } catch (err) {
          noteError("music and sound bars: useMediaArtwork", err);
        }
        return result;
      };
    }

    const original = proto.updateIcon;
    const patched = function () {
      original.call(this);
      if (this.element && this.element.__ziaCard !== this) {
        this.element.__ziaCard = this;
        repaintSoundTabs();
      }
      const button = this.focusButton;
      let art = "";
      try {
        art = bestArtwork(this.controller?.getMetadata?.()?.artwork);
      } catch (err) {
        noteError("music and sound bars: useMediaArtwork (2)", err);
      }
      art = youTubeAvatar(this) || art;
      if (!art) {
        art = kickAvatar(this);
      }
      if (!button) {
        return;
      }
      ensureRing(button);
      if (art) {
        const previous = button.getAttribute("zia-art");
        button.setAttribute("zia-art", art);
        const showArt = () => button.style.setProperty("--zia-media-art", `url("${art.replace(/"/g, "%22")}")`);
        if (previous && previous !== art) {
          flipArtwork(button, showArt);
        } else {
          showArt();
        }
      } else {
        button.removeAttribute("zia-art");
        button.style.removeProperty("--zia-media-art");
      }
      showFaviconTile(this, button, art);
    };
    patched.__zia = true;
    proto.updateIcon = patched;
    try {
      front.updateIcon();
      front.updatePosition?.();
    } catch (err) {
      noteError("music and sound bars: showArt", err);
    }
    return true;
  }

  function watchMediaGlow() {
    const toolbar = document.getElementById("zen-media-controls-toolbar");
    if (!toolbar) {
      return;
    }
    let frame = null;
    let artworkReady = false;
    let keptWithPip = false;
    const refresh = () => {
      frame = null;
      if (!artworkReady) {
        artworkReady = useMediaArtwork();
      }
      if (!keptWithPip) {
        keptWithPip = keepCardsWithPip();
      }
      for (const card of toolbar.querySelectorAll(".zen-media-card")) {
        updateMediaWorkspace(card);
        updateCardGlow(card);
      }
    };
    new MutationObserver(() => {
      if (!frame) {
        frame = requestAnimationFrame(refresh);
      }
    }).observe(toolbar, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "style", "image", "hidden", "zia-art", "zia-favicon"],
    });
    refresh();
  }


  // A music player card could be dragged out of the sidebar like a toolbar
  // button, which took it away from Zen's media player and left the player
  // broken until Zen restarted. Nothing on the card is meant to be dragged
  // (the scrubber and buttons don't use drags), so no drag starts there.
  function keepMediaCardsInPlace() {
    window.addEventListener(
      "dragstart",
      (event) => {
        if (event.target?.closest?.("#zen-media-controls-toolbar")) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );
  }
  // Zia Split Tabs 1.0.7 (5738b6e44a76c29582024f2986c6547ace5d6879).
  // Keep the standalone implementation in its own scope.
  function watchSplitDrop() {
// Extracted from Zia by z1n-k; MIT licensed.
(() => {
  if (window.__zia_split_tabsLoaded) return;
  window.__zia_split_tabsLoaded = true;
  const root = document.documentElement;

  const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";
  const HTML = "http://www.w3.org/1999/xhtml";
  const MAGNET_SHARE = 0.32;
  const MAGNET_PULL_X = 0.55;
  const MAGNET_PULL_Y = 0.35;

  const ZONE_EDGE = 44;
  const ZONE_ACTIVE_W = 350;
  const ZONE_ACTIVE_H = 580;
  const ZONE_PAGE_W = 272;
  const ZONE_PAGE_H = 452;

  const splitDrop = {
    overlay: null,
    zones: {},
    tab: null,
    target: null,
    press: null,
    side: null,
    bounds: null,
    renderedSide: null,
    frame: null,
    pointer: null,
  };

  function draggedTabOf(event) {
    const dt = event.dataTransfer;
    if (!dt || !dt.types.includes(TAB_DROP_TYPE)) {
      return null;
    }
    try {
      return dt.mozGetDataAt(TAB_DROP_TYPE, 0) || null;
    } catch (err) {
      return null;
    }
  }

  function splitTargetFor(tab) {
    // Native mousedown can select a background tab before its drag starts.
    // Only use the previous tab when that selection belongs to this press.
    const press = splitDrop.press;
    const previous = press?.selected;
    if (press?.tab === tab && previous !== tab && gBrowser.selectedTab === tab &&
        previous && !previous.closing && previous.isConnected && !previous.hidden) {
      return previous;
    }
    return gBrowser.selectedTab;
  }

  function canSplitWith(tab, current = gBrowser.selectedTab) {
    const splitter = window.gZenViewSplitter;
    if (!splitter || !tab || !current || tab.closing || tab.hasAttribute("zen-empty-tab")) {
      return false;
    }
    if (tab.hasAttribute("zen-live-folder-item-id")) {
      return false;
    }

    if (tab === current && current.splitView) {
      return false;
    }

    if (tab !== current && tab.splitView && current.splitView && tab.group && tab.group === current.group) {
      return false;
    }
    const group = splitter._data?.find?.((g) => g.tabs.includes(current));
    return !(group && group.tabs.length >= (splitter.MAX_TABS || 4));
  }

  function makeZone(side) {
    const zone = document.createElementNS(HTML, "div");
    zone.className = "zia-split-zone";
    zone.setAttribute("side", side);
    const inner = document.createElementNS(HTML, "div");
    inner.className = "zia-split-zone-inner";
    const icon = document.createElementNS(HTML, "div");
    icon.className = "zia-split-zone-icon";
    const label = document.createElementNS(HTML, "div");
    label.className = "zia-split-zone-label";
    label.textContent = side === "left" ? "Add left split" : "Add right split";
    inner.append(icon, label);
    zone.appendChild(inner);
    return zone;
  }

  function ensureSplitOverlay() {
    if (splitDrop.overlay) {
      return splitDrop.overlay;
    }
    const overlay = document.createElementNS(HTML, "div");
    overlay.id = "zia-split-drop";
    splitDrop.zones.left = makeZone("left");
    splitDrop.zones.right = makeZone("right");
    overlay.append(splitDrop.zones.left, splitDrop.zones.right);

    overlay.addEventListener("dragover", onSplitDragOver);
    overlay.addEventListener("drop", onSplitDrop);
    overlay.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget) {
        hideSplitDrop();
      }
    });
    document.documentElement.appendChild(overlay);
    splitDrop.overlay = overlay;
    return overlay;
  }

  function showSplitDrop(tab, event) {
    const overlay = ensureSplitOverlay();
    const box = gBrowser.tabbox.getBoundingClientRect();
    splitDrop.bounds = box;
    overlay.style.setProperty("--zia-drop-left", `${box.left}px`);
    overlay.style.setProperty("--zia-drop-top", `${box.top}px`);
    overlay.style.setProperty("--zia-drop-width", `${box.width}px`);
    overlay.style.setProperty("--zia-drop-height", `${box.height}px`);
    splitDrop.tab = tab;
    splitDrop.side = null;

    const target = splitDrop.target;
    let switched = false;
    const showTarget = () => {
      if (switched) {
        return;
      }
      switched = true;
      if (target && splitDrop.tab === tab && overlay.hasAttribute("open") && gBrowser.selectedTab !== target) {
        gBrowser.selectedTab = target;
      }
    };
    // Keep Zen's native drag image; no screenshot needs to finish first.
    setTimeout(showTarget, 0);
    overlay.setAttribute("open", "true");

    requestAnimationFrame(() => {
      if (overlay.hasAttribute("open")) {
        overlay.setAttribute("shown", "true");
      }
    });

  }

  function hideSplitDrop(event) {
    if (splitDrop.frame !== null) {
      cancelAnimationFrame(splitDrop.frame);
      splitDrop.frame = null;
    }
    splitDrop.pointer = null;
    restoreNativeTabPreview();
    const overlay = splitDrop.overlay;
    if (!overlay?.hasAttribute("open")) {
      return;
    }
    overlay.removeAttribute("shown");
    overlay.removeAttribute("open");
    setDropSide(null);
    splitDrop.side = null;
    splitDrop.tab = null;
    splitDrop.target = null;
    splitDrop.bounds = null;
  }

  function setDropSide(side, cursorX = 0, cursorY = 0) {
    const overlay = splitDrop.overlay;
    if (!overlay) {
      return;
    }
    const changed = side !== splitDrop.renderedSide;
    splitDrop.renderedSide = side;
    if (changed) overlay.toggleAttribute("has-side", !!side);
    for (const [name, zone] of Object.entries(splitDrop.zones)) {
      const active = name === side;
      if (changed) zone.toggleAttribute("active", active);
      if (!active) {
        if (changed) setZoneOffset(zone, "0px", "0px");
        continue;
      }

      // The overlay has the tabbox's bounds. Reusing them avoids a synchronous
      // layout read after toggling the active zone on every dragover.
      const box = splitDrop.bounds;
      const w = Math.min(ZONE_ACTIVE_W, box.width * 0.45);
      const h = Math.min(ZONE_ACTIVE_H, box.height * 0.86);
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      let tx;
      if (name === "left") {
        const baseCentre = box.left + ZONE_EDGE + w / 2;
        tx = clamp((cursorX - baseCentre) * MAGNET_PULL_X, 8 - (box.left + ZONE_EDGE), box.width / 2 - ZONE_EDGE - w);
      } else {
        const baseCentre = box.right - ZONE_EDGE - w / 2;
        tx = clamp((cursorX - baseCentre) * MAGNET_PULL_X, -(box.width / 2 - ZONE_EDGE - w), window.innerWidth - 8 - (box.right - ZONE_EDGE));
      }
      const room = Math.max(0, box.height / 2 - h / 2 - 8);
      const ty = clamp((cursorY - (box.top + box.height / 2)) * MAGNET_PULL_Y, -room, room);
      setZoneOffset(zone, `${tx.toFixed(1)}px`, `${ty.toFixed(1)}px`);
    }
  }

  function setZoneOffset(zone, x, y) {
    // Reading inline style does not flush layout. Avoid identical mutations,
    // including movements clamped against the same edge.
    if (zone.style.getPropertyValue("--zia-zone-tx") !== x) {
      zone.style.setProperty("--zia-zone-tx", x);
    }
    if (zone.style.getPropertyValue("--zia-zone-ty") !== y) {
      zone.style.setProperty("--zia-zone-ty", y);
    }
  }

  function sideAt(event) {
    const box = splitDrop.bounds || gBrowser.tabbox.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
      return null;
    }
    const x = event.clientX - box.left;
    if (x < box.width * MAGNET_SHARE) {
      return "left";
    }
    if (x > box.width * (1 - MAGNET_SHARE)) {
      return "right";
    }
    return null;
  }

  function followDrag(event, overPage) {
    if (overPage) showNativeSplitPreview(event);
    else restoreNativeTabPreview();
    const side = overPage ? sideAt(event) : null;
    if (side !== splitDrop.side && side) {
      Services.zen?.playHapticFeedback?.();
    }
    splitDrop.side = side;
    splitDrop.pointer = { x: event.clientX, y: event.clientY };
    if (splitDrop.frame === null) {
      splitDrop.frame = requestAnimationFrame(() => {
        splitDrop.frame = null;
        const point = splitDrop.pointer;
        if (point && splitDrop.overlay?.hasAttribute("open")) {
          setDropSide(splitDrop.side, point.x, point.y);
        }
      });
    }
  }

  function onSplitDragOver(event) {
    if (!splitDrop.tab) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
  }

  function onSplitDrop(event) {
    const tab = splitDrop.tab;
    const target = splitDrop.target;
    // A drop can arrive before the queued paint or at a newer position.
    const side = isOverPage(event) ? sideAt(event) : null;
    event.preventDefault();
    event.stopPropagation();
    hideSplitDrop(event);
    if (!tab || !side) {
      return;
    }

    setTimeout(() => {
      try {
        splitTabToSide(tab, side, target);
      } catch (err) {
        console.error("[Zia] Split on drop failed:", err);
      }
    }, 0);
  }

  function splitTabToSide(tab, side, onTab = gBrowser.selectedTab) {
    const splitter = window.gZenViewSplitter;
    const glance = window.gZenGlanceManager;
    const base = onTab && !onTab.closing ? onTab : gBrowser.selectedTab;
    let target = glance?.getTabOrGlanceParent?.(base) ?? base;
    let dragged = glance?.getTabOrGlanceParent?.(tab) ?? tab;

    if (dragged === target) {
      const url = "about:newtab";
      const newTab = gBrowser.addTrustedTab(url, { inBackground: true });
      const left = side === "left";
      splitter.splitTabs(left ? [target, newTab] : [newTab, target], "vsep", left ? 1 : 0);
      gBrowser.selectedTab = newTab;
      return;
    }

    const pair = [dragged, target];
    const anyEssential = pair.some((t) => t.hasAttribute("zen-essential"));
    const somePinned = pair.some((t) => t.pinned) && !pair.every((t) => t.pinned);
    if (anyEssential || somePinned) {
      [dragged, target] = pair.map((t) => (t.pinned ? gBrowser.duplicateTab(t, true) : t));
    }

    const left = side === "left";
    splitter.splitTabs(left ? [dragged, target] : [target, dragged], "vsep", left ? 0 : 1);
    gBrowser.selectedTab = dragged;
  }

  function watchSplitDrop() {
    if (!window.gZenViewSplitter || !gBrowser.tabbox) {
      return;
    }
    window.addEventListener(
      "dragover",
      (event) => {
        const open = splitDrop.overlay?.hasAttribute("open");
        const overPage = isOverPage(event);
        if (open) {
          if (overPage) {
            gBrowser.tabContainer.tabDragAndDrop?.clearSpaceSwitchTimer?.();
          }
          followDrag(event, overPage);
          return;
        }
        if (!overPage) {
          return;
        }
        const tab = draggedTabOf(event);
        const target = tab && splitTargetFor(tab);
        if (tab && canSplitWith(tab, target)) {
          splitDrop.target = target;
          gBrowser.tabContainer.tabDragAndDrop?.clearSpaceSwitchTimer?.();
          showSplitDrop(tab, event);
          followDrag(event, overPage);
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );
    window.addEventListener("mousedown", (event) => {
      const tab = event.button === 0 ? event.target?.closest?.(".tabbrowser-tab") : null;
      splitDrop.press = tab ? { tab, selected: gBrowser.selectedTab } : null;
    }, true);
    const clearPress = () => { splitDrop.press = null; };
    window.addEventListener("mouseup", clearPress, true);
    window.addEventListener("dragend", (event) => {
      hideSplitDrop(event);
      clearPress();
    }, true);
    window.addEventListener("blur", (event) => {
      // A native tab switch also blurs the chrome window when it focuses
      // the page. That still belongs to this press in the active window.
      if (event.target === window && Services.focus.activeWindow !== window) clearPress();
    }, true);
    window.addEventListener(
      "drop",
      (event) => {
        if (!event.target?.closest?.("#zia-split-drop")) {
          hideSplitDrop(event);
        }
        clearPress();
      },
      true
    );
  }

  function isOverPage(event) {
    const box = splitDrop.bounds || gBrowser.tabbox.getBoundingClientRect();
    const inPage =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    return inPage && !isOverCollapsedSidebar(event);
  }

  function isOverCollapsedSidebar(event) {
    if (root.getAttribute("zen-compact-mode") !== "true") {
      return false;
    }
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbox) {
      return false;
    }
    const box = toolbox.getBoundingClientRect();

    if (box.right <= 0) {
      return false;
    }
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  }


  // Zen's rectangle is created by its private split handler, not by the
  // normal sidebar drag. Reuse its XUL structure and built-in styling only.
  function showNativeSplitPreview(event) {
    if (splitDrop.nativePreview || !splitDrop.tab ||
        typeof event.dataTransfer?.updateDragImage !== "function") return;
    if (document.getElementById("zen-split-view-drag-image")) return;
    const preview = document.createXULElement("vbox");
    preview.id = "zen-split-view-drag-image";
    const icon = document.createXULElement("image");
    icon.setAttribute("src", splitDrop.tab.getAttribute("image") || "chrome://global/skin/icons/defaultFavicon.svg");
    const label = document.createXULElement("label");
    label.textContent = splitDrop.tab.label;
    preview.append(icon, label);
    document.documentElement.appendChild(preview);
    splitDrop.nativePreview = preview;
    splitDrop.nativeTransfer = event.dataTransfer;
    const dt = event.dataTransfer;
    // Allow native sidebar drag-style refreshes to finish first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (splitDrop.nativePreview !== preview || !splitDrop.tab) return;
      const original = gBrowser.tabContainer.tabDragAndDrop?.originalDragImageArgs;
      try {
        dt.updateDragImage(preview, original?.[1] ?? 16, original?.[2] ?? 16);
        gBrowser.tabContainer.tabDragAndDrop?.clearDragOverVisuals?.();
      } catch (error) {
        // The drag can end while the update is queued.
        restoreNativeTabPreview();
      }
    }));
  }

  function restoreNativeTabPreview() {
    const preview = splitDrop.nativePreview;
    if (!preview) return;
    const dt = splitDrop.nativeTransfer;
    splitDrop.nativePreview = null;
    splitDrop.nativeTransfer = null;
    try {
      const original = gBrowser.tabContainer.tabDragAndDrop?.originalDragImageArgs;
      if (original?.length) dt?.updateDragImage(...original);
    } catch {}
    preview.remove();
  }

  function start() {
    Services.prefs.getDefaultBranch("").setBoolPref("zen.splitView.enable-tab-drop", false);
    watchSplitDrop();
  }

  if (window.gBrowserInit?.delayedStartupFinished) {
    start();
  } else {
    const observer = (subject) => {
      if (subject === window) {
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
        start();
      }
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  }
})();

  }
  function isOverPage(event) {
    const box = gBrowser.tabbox.getBoundingClientRect();
    const inPage =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    return inPage && !isOverCollapsedSidebar(event);
  }

  function isOverCollapsedSidebar(event) {
    if (root.getAttribute("zen-compact-mode") !== "true") {
      return false;
    }
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbox) {
      return false;
    }
    const box = toolbox.getBoundingClientRect();

    if (box.right <= 0) {
      return false;
    }
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  }

  function shortenFindCount(findbar) {
    const label = findbar?.querySelector?.(".found-matches");
    if (!label || label.__ziaCount) {
      return;
    }
    label.__ziaCount = true;
    const update = () => {
      const numbers = (label.getAttribute("value") || label.textContent || "").match(/\d[\d,.]*/g);
      label.setAttribute("zia-count", numbers?.length >= 2 ? `${numbers[0]}/${numbers[1]}` : numbers?.[0] || "");
    };
    new MutationObserver(update).observe(label, { attributes: true, attributeFilter: ["value"], childList: true, characterData: true, subtree: true });
    update();
  }

  // Find opens empty, as in Dia, rather than with the last search in it.
  // (Text selected on the page still fills it in: Firefox does that just
  // after this.)
  function clearFindBarOnOpen(event) {
    const findbar = event.target;
    if (findbar?.localName !== "findbar") {
      return;
    }
    // (not findbar.clear(): that collapses the page's selection too, which
    // Firefox is about to read)
    try {
      const field = findbar._findField;
      if (field?.value) {
        field.value = "";
        field.editor?.clearUndoRedo();
        findbar._updateStatusUI?.();
        findbar._enableFindButtons?.(false);
      }
    } catch (err) {
      noteError("find bar: clearFindBarOnOpen", err);
    }
  }

  // On macOS Firefox fills a find bar that opens with nothing selected from
  // the system's shared find clipboard, the last search made anywhere: so it
  // reopened with that search in it. Opened with nothing selected, it starts
  // empty; text selected on the page still fills it in.
  function skipClipboardPrefill(findbar) {
    if (!findbar || findbar.__ziaNoClipboardPrefill || typeof findbar.onCurrentSelection !== "function") {
      return;
    }
    findbar.__ziaNoClipboardPrefill = true;
    const original = findbar.onCurrentSelection;
    findbar.onCurrentSelection = function (selectionString, isInitialSelection) {
      if (!isInitialSelection || selectionString) {
        return original.call(this, selectionString, isInitialSelection);
      }
      // Firefox's own steps for an empty opening, minus the clipboard
      try {
        if (!this._startFindDeferred) {
          return undefined;
        }
        this._findField.value = "";
        this._enableFindButtons(false);
        this._findField.select();
        this._findField.focus();
        this._startFindDeferred.resolve();
        this._startFindDeferred = null;
        return undefined;
      } catch (err) {
        noteError("find bar: skipClipboardPrefill", err);
        return original.call(this, selectionString, isInitialSelection);
      }
    };
  }

  function dressFindBar(findbar) {
    shortenFindCount(findbar);
    skipClipboardPrefill(findbar);
  }

  function watchFindBars() {
    window.addEventListener("findbaropen", clearFindBarOnOpen, true);
    gBrowser.tabContainer.addEventListener("TabFindInitialized", (event) => {
      dressFindBar(gBrowser.getCachedFindBar?.(event.target));
    });
    for (const tab of gBrowser.tabs) {
      if (gBrowser.isFindBarInitialized?.(tab)) {
        dressFindBar(gBrowser.getCachedFindBar(tab));
      }
    }
  }

  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const ICONS = "chrome://sine/content/zia/icons/";
  const paneColorTimers = new WeakMap();

  function splitContainers() {
    const panels = gBrowser.tabpanels;
    if (panels?.getAttribute("zen-split-view") !== "true") {
      return [];
    }
    return [...panels.querySelectorAll(":scope > .browserSidebarContainer[zen-split='true']")].filter(
      (container) => !container.classList.contains("zen-glance-overlay")
    );
  }

  function paneBrowser(container) {
    return container.querySelector("browser");
  }

  function paneOfBrowser(browser) {
    const container = browser?.closest?.(".browserSidebarContainer");
    return container?.querySelector(":scope .zia-pane-bar") ? container : null;
  }

  function paneButton(name, label, onClick, icon = `${ICONS}${name}.svg`) {
    const button = document.createElementNS(HTML_NS, "button");
    button.className = `zia-pane-button zia-pane-${name}`;
    button.setAttribute("title", label);
    button.setAttribute("aria-label", label);
    const img = document.createElementNS(HTML_NS, "img");
    img.setAttribute("src", icon);
    img.setAttribute("alt", "");
    button.appendChild(img);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(event, button);
    });
    return button;
  }

  function createPaneBar(container) {
    const bar = document.createElementNS(HTML_NS, "div");
    bar.className = "zia-pane-bar";
    const tabOf = () => gBrowser.getTabForBrowser(paneBrowser(container));

    bar.addEventListener("mousedown", () => {
      const tab = tabOf();
      if (tab && gBrowser.selectedTab !== tab) {
        gBrowser.selectedTab = tab;
      }
    });

    bar.appendChild(
      paneButton("sidebar", "Toggle sidebar", () => {
        document.getElementById("zen-toggle-compact-mode")?.doCommand?.();
      })
    );
    bar.appendChild(paneButton("back", "Back", () => paneBrowser(container)?.goBack()));
    bar.appendChild(paneButton("forward", "Forward", () => paneBrowser(container)?.goForward()));
    bar.appendChild(
      paneButton("reload", "Reload", () => {
        const browser = paneBrowser(container);
        const tab = tabOf();
        if (tab?.hasAttribute("busy")) {
          browser?.stop();
        } else {
          browser?.reload();
        }
      })
    );

    const address = document.createElementNS(HTML_NS, "div");
    address.className = "zia-pane-address";
    const host = document.createElementNS(HTML_NS, "span");
    host.className = "zia-pane-host";
    const rest = document.createElementNS(HTML_NS, "span");
    rest.className = "zia-pane-rest";
    address.append(host, rest);
    address.addEventListener("click", () => {
      const tab = tabOf();
      if (tab && gBrowser.selectedTab !== tab) {
        gBrowser.selectedTab = tab;
      }

      requestAnimationFrame(() => {
        placeOpenedAddressBar();
        const command = document.getElementById("Browser:OpenLocation");
        if (command) {
          command.doCommand();
        } else {
          gURLBar.select();
        }
      });
    });
    bar.appendChild(address);

    const extensions = document.createElementNS(HTML_NS, "div");
    extensions.className = "zia-pane-extensions";
    bar.appendChild(extensions);

    bar.appendChild(
      paneButton(
        "copy-link",
        "Copy link",
        (event, button) => {
          try {
            copyLink(tabOf());
            showCopied(button);
          } catch (err) {
            console.error("[Zia] Copy link failed:", err);
          }
        },
        COPY_ICON
      )
    );
    bar.appendChild(
      paneButton("site-settings", "Site settings and extensions", () => {
        const tab = tabOf();
        if (tab && gBrowser.selectedTab !== tab) {
          gBrowser.selectedTab = tab;
        }
        placeOpenedAddressBar();

        requestAnimationFrame(() => document.getElementById("zen-site-data-icon-button")?.click());
      })
    );

    bar.appendChild(
      // Closes the pane's tab, as Dia's does (Zen's own only takes it out of
      // the split, into a tab of its own)
      paneButton("close", "Close", () => {
        const tab = tabOf();
        if (tab && !tab.closing) {
          gBrowser.removeTab(tab);
        }
      })
    );

    const stack = container.querySelector(".browserStack");
    const holder = stack?.parentNode || container.querySelector(".browserContainer") || container;
    holder.insertBefore(bar, holder.firstChild);
    return bar;
  }

  const paneLoads = new WeakMap();

  function setPaneProgress(container, value) {
    const address = container.querySelector(".zia-pane-address");
    if (!address) {
      return;
    }
    const state = paneLoads.get(container) || { progress: 0, timer: null };
    state.progress = Math.max(state.progress, Math.min(1, value));
    paneLoads.set(container, state);
    address.style.setProperty("--zia-load-progress", state.progress.toFixed(3));
  }

  function startPaneLoad(container) {
    const address = container.querySelector(".zia-pane-address");
    if (!address) {
      return;
    }
    const old = paneLoads.get(container);
    clearInterval(old?.timer);
    const state = { progress: 0, timer: null };
    paneLoads.set(container, state);
    address.style.setProperty("--zia-load-progress", "0");
    address.setAttribute("zia-loading", "true");
    state.startedAt = Date.now();
    setPaneProgress(container, 0.12);

    state.timer = setInterval(() => {
      if (state.progress < 0.85) {
        setPaneProgress(container, state.progress + (0.85 - state.progress) * 0.08);
      }
    }, 120);
  }

  function finishPaneLoad(container) {
    const address = container.querySelector(".zia-pane-address");
    const state = paneLoads.get(container);
    clearInterval(state?.timer);
    if (!address || !address.hasAttribute("zia-loading")) {
      return;
    }

    const shownFor = Date.now() - (state?.startedAt || 0);
    const stillThisLoad = () => paneLoads.get(container) === state;
    setTimeout(() => stillThisLoad() && setPaneProgress(container, 1), Math.max(0, 450 - shownFor));
    setTimeout(() => {
      if (!stillThisLoad()) {
        return;
      }
      address.removeAttribute("zia-loading");
      setTimeout(() => {
        if (!address.hasAttribute("zia-loading")) {
          address.style.setProperty("--zia-load-progress", "0");
          paneLoads.delete(container);
        }
      }, 320);
    }, 250 + Math.max(0, 450 - shownFor));
  }

  function updatePaneBar(container) {
    const bar = container.querySelector(".zia-pane-bar");
    const browser = paneBrowser(container);
    if (!bar || !browser) {
      return;
    }
    const tab = gBrowser.getTabForBrowser(browser);

    let host = "";
    try {
      const uri = browser.currentURI;
      if (isMultiviewURI(uri)) {
        host = "";
      } else if (uri && /^https?$/.test(uri.scheme)) {
        host = uri.displayHost.replace(/^www\./, "");
      } else if (uri && uri.spec !== "about:blank") {
        host = uri.spec;
      }
    } catch (err) {
      host = "";
    }
    const title = (browser.contentTitle || tab?.label || "").trim();

    let isHomePage = false;
    try {
      const uri = browser.currentURI;
      isHomePage = (uri.filePath === "/" || uri.filePath === "") && !uri.query && !uri.ref;
    } catch (err) {
      isHomePage = false;
    }
    bar.querySelector(".zia-pane-host").textContent = host || title || "New Tab";
    bar.querySelector(".zia-pane-rest").textContent =
      host && title && title !== host && !isHomePage ? ` / ${title}` : "";

    bar.querySelector(".zia-pane-back").disabled = !browser.canGoBack;
    bar.querySelector(".zia-pane-forward").disabled = !browser.canGoForward;
    const busy = !!tab?.hasAttribute("busy");
    const reload = bar.querySelector(".zia-pane-reload");
    reload.querySelector("img").setAttribute("src", `${ICONS}${busy ? "stop" : "reload"}.svg`);
    reload.setAttribute("title", busy ? "Stop" : "Reload");
  }

  async function colorPaneBar(container) {
    const bar = container.querySelector(".zia-pane-bar");
    const browser = paneBrowser(container);
    if (!bar || !browser) {
      return;
    }
    let reading = null;
    try {
      reading = await sampleTopColor(browser);
    } catch (err) {
      noteError("split panes: colorPaneBar", err);
    }
    if (!reading?.rgb) {
      return;
    }
    bar.style.setProperty("--zia-pane-bg", cssColor(reading.rgb));
    bar.toggleAttribute("light", wantsDarkInk(reading.rgb));
  }

  function colorPaneSoon(container, delay = 60) {
    if (!container || paneColorTimers.get(container)) {
      return;
    }
    paneColorTimers.set(
      container,
      setTimeout(() => {
        paneColorTimers.delete(container);
        colorPaneBar(container);
      }, delay)
    );
  }

  let paneFrame = null;

  function refreshPanes() {
    paneFrame = null;
    const containers = splitContainers();
    setFlag("zia-split", containers.length > 1);

    for (const bar of gBrowser.tabpanels.querySelectorAll(".zia-pane-bar")) {
      const container = bar.closest(".browserSidebarContainer");
      if (!containers.includes(container)) {
        bar.remove();
      }
    }
    if (containers.length < 2) {
      restorePaneExtensions();
      return;
    }

    let leftmost = null;
    for (const container of containers) {
      if (!container.querySelector(".zia-pane-bar")) {
        createPaneBar(container);
        colorPaneSoon(container, 0);
      }
      const rect = container.getBoundingClientRect();
      if (!leftmost || rect.left < leftmost.rect.left - 1 || (Math.abs(rect.left - leftmost.rect.left) <= 1 && rect.top < leftmost.rect.top)) {
        leftmost = { container, rect };
      }
      updatePaneBar(container);
    }
    for (const container of containers) {
      container.querySelector(".zia-pane-bar")?.toggleAttribute("first", container === leftmost?.container);
    }
    placeOpenedAddressBar(containers);
    placePaneExtensions(containers);
  }

  const PANE_EXTENSION_ITEMS = "#nav-bar-customization-target > .unified-extensions-item";
  let movedExtensions = [];
  const extensionHomes = new Map();

  function placePaneExtensions(containers) {
    const focused = containers.find((c) => c.classList.contains("deck-selected")) || containers[0];
    const slot = focused?.querySelector(".zia-pane-extensions");
    if (!slot) {
      return;
    }

    for (const node of document.querySelectorAll(PANE_EXTENSION_ITEMS)) {
      if (!extensionHomes.has(node)) {
        extensionHomes.set(node, { parent: node.parentNode, next: node.nextSibling });
        movedExtensions.push(node);
      }
    }
    for (const node of movedExtensions) {
      if (node.parentNode !== slot) {
        slot.appendChild(node);
      }
    }
  }

  function restorePaneExtensions() {
    for (const node of [...movedExtensions].reverse()) {
      const home = extensionHomes.get(node);
      if (!home?.parent?.isConnected) {
        continue;
      }
      const next = home.next?.parentNode === home.parent ? home.next : null;
      home.parent.insertBefore(node, next);
    }
    movedExtensions = [];
    extensionHomes.clear();
  }

  function placeOpenedAddressBar(containers = splitContainers()) {
    const focused = containers.find((c) => c.classList.contains("deck-selected")) || containers[0];
    const bar = focused?.querySelector(".zia-pane-bar");
    if (!bar) {
      return;
    }
    const rect = bar.getBoundingClientRect();
    root.style.setProperty("--zia-pane-url-left", `${Math.round(rect.left + 6)}px`);
    root.style.setProperty("--zia-pane-url-top", `${Math.round(rect.top + 4)}px`);
    root.style.setProperty("--zia-pane-url-width", `${Math.round(rect.width - 12)}px`);
    root.style.setProperty("--zia-pane-url-bottom", `${Math.round(window.innerHeight - rect.bottom + 4)}px`);
  }

  function schedulePanes() {
    if (!paneFrame) {
      paneFrame = requestAnimationFrame(refreshPanes);
    }
  }

  function watchSplitPanes() {
    const panels = gBrowser.tabpanels;
    if (!panels) {
      return;
    }
    new MutationObserver(schedulePanes).observe(panels, {
      attributes: true,
      subtree: true,
      attributeFilter: ["zen-split-view", "zen-split"],
    });
    gBrowser.tabContainer.addEventListener("TabSelect", schedulePanes);
    window.addEventListener("beforecustomization", restorePaneExtensions);
    window.addEventListener("aftercustomization", schedulePanes);
    gBrowser.tabContainer.addEventListener("TabAttrModified", (event) => {
      const container = paneOfBrowser(event.target.linkedBrowser);
      if (container) {
        updatePaneBar(container);
      }
    });
    window.addEventListener("resize", schedulePanes);

    const { STATE_STOP, STATE_IS_WINDOW } = Ci.nsIWebProgressListener;
    gBrowser.addTabsProgressListener({
      onProgressChange(browser, webProgress, request, curSelf, maxSelf, curTotal, maxTotal) {
        const container = paneOfBrowser(browser);
        if (container && maxTotal > 0) {
          setPaneProgress(container, 0.12 + (curTotal / maxTotal) * 0.8);
        }
      },
      onLocationChange(browser, webProgress) {
        const container = webProgress.isTopLevel && paneOfBrowser(browser);
        if (container) {
          updatePaneBar(container);
          colorPaneSoon(container, 150);
        }
      },
      onStateChange(browser, webProgress, request, stateFlags) {
        const container = webProgress.isTopLevel && paneOfBrowser(browser);
        if (!container) {
          return;
        }
        updatePaneBar(container);
        if (stateFlags & Ci.nsIWebProgressListener.STATE_START && stateFlags & STATE_IS_WINDOW) {
          startPaneLoad(container);
        }
        if (stateFlags & STATE_STOP && stateFlags & STATE_IS_WINDOW) {
          finishPaneLoad(container);
          colorPaneSoon(container, 50);
          colorPaneSoon(container, 800);
        }
      },
    });

    const onScroll = window.ziaOnPageScroll;
    window.ziaOnPageScroll = (browser, position) => {
      onScroll?.(browser, position);
      const container = paneOfBrowser(browser);
      if (container) {
        colorPaneSoon(container);
      }
    };
    const onPainted = window.ziaOnPagePainted;
    window.ziaOnPagePainted = (browser) => {
      onPainted?.(browser);
      const container = paneOfBrowser(browser);
      if (container) {
        colorPaneSoon(container, 0);
      }
    };

    schedulePanes();
  }

  function updateSpaceColored() {
    let colored = false;
    if (root.getAttribute("zen-default-theme") !== "true") {
      const value = getComputedStyle(root).getPropertyValue("--zen-primary-color").trim();
      const m = value.match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3) {
        const [r, g, b] = m.slice(0, 3).map(Number);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        colored = saturation > 0.18 && max > 40;
      }
    }
    setFlag("zia-space-colored", colored);
    tintPipWindows();
  }

  // Tucked picture-in-picture strips take on the space's colour, when it has
  // one of its own, and follow it as you switch spaces.
  function tintPipWindows() {
    const tint = root.getAttribute("zia-space-colored") === "true"
      ? getComputedStyle(root).getPropertyValue("--zen-primary-color").trim()
      : "";
    for (const win of Services.wm.getEnumerator("Toolkit:PictureInPicture")) {
      const style = win.document?.documentElement?.style;
      if (tint) {
        style?.setProperty("--zia-space-tint", tint);
      } else {
        style?.removeProperty("--zia-space-tint");
      }
    }
  }

  function watchSpaceColor() {
    let frame = null;
    let lastKey = null;
    const schedule = () => {
      const key = `${root.getAttribute("zen-default-theme")}|${root.style.getPropertyValue("--zen-primary-color")}|${Services.prefs.getStringPref("zen.workspaces.active", "")}`;
      if (key === lastKey) {
        return;
      }
      lastKey = key;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = null;
          updateSpaceColored();
        });
      }
    };
    new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ["zen-default-theme", "style"] });
    window.addEventListener("ZenWorkspacesUIUpdate", schedule);
    Services.prefs.addObserver("zen.workspaces.active", schedule);
    window.addEventListener("unload", () => Services.prefs.removeObserver("zen.workspaces.active", schedule));
    schedule();
  }

  function animateEssentialsAdds() {
    const manager = window.gZenPinnedTabManager;
    if (!manager || typeof manager.addToEssentials !== "function" || manager.addToEssentials.__zia) {
      return;
    }
    let fromMenu = false;
    const original = manager.addToEssentials;
    const patched = function (tab, ...rest) {
      fromMenu = !tab;
      try {
        return original.call(this, tab, ...rest);
      } finally {
        setTimeout(() => (fromMenu = false), 0);
      }
    };
    patched.__zia = true;
    manager.addToEssentials = patched;

    window.addEventListener("TabAddedToEssentials", (event) => {
      if (!fromMenu || matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      const tab = event.detail?.tab || event.target;

      const hideNow = tab?.querySelector?.(".tab-stack") || tab;
      if (hideNow?.style) {
        hideNow.style.opacity = "0";
      }

      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const tile = tab?.querySelector?.(".tab-stack") || tab;
          if (!tile?.animate) {
            tile?.style?.removeProperty?.("opacity");
            return;
          }

          tile.style.willChange = "transform, opacity, filter";
          const animation = tile.animate(
            [
              { transform: "scale(0.75)", filter: "blur(5px)", opacity: 0 },
              { transform: "scale(1)", filter: "blur(0px)", opacity: 1 },
            ],
            { duration: 820, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
          tile.style.removeProperty("opacity");
          const cleanUp = () => tile.style.removeProperty("will-change");
          animation.finished.then(cleanUp, cleanUp);
        })
      );
    });
  }

  const UNDO_WINDOW_MS = 10000;
  const undoState = { closedAt: 0, actions: 0, sameMoment: false, closed: [] };

  // The page a tab shows, read from its saved state so it works for tabs that
  // haven't loaded yet.
  function savedUrlOf(tab) {
    try {
      const state = JSON.parse(window.SessionStore.getTabState(tab));
      const entry = state.entries?.[(state.index || state.entries.length) - 1];
      if (entry?.url) {
        return entry.url;
      }
    } catch (err) {
      noteError("essentials and undo: savedUrlOf", err);
    }
    return tab.linkedBrowser?.currentURI?.spec || "";
  }

  // Where a closing tab lived, so undo can put it back in its folder or split.
  function closedTabRecord(tab) {
    const record = { url: savedUrlOf(tab), folder: null, split: null };
    const group = tab.group;
    if (group?.hasAttribute("split-view-group")) {
      const data = window.gZenViewSplitter?._data?.find((entry) => entry.tabs?.includes(tab));
      record.split = { key: group.id || "split", gridType: data?.gridType };
      const folder = group.group;
      if (folder?.isZenFolder) {
        record.folder = folderRecord(folder);
      }
    } else if (group?.isZenFolder) {
      record.folder = folderRecord(group);
    }
    return record;
  }

  function folderRecord(folder) {
    return {
      id: folder.id,
      label: folder.label,
      workspaceId: folder.getAttribute("zen-workspace-id") || undefined,
    };
  }

  // Firefox's own "reopen closed tab" brings back everything one close action
  // took away (a whole folder, a split, several tabs at once), not just one tab.
  function reopenLastClose() {
    try {
      if (typeof window.undoCloseTab === "function") {
        window.undoCloseTab();
        return true;
      }
    } catch (err) {
      noteError("essentials and undo: reopenLastClose", err);
    }
    try {
      if (window.SessionStore?.undoCloseTab) {
        window.SessionStore.undoCloseTab(window, 0);
        return true;
      }
    } catch (err) {
      noteError("essentials and undo: reopenLastClose (2)", err);
    }
    try {
      const command = document.getElementById("History:UndoCloseTab");
      if (command) {
        command.doCommand();
        return true;
      }
    } catch (err) {
      noteError("essentials and undo: reopenLastClose (3)", err);
    }
    return false;
  }

  // Tabs that came back loose from a split or a deleted folder go back into one.
  function regroupReopened(opened, closed) {
    const pending = [...closed];
    const matched = [];
    for (const tab of opened) {
      if (!tab.isConnected || tab.hasAttribute("zen-empty-tab")) {
        continue;
      }
      const url = savedUrlOf(tab);
      const index = pending.findIndex((record) => record.url === url);
      if (index >= 0) {
        matched.push({ tab, record: pending.splice(index, 1)[0] });
      }
    }

    const splits = new Map();
    for (const { tab, record } of matched) {
      if (record.split && !tab.group?.hasAttribute("split-view-group")) {
        const entry = splits.get(record.split.key) || { tabs: [], gridType: record.split.gridType };
        entry.tabs.push(tab);
        splits.set(record.split.key, entry);
      }
    }
    for (const { tabs, gridType } of splits.values()) {
      if (tabs.length >= 2) {
        try {
          window.gZenViewSplitter?.splitTabs(tabs, gridType, 0);
        } catch (err) {
          console.warn("[Zia] Undo close: couldn't put the split back together.", err);
        }
      }
    }

    const folders = new Map();
    for (const { tab, record } of matched) {
      const inFolder = tab.group?.isZenFolder || tab.group?.group?.isZenFolder;
      if (record.folder && !inFolder) {
        const entry = folders.get(record.folder.id) || { tabs: [], seen: new Set(), folder: record.folder };
        // A split goes into the folder as one item, so add just one of its tabs.
        const key = tab.group?.hasAttribute("split-view-group") ? tab.group : tab;
        if (!entry.seen.has(key)) {
          entry.seen.add(key);
          entry.tabs.push(tab);
        }
        folders.set(record.folder.id, entry);
      }
    }
    for (const { tabs, folder } of folders.values()) {
      try {
        const existing = document.getElementById(folder.id);
        if (existing?.isZenFolder) {
          existing.addTabs(tabs);
        } else {
          window.gZenFolders?.createFolder(tabs, { label: folder.label, workspaceId: folder.workspaceId });
        }
      } catch (err) {
        console.warn("[Zia] Undo close: couldn't put the folder back.", err);
      }
    }
  }

  function undoClosedTabs() {
    const actions = Math.max(1, undoState.actions);
    const closed = undoState.closed;
    undoState.actions = 0;
    undoState.closed = [];
    undoState.closedAt = 0;

    const opened = [];
    const onOpen = (event) => opened.push(event.target);
    gBrowser.tabContainer.addEventListener("TabOpen", onOpen);
    try {
      for (let i = 0; i < actions; i++) {
        if (!reopenLastClose()) {
          console.warn("[Zia] Undo close: this build didn't reopen the tab.");
          break;
        }
      }
    } finally {
      gBrowser.tabContainer.removeEventListener("TabOpen", onOpen);
    }
    // Give Zen a moment to finish restoring before regrouping.
    setTimeout(() => safely("regroupReopened", () => regroupReopened(opened, closed)), 250);
  }

  function watchUndoClose() {
    gBrowser.tabContainer.addEventListener("TabClose", (event) => {
      const tab = event.target;
      const url = tab.linkedBrowser?.currentURI?.spec || "";
      if (tab.hasAttribute("zen-empty-tab") || url === "about:blank" || url === "about:newtab") {
        return;
      }
      const now = Date.now();
      if (now - undoState.closedAt > 1000) {
        undoState.actions = 0;
        undoState.closed = [];
      }
      undoState.closedAt = now;
      // Tabs closed in the same moment are one action, which Firefox reopens
      // together.
      if (!undoState.sameMoment) {
        undoState.sameMoment = true;
        undoState.actions++;
        setTimeout(() => (undoState.sameMoment = false), 0);
      }
      try {
        undoState.closed.push(closedTabRecord(tab));
      } catch (err) {
        noteError("essentials and undo: watchUndoClose", err);
      }
    });

    window.addEventListener(
      "keydown",
      (event) => {
        if (Date.now() - undoState.closedAt > UNDO_WINDOW_MS || event.defaultPrevented) {
          return;
        }
        const accel = AppConstants.platform === "macosx" ? event.metaKey : event.ctrlKey;
        if (!accel || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z") {
          return;
        }
        const target = event.composedTarget || event.target;
        if (target?.localName === "input" || target?.localName === "textarea" || target?.isContentEditable) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        undoClosedTabs();
      },
      true
    );
  }

  function defaultEngineName() {
    try {
      const search =
        Services.search ||
        ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs").SearchService;
      return search.defaultEngine?.name || "";
    } catch (err) {
      return "";
    }
  }

  let typedIconAsk = 0;

  async function knownIconPage(candidates) {
    const favicons = PlacesUtils?.favicons;
    if (typeof favicons?.getFaviconForPage !== "function") {
      return null;
    }
    for (const spec of candidates) {
      try {
        const icon = await favicons.getFaviconForPage(Services.io.newURI(spec));
        if (icon) {
          return spec;
        }
      } catch (err) {
        noteError("address pop up: knownIconPage", err);
      }
    }
    return null;
  }

  // The page whose saved icon stands for a typed or listed address. The icon
  // is often saved under the www. form (or the bare form) only, and not for
  // every path, so try those too. Found ones are remembered, since typing asks
  // repeatedly.
  const iconPageCache = new Map();

  async function iconPageFor(spec) {
    if (iconPageCache.has(spec)) {
      return iconPageCache.get(spec);
    }
    let url;
    try {
      url = new URL(spec);
    } catch (err) {
      return null;
    }
    const bare = url.host.replace(/^www\./i, "");
    const hosts = [url.host, url.host === bare ? `www.${bare}` : bare];
    const candidates = [spec];
    for (const h of hosts) {
      candidates.push(`${url.protocol}//${h}${url.pathname}${url.search}`, `${url.protocol}//${h}/`);
    }
    const found = await knownIconPage([...new Set(candidates)]);
    // Only found ones are kept: a site visited later gets its icon.
    if (found) {
      iconPageCache.set(spec, found);
    }
    return found;
  }

  function showTypedIcon(urlbar, spec) {
    const value = spec ? `url("page-icon:${spec}")` : "";
    if (urlbar.style.getPropertyValue("--zia-typed-icon") === value) {
      return;
    }
    if (value) {
      urlbar.style.setProperty("--zia-typed-icon", value);
    } else {
      urlbar.style.removeProperty("--zia-typed-icon");
    }
  }

  // The site's icon in the address bar while typing its address, or the
  // magnifying glass. It only changes once the icon is known, so typing
  // doesn't flash between the two.
  function updateTypedIcon() {
    const urlbar = gURLBar.textbox || document.getElementById("urlbar");
    const value = (gURLBar.value || "").trim();
    const match = value.match(/^(?:https?:\/\/)?([\w-]+(?:\.[\w-]+)+)(\/[^\s]*)?/i);
    const host = match?.[1];
    const ask = ++typedIconAsk;
    if (!host) {
      showTypedIcon(urlbar, null);
      return;
    }
    const spec = `https://${host}${match[2] || "/"}`;
    if (iconPageCache.has(spec)) {
      showTypedIcon(urlbar, iconPageCache.get(spec));
      return;
    }
    iconPageFor(spec).then((found) => {
      if (ask === typedIconAsk) {
        showTypedIcon(urlbar, found);
      }
    });
  }

  // Result rows get the default globe when the icon is saved under the other
  // form of the address (youtube.com vs www.youtube.com); point them at it.
  function fillRowIcons(results) {
    for (const img of results.querySelectorAll(".urlbarView-row .urlbarView-favicon")) {
      const src = img.getAttribute("src") || "";
      let spec = null;
      if (src.startsWith("page-icon:")) {
        spec = src.slice("page-icon:".length);
      } else if (!src || src.includes("defaultFavicon")) {
        const row = img.closest(".urlbarView-row");
        const type = row?.getAttribute("type");
        if (/^(search|tip|dynamic|tabtosearch)/.test(type || "")) {
          continue;
        }
        const text = (row?.querySelector(".urlbarView-url")?.textContent || "").trim();
        if (!/^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+/i.test(text)) {
          continue;
        }
        spec = /^https?:/i.test(text) ? text : `https://${text}`;
      }
      if (!spec) {
        continue;
      }
      iconPageFor(spec).then((found) => {
        const icon = found && `page-icon:${found}`;
        if (icon && icon !== src && img.getAttribute("src") === src) {
          img.setAttribute("src", icon);
        }
      });
    }
  }

  function shortenEngineActions(results) {
    const name = defaultEngineName();
    if (!name) {
      return;
    }
    for (const action of results.querySelectorAll(".urlbarView-action")) {
      if (action.classList.contains("urlbarView-switchToTab") ||
          action.closest(".urlbarView-row")?.getAttribute("type") === "switchtab") {
        continue;
      }
      const text = action.textContent || "";
      if (!text || text === name) {
        continue;
      }

      if (!text.includes(name) && !action.hasAttribute("data-l10n-id")) {
        continue;
      }
      action.removeAttribute("data-l10n-id");
      action.removeAttribute("data-l10n-args");
      action.textContent = name;
    }
  }

  const POP_STEP = 0.5;
  const ALIGN_STEP = 1;
  let popIconStart = null;
  let popTextGap = null;
  let popLayout = null;

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function alignTypedTextWithRows(results, passesLeft = 8) {
    const urlbar = gURLBar.textbox || document.getElementById("urlbar");

    // Keep the measured spacing between opens (it only resets when the bar's
    // size or position changes), so reopening doesn't nudge the text again.
    if (!urlbar?.hasAttribute("breakout-extend")) {
      return;
    }
    const row = results.querySelector(".urlbarView-row");
    const icon = row?.querySelector(".urlbarView-favicon, .urlbarView-type-icon");
    const title = row?.querySelector(".urlbarView-title");
    const barRect = urlbar?.getBoundingClientRect();
    const iconRect = icon?.getBoundingClientRect();
    const titleRect = title?.getBoundingClientRect();
    if (!barRect?.width || !iconRect?.width || !titleRect?.width) {
      return;
    }

    const layout = `${Math.round(barRect.left)}:${Math.round(barRect.width)}`;
    if (layout !== popLayout) {
      popLayout = layout;
      popIconStart = null;
      popTextGap = null;
    }

    if (popIconStart === null) {
      popIconStart = clamp(iconRect.left - barRect.left, 0, 60);
      popTextGap = clamp(titleRect.left - iconRect.right, 0, 40);
      urlbar.style.setProperty("--zia-pop-icon-start", `${popIconStart}px`);
      urlbar.style.setProperty("--zia-pop-text-gap", `${popTextGap}px`);
    }

    const barIcon = document.getElementById("identity-icon");
    const input = urlbar.querySelector(".urlbar-input");
    const barIconRect = barIcon?.getBoundingClientRect();
    const inputRect = input?.getBoundingClientRect();
    if (!barIconRect?.width || !inputRect?.width) {
      return;
    }
    const textLeft = inputRect.left + (parseFloat(getComputedStyle(input).paddingInlineStart) || 0);
    const iconError = iconRect.left - barIconRect.left;
    const textError = titleRect.left - textLeft;

    const gapError = textError - iconError;

    let moved = false;
    if (Math.abs(iconError) > 0.3) {
      popIconStart = clamp(popIconStart + iconError * ALIGN_STEP, 0, 60);
      urlbar.style.setProperty("--zia-pop-icon-start", `${popIconStart}px`);
      moved = true;
    }
    if (Math.abs(gapError) > 0.3) {
      popTextGap = clamp(popTextGap + gapError * ALIGN_STEP, 0, 40);
      urlbar.style.setProperty("--zia-pop-text-gap", `${popTextGap}px`);
      moved = true;
    }
    if (moved && passesLeft > 0) {
      requestAnimationFrame(() => alignTypedTextWithRows(results, passesLeft - 1));
    }
  }

  const POP_BOTTOM_WANT = 8;
  const POP_SCROLL_TRIM = 10;
  let popBottomTrim = null;

  function fitPopoverBottom(passesLeft = 8) {
    const urlbar = gURLBar.textbox || document.getElementById("urlbar");
    if (!urlbar?.hasAttribute("breakout-extend") || urlbarAtBottom()) {
      popBottomTrim = null;
      root.removeAttribute("zia-pop-scrolls");
      urlbar?.style.removeProperty("--zia-pop-bottom-trim");
      return;
    }
    const view = urlbar.querySelector(".urlbarView");
    const background = urlbar.querySelector(".urlbar-background");
    const rows = urlbar.querySelectorAll(".urlbarView-row");
    const last = rows[rows.length - 1];
    if (!view || !background || !last) {
      return;
    }

    const scrolls = [view, ...view.querySelectorAll("*")].some((el) => el.scrollHeight > el.clientHeight + 1);
    if (scrolls) {
      root.setAttribute("zia-pop-scrolls", "true");
      popBottomTrim = POP_SCROLL_TRIM;
      urlbar.style.setProperty("--zia-pop-bottom-trim", `${POP_SCROLL_TRIM}px`);
      return;
    }
    root.removeAttribute("zia-pop-scrolls");

    if (popBottomTrim === null) {
      popBottomTrim = parseFloat(getComputedStyle(urlbar).getPropertyValue("--zia-pop-bottom-trim")) || 0;
    }
    const error = background.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom - POP_BOTTOM_WANT;
    if (Math.abs(error) > 0.3 && passesLeft > 0) {
      popBottomTrim += error * POP_STEP;
      urlbar.style.setProperty("--zia-pop-bottom-trim", `${popBottomTrim}px`);
      requestAnimationFrame(() => fitPopoverBottom(passesLeft - 1));
    }
  }

  function watchTypedAddress() {
    const urlbar = gURLBar.textbox || document.getElementById("urlbar");
    const input = urlbar?.querySelector(".urlbar-input");
    if (!input) {
      return;
    }
    input.addEventListener("input", updateTypedIcon);
    urlbar.addEventListener("focus", updateTypedIcon, true);
    urlbar.addEventListener("blur", () => urlbar.style.removeProperty("--zia-typed-icon"), true);

    const results = document.getElementById("urlbar-results");
    if (results) {
      new MutationObserver(() => {
        if (urlbar.hasAttribute("zia-classic")) {
          return;
        }
        shortenEngineActions(results);
        fillRowIcons(results);
        alignTypedTextWithRows(results);
        fitPopoverBottom();

        requestAnimationFrame(() => {
          alignTypedTextWithRows(results);
          fitPopoverBottom();
        });
      }).observe(results, { childList: true, subtree: true, characterData: true });

      new MutationObserver(() => fitPopoverBottom()).observe(urlbar, {
        attributes: true,
        attributeFilter: ["breakout-extend"],
      });
    }
  }

  function applyZenDefaults() {
    const defaults = Services.prefs.getDefaultBranch("");
    const set = (name, value) => {
      try {
        defaults.setBoolPref(name, value);
      } catch (err) {
        console.error(`[Zia] Could not set default for ${name}:`, err);
      }
    };
    // The icon names cached for the Phosphor icons (before 2.42.0) aren't
    // used any more; the Tabler ones have their own file.
    IOUtils.remove(PathUtils.join(PathUtils.profileDir, "zia-icon-vectors.json"), { ignoreAbsent: true }).catch(() => {});
    set("zen.widget.mac.mono-window-controls", false);
    set("zen.urlbar.replace-newtab", !Services.prefs.getBoolPref("zia.newtab.real-tab", true));
    set("browser.urlbar.trimHttps", true);
    set("browser.urlbar.untrimOnUserInteraction.featureGate", false);
    try {
      Services.prefs.setBoolPref("browser.urlbar.untrimOnUserInteraction", false);
      Services.prefs.setBoolPref("browser.urlbar.trimHttps", true);
    } catch (err) {
      noteError("zen defaults: set", err);
    }

    for (const feature of FEATURES) {
      set(`zia.features.${feature}`, true);
    }
    // Downloads a model the first time, so it's something to opt into

    for (const name of ZIA_OPTIONS) {
      set(name, true);
    }
    set("zia.tabs.favicon-glow", false);
    set("zia.swipe.dia-arrow", true);
    // Dimming asleep tabs was on by default for a few releases and is now
    // off: switched off once for anyone who had it from then.
    set("zia.tabs.dim-asleep", false);
    try {
      if (!Services.prefs.getBoolPref("zia.tabs.dim-asleep-reset", false)) {
        Services.prefs.clearUserPref("zia.tabs.dim-asleep");
        Services.prefs.setBoolPref("zia.tabs.dim-asleep-reset", true);
      }
    } catch (err) {
      noteError("zen defaults: dim asleep", err);
    }
    set("zia.essentials.fill-row", false);
    set("zia.pip.dia-style", true);
    set("zia.pip.tuck", true);
    set("zia.multiview", true);
    // Dia's picture-in-picture has skip buttons and a progress line, which
    // Firefox only shows with its improved controls.
    set("media.videocontrols.picture-in-picture.improved-video-controls.enabled", true);
    try {
      defaults.setStringPref("zia.urlbar.position", "top");
    } catch (err) {
      noteError("zen defaults: set (2)", err);
    }
  }
  // Options in Sine's settings. All on, except the favicon glow.
  const ZIA_OPTIONS = [
    "zia.urlbar.dia-style",
    "zia.newtab.real-tab",
    "zia.tabs.sound-bars",
    "zia.toolbar.site-color",
    "zia.page.rounding",
  ];
  const WATCHED_OPTIONS = ["zia.urlbar.dia-style", "zia.newtab.real-tab", "zia.toolbar.site-color"];


  // ---------- Picture-in-picture: Dia's look, and tucking into the screen edge
  const PIP_PLAYER_URL = "chrome://global/content/pictureinpicture/player.xhtml";
  const PIP_SCRIPT_URL = "chrome://sine/content/zia/zia-pip.js";

  function decoratePipWindow(win) {
    try {
      if (win.__ziaPipLoaded || win.location?.href !== PIP_PLAYER_URL) {
        return;
      }
      Services.scriptloader.loadSubScript(PIP_SCRIPT_URL, win);
      tintPipWindows();
    } catch (err) {
      console.error("[Zia] Couldn't set up picture-in-picture:", err);
    }
  }
  function watchPipWindows() {
    const observer = (subject, topic) => {
      if (topic !== "domwindowopened") {
        return;
      }
      subject.addEventListener(
        "load",
        () => {
          // The player fills in its controls on load; give it a moment first.
          setTimeout(() => decoratePipWindow(subject), 0);
        },
        { once: true }
      );
    };
    Services.ww.registerNotification(observer);
    window.addEventListener("unload", () => Services.ww.unregisterNotification(observer));
    for (const win of Services.wm.getEnumerator("Toolkit:PictureInPicture")) {
      decoratePipWindow(win);
    }
  }
  // ---------- Multiview: a tab that grids up videos and live streams
  // "Add to Multiview" (on a video, the page or a tab) turns the site's video
  // into an embeddable player and adds it to the Multiview tab, a small page
  // on the repo's GitHub Pages (YouTube and Twitch only play embeds on a real
  // web address). The videos live in the page's address, so it survives
  // restarts.
  const MULTIVIEW_URL = "https://z1n-k.github.io/zia/multiview/";
  const MULTIVIEW_PREF = "zia.multiview";
  const MULTIVIEW_COLOR_PREF = "zia.multiview.icon-color";
  const MULTIVIEW_MAX = 4;
  const ZIA_BLUE = "5ab9f5";
  const TWITCH_RESERVED = new Set([
    "directory", "videos", "settings", "search", "p", "downloads", "jobs", "turbo",
    "subscriptions", "inventory", "wallet", "drops", "friends", "messages", "login", "signup",
  ]);
  const KICK_RESERVED = new Set(["categories", "browse", "following", "search", "dashboard", "settings", "category"]);

  // A video (the page it's on, its own file, where it's up to) as a Multiview
  // entry: [kind, id, seconds or 0].
  function multiviewEntry(pageSpec, mediaSpec, seconds) {
    let url;
    try {
      url = new URL(pageSpec);
    } catch (err) {
      return null;
    }
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    const at = Math.max(0, Math.floor(seconds || 0));
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const id =
        url.searchParams.get("v") ||
        (["shorts", "live", "embed"].includes(parts[0]) ? parts[1] : null);
      return id && /^[\w-]{6,}$/.test(id) ? ["yt", id, at] : null;
    }
    if (host === "youtu.be") {
      return parts[0] ? ["yt", parts[0], at] : null;
    }
    if (host === "clips.twitch.tv" && parts[0]) {
      return ["twc", parts[0] === "embed" ? url.searchParams.get("clip") : parts[0], 0];
    }
    if (host === "player.twitch.tv") {
      const channel = url.searchParams.get("channel");
      const video = url.searchParams.get("video");
      return channel ? ["tw", channel, 0] : video ? ["twv", video.replace(/^v/, ""), at] : null;
    }
    if (host === "twitch.tv") {
      if (parts[0] === "videos" && /^\d+$/.test(parts[1] || "")) {
        return ["twv", parts[1], at];
      }
      if (parts[1] === "clip" && parts[2]) {
        return ["twc", parts[2], 0];
      }
      if (parts[0] && !TWITCH_RESERVED.has(parts[0].toLowerCase())) {
        return ["tw", parts[0].toLowerCase(), 0];
      }
      return null;
    }
    if (host === "kick.com" || host === "player.kick.com") {
      return parts[0] && !KICK_RESERVED.has(parts[0].toLowerCase()) ? ["kick", parts[0].toLowerCase(), 0] : null;
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id = parts.find((part) => /^\d+$/.test(part));
      return id ? ["vm", id, at] : null;
    }
    if (host === "dailymotion.com" || host === "dai.ly") {
      const id = host === "dai.ly" ? parts[0] : parts.includes("video") ? parts[parts.indexOf("video") + 1] : null;
      return id ? ["dm", id.split("_")[0], at] : null;
    }
    // Anything else: the video's own file, if it's a whole video file (not
    // one chunk of a stream, which is all many sites' players load at once).
    if (/^https?:\/\/[^?#]+\.(mp4|m4v|webm|ogv|ogg|mov)([?#]|$)/i.test(mediaSpec || "")) {
      return ["file", mediaSpec, at];
    }
    return null;
  }

  // Where the tab's playing video is up to (0 for live streams).
  function multiviewPosition(browser) {
    try {
      const state = browser?.browsingContext?.mediaController?.getPositionState();
      if (state && Number.isFinite(state.duration) && state.duration > 0 && state.duration < 1e7) {
        return state.position;
      }
    } catch (err) {
      // (no media playing: Firefox says so by throwing, nothing's wrong)
      if (err?.result !== Cr.NS_ERROR_NOT_AVAILABLE) {
        noteError("multiview: multiviewPosition", err);
      }
    }
    return 0;
  }

  // The Multiview page is Zia's own, so the address bar, split panes and hover
  // cards show it by name rather than as a github.io address.
  function isMultiviewURI(uri) {
    try {
      return !!uri?.spec?.startsWith(MULTIVIEW_URL);
    } catch (err) {
      return false;
    }
  }

  const multiviewKey = (entry) => `${entry[0]}:${entry[1]}`;

  // Entries are [kind, id, seconds, title]. In the address:
  // #~colour,kind:id@seconds;title,...
  function multiviewEntries(spec) {
    const hash = (spec.split("#")[1] || "").trim();
    return hash
      .split(",")
      .filter((item) => item && !item.startsWith("~"))
      .map((item) => {
        const [body, title] = item.split(";");
        const [head, at] = body.split("@");
        const [kind, id] = head.split(":");
        return kind && id ? [kind, decodeURIComponent(id), Number(at) || 0, title ? decodeURIComponent(title) : ""] : null;
      })
      .filter(Boolean);
  }

  // The colour the Multiview tab fills its grid icon with, one square per
  // video: Zia's blue, or the space's own colour.
  function multiviewColor() {
    let choice = "zia";
    try {
      choice = Services.prefs.getStringPref(MULTIVIEW_COLOR_PREF, "zia");
    } catch (err) {
      noteError("multiview: multiviewColor", err);
    }
    if (choice === "space" && root.getAttribute("zen-default-theme") !== "true") {
      const m = getComputedStyle(root).getPropertyValue("--zen-primary-color").match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3) {
        return m
          .slice(0, 3)
          .map((n) => Math.round(Math.min(255, Number(n))).toString(16).padStart(2, "0"))
          .join("");
      }
    }
    return ZIA_BLUE;
  }

  function multiviewSpec(entries) {
    const items = entries.map(
      ([kind, id, at, title]) =>
        `${kind}:${encodeURIComponent(id)}${at ? `@${Math.floor(at)}` : ""}${title ? `;${encodeURIComponent(title)}` : ""}`
    );
    return `${MULTIVIEW_URL}#${[`~${multiviewColor()}`, ...items].join(",")}`;
  }

  // Only the address's # part changes, so the page updates without
  // reloading its players.
  function setMultiviewSpec(tab, spec) {
    if (tab.linkedBrowser.currentURI.spec !== spec) {
      tab.linkedBrowser.fixupAndLoadURIString(spec, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
  }

  const findMultiviewTab = () => gBrowser.visibleTabs.find(isMultiviewTab);

  function currentMultiview() {
    const tab = findMultiviewTab();
    return tab ? multiviewEntries(tab.linkedBrowser.currentURI.spec) : [];
  }

  function recolorMultiview(tab) {
    // Not unloaded tabs: changing their address would load them.
    if (isMultiviewTab(tab) && !tab.hasAttribute("pending")) {
      setMultiviewSpec(tab, multiviewSpec(multiviewEntries(tab.linkedBrowser.currentURI.spec)));
    }
  }

  function isMultiviewTab(tab) {
    return tab?.linkedBrowser?.currentURI?.spec?.startsWith(MULTIVIEW_URL);
  }

  // Adds a video, or with `replace` puts it in that video's place; the other
  // tiles keep playing.
  function addToMultiview(entry, replace = -1) {
    const tab = findMultiviewTab();
    if (!tab) {
      gBrowser.selectedTab = gBrowser.addTrustedTab(multiviewSpec([entry]), {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      return;
    }
    const entries = multiviewEntries(tab.linkedBrowser.currentURI.spec);
    if (!entries.some((item) => multiviewKey(item) === multiviewKey(entry))) {
      if (replace >= 0 && replace < entries.length) {
        entries[replace] = entry;
      } else if (entries.length < MULTIVIEW_MAX) {
        entries.push(entry);
      }
    }
    setMultiviewSpec(tab, multiviewSpec(entries));
    gBrowser.selectedTab = tab;
  }

  // A tab's title without its site's name or unread count, for labels.
  function multiviewTitle(tab) {
    return (tab?.label || "")
      .replace(/^\(\d+\+?\)\s*/, "")
      .replace(/\s*[-–|•]\s*(YouTube|Twitch|Kick|Vimeo|Dailymotion)\s*$/i, "")
      .trim()
      .slice(0, 120);
  }

  function multiviewSite([kind, id]) {
    switch (kind) {
      case "yt":
        return "YouTube";
      case "tw":
        return `twitch.tv/${id}`;
      case "twv":
        return "Twitch video";
      case "twc":
        return "Twitch clip";
      case "kick":
        return `kick.com/${id}`;
      case "vm":
        return "Vimeo";
      case "dm":
        return "Dailymotion";
      default:
        try {
          return new URL(id).hostname.replace(/^www\./, "");
        } catch (err) {
          return "Video";
        }
    }
  }

  function multiviewLabel(entry) {
    const site = multiviewSite(entry);
    const title = entry[3];
    if (!title || title.toLowerCase() === site.toLowerCase()) {
      return site;
    }
    return `${title.length > 60 ? `${title.slice(0, 59)}…` : title} — ${site}`;
  }

  function tabMultiviewEntry(tab) {
    const browser = tab?.linkedBrowser;
    if (!browser || isMultiviewTab(tab)) {
      return null;
    }
    const entry = multiviewEntry(browser.currentURI?.spec, null, multiviewPosition(browser));
    return entry && [...entry, multiviewTitle(tab)];
  }

  // "Add to Multiview", or once it holds four, "Replace in Multiview" with
  // the four videos to choose from.
  function attachMultiviewMenu(menu, anchor, idPrefix, readEntry) {
    let pending = null;
    const item = document.createXULElement("menuitem");
    item.id = `${idPrefix}-multiview`;
    item.setAttribute("label", "Add to Multiview");
    item.setAttribute("accesskey", "M");
    item.addEventListener("command", () => pending && addToMultiview(pending));

    const replaceMenu = document.createXULElement("menu");
    replaceMenu.id = `${idPrefix}-multiview-replace`;
    replaceMenu.setAttribute("label", "Replace in Multiview");
    replaceMenu.setAttribute("accesskey", "M");
    const replacePopup = document.createXULElement("menupopup");
    replaceMenu.appendChild(replacePopup);

    if (anchor) {
      anchor.after(item, replaceMenu);
    } else {
      menu.append(item, replaceMenu);
    }

    menu.addEventListener("popupshowing", (event) => {
      if (event.target !== menu) {
        return;
      }
      pending = readEntry();
      const current = currentMultiview();
      const already = !!pending && current.some((entry) => multiviewKey(entry) === multiviewKey(pending));
      const full = !!pending && !already && current.length >= MULTIVIEW_MAX;
      item.hidden = !pending || full;
      replaceMenu.hidden = !full;
      if (!full) {
        return;
      }
      replacePopup.replaceChildren(
        ...current.map((entry, index) => {
          const choice = document.createXULElement("menuitem");
          choice.setAttribute("label", multiviewLabel(entry));
          choice.addEventListener("command", () => addToMultiview(pending, index));
          return choice;
        })
      );
    });
  }

  function watchMultiview() {
    const enabled = () => Services.prefs.getBoolPref(MULTIVIEW_PREF, true);

    // Right-clicking a video, or the page of a video site. (YouTube shows its
    // own menu first; right-click again for this one.)
    const pageMenu = document.getElementById("contentAreaContextMenu");
    if (pageMenu) {
      attachMultiviewMenu(pageMenu, document.getElementById("context-video-pictureinpicture"), "zia-context", () => {
        const context = window.gContextMenu;
        if (!enabled() || !context || context.isTextSelected || context.onLink || context.onImage) {
          return null;
        }
        const browser = context.browser;
        const framePage = context.contentData?.docLocation;
        const topPage = browser?.currentURI?.spec;
        if (!topPage || topPage.startsWith(MULTIVIEW_URL)) {
          return null;
        }
        const at = multiviewPosition(browser);
        let entry;
        if (context.onVideo) {
          // The site first (the frame the video is in, then the page), and
          // only then the video's own file.
          entry =
            (framePage && multiviewEntry(framePage, null, at)) ||
            multiviewEntry(topPage, null, at) ||
            multiviewEntry(topPage, context.mediaURL, at);
        } else {
          entry = multiviewEntry(topPage, null, at);
          entry = entry && entry[0] !== "file" ? entry : null;
        }
        return entry && [...entry, multiviewTitle(gBrowser.getTabForBrowser(browser))];
      });
    }

    // Right-clicking a tab
    const tabMenu = document.getElementById("tabContextMenu");
    if (tabMenu) {
      const anchor = document.getElementById("context_duplicateTab") || document.getElementById("context_reloadTab");
      attachMultiviewMenu(tabMenu, anchor, "zia-tab", () => {
        const entry = enabled() && tabMultiviewEntry(window.TabContextMenu?.contextTab);
        return entry && entry[0] !== "file" ? entry : null;
      });
    }

    // Keep the grid icon's colour current: when the Multiview tab is shown
    // (the space may have changed colour) and when the setting changes.
    gBrowser.tabContainer.addEventListener("TabSelect", (event) => recolorMultiview(event.target));
    const onColorPref = () => {
      for (const tab of gBrowser.tabs) {
        recolorMultiview(tab);
      }
    };
    Services.prefs.addObserver(MULTIVIEW_COLOR_PREF, onColorPref);
    window.addEventListener("unload", () => Services.prefs.removeObserver(MULTIVIEW_COLOR_PREF, onColorPref));
  }

  const URLBAR_POSITION_PREF = "zia.urlbar.position";

  function watchUrlbarPosition() {
    const apply = () => {
      let position = "top";
      try {
        position = Services.prefs.getStringPref(URLBAR_POSITION_PREF, "top");
      } catch (err) {
        noteError("options: apply", err);
      }
      root.setAttribute("zia-urlbar-position", position === "bottom" ? "bottom" : "top");
      requestAnimationFrame(() => {
        rememberClosedText();
        schedulePanes();
      });
    };
    apply();
    Services.prefs.addObserver(URLBAR_POSITION_PREF, apply);
    window.addEventListener("unload", () => Services.prefs.removeObserver(URLBAR_POSITION_PREF, apply));
  }

  function watchOptions() {
    const urlbar = gURLBar?.textbox || document.getElementById("urlbar");
    const apply = () => {
      urlbar?.toggleAttribute("zia-classic", !Services.prefs.getBoolPref("zia.urlbar.dia-style", true));
      // Off gives Cmd/Ctrl+T back to Zen's floating address bar.
      try {
        const defaults = Services.prefs.getDefaultBranch("");
        defaults.setBoolPref("zen.urlbar.replace-newtab", !Services.prefs.getBoolPref("zia.newtab.real-tab", true));
      } catch (err) {
        noteError("options: apply (2)", err);
      }
    };
    const onChange = () => {
      apply();
      appliedColorKey = null;
      updateColor();
    };
    apply();
    for (const name of WATCHED_OPTIONS) {
      Services.prefs.addObserver(name, onChange);
    }
    window.addEventListener("unload", () => {
      for (const name of WATCHED_OPTIONS) {
        Services.prefs.removeObserver(name, onChange);
      }
    });
  }

  const FEATURES = ["media-player", "find-bar", "icon-picker", "undo-close", "tab-hover-cards"];

  function featureOn(name) {
    try {
      return Services.prefs.getBoolPref(`zia.features.${name}`, true);
    } catch (err) {
      return true;
    }
  }

  function ifOn(feature, name, fn) {
    if (featureOn(feature)) {
      safely(name, fn);
    }
  }
  function addDownloadProgress() {
    const button = document.getElementById("downloads-button");
    const commons = window.DownloadsCommon;
    if (!button || !commons?.getData) {
      return;
    }

    const NS = "http://www.w3.org/2000/svg";
    const ring = document.createElementNS(NS, "svg");
    ring.id = "zia-download-ring";
    ring.setAttribute("viewBox", "0 0 100 100");
    const track = document.createElementNS(NS, "circle");
    const arc = document.createElementNS(NS, "circle");

    const RADIUS = 46;
    const STROKE = 7;
    for (const circle of [track, arc]) {
      circle.setAttribute("cx", "50");
      circle.setAttribute("cy", "50");
      circle.setAttribute("r", `${RADIUS}`);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke-width", `${STROKE}`);
      ring.appendChild(circle);
    }
    track.setAttribute("class", "zia-download-ring-track");
    arc.setAttribute("class", "zia-download-ring-arc");
    arc.setAttribute("stroke-linecap", "round");

    arc.setAttribute("transform", "rotate(-90 50 50)");
    const circumference = 2 * Math.PI * RADIUS;
    arc.setAttribute("stroke-dasharray", `${circumference}`);
    arc.setAttribute("stroke-dashoffset", `${circumference}`);
    button.appendChild(ring);

    function draw(fraction) {
      arc.setAttribute("stroke-dashoffset", `${circumference * (1 - fraction)}`);
    }

    function update(downloads) {
      let done = 0;
      let total = 0;
      let running = false;
      for (const download of downloads) {
        if (download.succeeded || download.canceled || download.error) {
          continue;
        }

        if (download.hasProgress && download.totalBytes > 0) {
          done += download.currentBytes || 0;
          total += download.totalBytes;
        }
        running = true;
      }
      if (!running || total <= 0) {
        button.removeAttribute("zia-downloading");
        draw(0);
        return;
      }
      button.setAttribute("zia-downloading", "true");
      draw(Math.min(1, done / total));
    }

    const data = commons.getData(window);
    const seen = new Set();
    const view = {
      onDownloadAdded(download) {
        seen.add(download);
        update(seen);
      },
      onDownloadChanged(download) {
        seen.add(download);
        update(seen);
      },
      onDownloadRemoved(download) {
        seen.delete(download);
        update(seen);
      },
    };
    data.addView(view);
  }


  // With the downloads button hidden until there's a download (Firefox's
  // "auto-hide"), the first download's arc flew to the corner and dropped
  // a square there: Zen looks for the button before Firefox has shown it.
  // The button is shown first, and the arc waits a frame for it to land.
  function flyFirstDownloadToButton() {
    customElements.whenDefined("zen-download-animation").then(() => {
      const proto = customElements.get("zen-download-animation")?.prototype;
      const original = proto?.initializeAnimation;
      if (typeof original !== "function" || original.__zia) {
        return;
      }
      const patched = async function (...args) {
        const button = document.getElementById("downloads-button");
        if (button?.hidden) {
          try {
            window.DownloadsButton?.unhide?.();
          } catch (err) {
            noteError("downloads: unhide", err);
          }
          button.hidden = false;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
        return original.apply(this, args);
      };
      patched.__zia = true;
      proto.initializeAnimation = patched;
    }, () => {});
  }
  // Zia's icons are Tabler Icons (made by scripts/tabler-icons.py), each in
  // an outline and, for about a thousand of them, a solid style. The search
  // index holds every icon's name, tags and category, so "money" finds cash,
  // coins and wallet.
  //
  // They come as one file, icons/tabler-bundle.js: Sine unpacks a mod file
  // by file, and several thousand icons froze Zen for half a minute on some
  // computers (and as one file they compress to a fraction of the size).
  // Zia makes a zip of them in the profile (once per icon pack, so Zia's own
  // updates don't redo it) and reads icons straight out of it, the way
  // Firefox reads its own, at resource://zia-tabler/.
  const ICON_ROOT = "chrome://sine/content/zia/icons";
  const ICON_HOST = "zia-tabler";
  const ICON_DIR = `resource://${ICON_HOST}`;
  const ICON_STYLE_PREF = "zia.icons.style";
  let iconIndex = null;
  let iconPackReady = null;

  function iconPackPath() {
    const holder = {};
    Services.scriptloader.loadSubScript(`${ICON_ROOT}/tabler-pack.js`, holder);
    return PathUtils.join(PathUtils.profileDir, "zia-icons", `tabler-${holder.ZiaTablerPack}.zip`);
  }

  function pointAtIconPack(pack) {
    const handler = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    const jar = Services.io.newURI(`jar:${PathUtils.toFileURI(pack)}!/`);
    if (!handler.hasSubstitution(ICON_HOST) || handler.getSubstitution(ICON_HOST).spec !== jar.spec) {
      handler.setSubstitution(ICON_HOST, jar);
    }
  }

  // Folder and space icons are drawn as Zen restores them, before the rest
  // of Zia starts, so once the pack is there it's pointed at the moment this
  // script loads.
  try {
    const pack = iconPackPath();
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(pack);
    if (file.exists()) {
      pointAtIconPack(pack);
    }
  } catch (err) {
    noteError("icon pack: early", err);
  }

  // Anything that still asked for an icon before the pack was ready (the
  // first start with it) is drawn again.
  function redrawPackIcons() {
    const prefixes = [`${ICON_DIR}/`, "resource://zia-own-icons/"];
    for (const image of document.querySelectorAll("image, img")) {
      for (const name of ["src", "href"]) {
        const url = image.getAttribute(name);
        if (prefixes.some((prefix) => url?.startsWith(prefix))) {
          image.setAttribute(name, "");
          image.setAttribute(name, url);
          if (image.style.opacity === "0") {
            image.style.opacity = "1";
          }
        }
      }
    }
  }

  // The bundle's icons as a zip ({outline,filled}/name.svg and the LICENSE),
  // stored rather than compressed: it's only ever read from the profile.
  let crcTable = null;
  const crc32 = (bytes) => {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  function zipOf(entries) {
    const encoder = new TextEncoder();
    const items = entries.map(([name, text]) => {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(text);
      return { nameBytes, data, crc: crc32(data) };
    });
    let size = 22;
    for (const item of items) {
      size += 30 + 46 + 2 * item.nameBytes.length + item.data.length;
    }
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let at = 0;
    const u16 = (v) => {
      view.setUint16(at, v, true);
      at += 2;
    };
    const u32 = (v) => {
      view.setUint32(at, v, true);
      at += 4;
    };
    const DATE = 0x21; // 1 January 1980
    for (const item of items) {
      item.offset = at;
      u32(0x04034b50);
      u16(10);
      u16(0);
      u16(0);
      u16(0);
      u16(DATE);
      u32(item.crc);
      u32(item.data.length);
      u32(item.data.length);
      u16(item.nameBytes.length);
      u16(0);
      out.set(item.nameBytes, at);
      at += item.nameBytes.length;
      out.set(item.data, at);
      at += item.data.length;
    }
    const directory = at;
    for (const item of items) {
      u32(0x02014b50);
      u16(20);
      u16(10);
      u16(0);
      u16(0);
      u16(0);
      u16(DATE);
      u32(item.crc);
      u32(item.data.length);
      u32(item.data.length);
      u16(item.nameBytes.length);
      u16(0);
      u16(0);
      u16(0);
      u16(0);
      u32(0o644 << 16);
      u32(item.offset);
      out.set(item.nameBytes, at);
      at += item.nameBytes.length;
    }
    const directorySize = at - directory;
    u32(0x06054b50);
    u16(0);
    u16(0);
    u16(items.length);
    u16(items.length);
    u32(directorySize);
    u32(directory);
    u16(0);
    return out;
  }

  async function packFromBundle() {
    const holder = {};
    Services.scriptloader.loadSubScript(`${ICON_ROOT}/tabler-bundle.js`, holder);
    const { head, icons } = holder.ZiaTablerBundle;
    const entries = [];
    for (const style of Object.keys(icons).sort()) {
      for (const name of Object.keys(icons[style]).sort()) {
        entries.push([`${style}/${name}.svg`, `${head[style]}${icons[style][name]}</svg>`]);
      }
    }
    try {
      entries.push(["LICENSE", await (await fetch(`${ICON_ROOT}/tabler-LICENSE`)).text()]);
    } catch (err) {
      noteError("icon pack: licence", err);
    }
    return zipOf(entries);
  }

  function setupIconPack() {
    iconPackReady ??= (async () => {
      const pack = iconPackPath();
      const dir = PathUtils.parent(pack);
      if (!(await IOUtils.exists(pack))) {
        const bytes = await packFromBundle();
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
        // written aside first, so another window never reads half a zip
        const part = `${pack}.${Math.random().toString(36).slice(2)}.part`;
        await IOUtils.write(part, bytes);
        await IOUtils.move(part, pack);
      }
      pointAtIconPack(pack);
      // Older packs go (one still open can't be removed on Windows until
      // Zen restarts; it goes next time).
      for (const child of await IOUtils.getChildren(dir)) {
        if (child !== pack && /tabler-[^/\\]*\.zip(\.[a-z0-9]+\.part)?$/.test(child)) {
          IOUtils.remove(child).catch(() => {});
        }
      }
    })();
    iconPackReady.catch((err) => noteError("icon pack", err));
    return iconPackReady;
  }

  function tablerIcons() {
    if (iconIndex) {
      return iconIndex;
    }
    const holder = {};
    try {
      Services.scriptloader.loadSubScript(`${ICON_ROOT}/tabler-names.js`, holder);
    } catch (err) {
      noteError("icon picker: load names", err);
    }
    iconIndex = (holder.ZiaTablerIcons || []).map((row) => {
      const [name, styles, words] = row.split("|");
      return { name, outline: styles.includes("o"), filled: styles.includes("f"), words: words || "" };
    });
    return iconIndex;
  }

  function iconStyle() {
    try {
      return Services.prefs.getStringPref(ICON_STYLE_PREF, "outline") === "filled" ? "filled" : "outline";
    } catch (err) {
      return "outline";
    }
  }

  // Best matches first: the name itself, then words in the name, then tags.
  function searchIcons(icons, text) {
    const terms = text.toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (!terms.length) {
      return icons;
    }
    const scored = [];
    for (const icon of icons) {
      const parts = icon.name.split("-");
      let score = 0;
      for (const term of terms) {
        if (parts.includes(term)) {
          score += 3;
        } else if (parts.some((part) => part.startsWith(term))) {
          score += 2;
        } else if (icon.name.includes(term) || icon.words.includes(term)) {
          score += 1;
        } else {
          score = 0;
          break;
        }
      }
      if (score) {
        if (icon.name === terms.join("-")) {
          score += 10;
        } else if (parts[0] === terms[0]) {
          score += 1;
        }
        scored.push({ icon, score });
      }
    }
    return scored.sort((a, b) => b.score - a.score || a.icon.name.length - b.icon.name.length).map((entry) => entry.icon);
  }

  // Folders and spaces that still point at a Phosphor icon (Zia's icons
  // before 2.42.0) switch to the closest Tabler one, and ones pointing at a
  // loose Tabler file (before 2.58.0) to the same icon in the pack.
  const OLD_ICON_DIR = `${ICON_ROOT}/phosphor/`;
  const LOOSE_ICON_DIR = `${ICON_ROOT}/tabler/`;
  let oldIconMap = null;

  function tablerFor(url) {
    if (typeof url === "string" && url.startsWith(LOOSE_ICON_DIR)) {
      return `${ICON_DIR}/${url.slice(LOOSE_ICON_DIR.length)}`;
    }
    if (typeof url !== "string" || !url.startsWith(OLD_ICON_DIR)) {
      return null;
    }
    if (!oldIconMap) {
      const holder = {};
      try {
        Services.scriptloader.loadSubScript(`${ICON_ROOT}/phosphor-to-tabler.js`, holder);
      } catch (err) {
        noteError("icon picker: load old icon map", err);
      }
      oldIconMap = holder.ZiaPhosphorToTabler || {};
    }
    const name = url.slice(OLD_ICON_DIR.length).replace(/\.svg$/, "");
    return `${ICON_DIR}/outline/${oldIconMap[name] || name}.svg`;
  }

  function moveOffOldIcons() {
    try {
      for (const space of window.gZenWorkspaces?.getWorkspaces?.() || []) {
        const icon = tablerFor(space.icon);
        if (icon) {
          space.icon = icon;
          window.gZenWorkspaces.saveWorkspace(space);
        }
      }
    } catch (err) {
      noteError("icon picker: move space icons", err);
    }
  }

  function watchOldIcons() {
    let queued = false;
    const queue = () => {
      if (!queued) {
        queued = true;
        setTimeout(() => {
          queued = false;
          setupIconPack().finally(moveOffOldIcons);
        }, 500);
      }
    };
    window.addEventListener("ZenWorkspacesUIUpdate", queue);
    window.SessionStore?.promiseAllWindowsRestored?.then(queue, queue);
    queue();
    // Icons asked for before the pack was ready are drawn again once it is,
    // including after the session's folders and spaces have come back.
    const redraw = () => {
      redrawPackIcons();
      placeWorkspaceIndicator();
    };
    setupIconPack().then(() => {
      redraw();
      window.SessionStore?.promiseAllWindowsRestored?.then(() => setTimeout(redraw, 300), () => {});
    }, () => {});
  }

  function addIconPicker() {
    const picker = window.gZenEmojiPicker;
    const panel = document.getElementById("PanelUI-zen-emojis-picker");
    const pages = document.getElementById("PanelUI-zen-emojis-picker-pages");
    const tabs = document.getElementById("PanelUI-zen-emojis-buttons-wrapper");
    const search = document.getElementById("PanelUI-zen-emojis-picker-search");
    if (!picker || !panel || !pages || !tabs) {
      return;
    }

    const tab = document.createXULElement("toolbarbutton");
    tab.id = "zia-icons-tab";
    tab.setAttribute("label", "Zia");
    tabs.appendChild(tab);

    function nameZenTab() {
      const zenTab = document.getElementById("PanelUI-zen-emojis-picker-change-svg");
      if (zenTab && zenTab.getAttribute("label") !== "Zen") {
        zenTab.removeAttribute("data-l10n-id");
        zenTab.removeAttribute("data-l10n-args");
        zenTab.setAttribute("label", "Zen");
      }
    }

    const HTML = "http://www.w3.org/1999/xhtml";
    const page = document.createXULElement("vbox");
    page.id = "zia-icons-page";
    const bar = document.createElementNS(HTML, "div");
    bar.id = "zia-icons-searchbar";
    const box = document.createElementNS(HTML, "input");
    box.id = "zia-icons-search";
    box.setAttribute("type", "text");
    box.setAttribute("placeholder", "Search icons");
    // Outline or solid, remembered
    const styles = document.createElementNS(HTML, "div");
    styles.id = "zia-icons-style";
    const styleButtons = {};
    for (const [value, label] of [["outline", "Outline"], ["filled", "Solid"]]) {
      const button = document.createElementNS(HTML, "button");
      button.className = "zia-icons-style-option";
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        try {
          Services.prefs.setStringPref(ICON_STYLE_PREF, value);
        } catch (err) {
          noteError("icon picker: save style", err);
        }
        showStyle();
        render();
      });
      styleButtons[value] = button;
      styles.appendChild(button);
    }
    bar.append(box, styles);
    const grid = document.createElementNS(HTML, "div");
    grid.id = "zia-icons-grid";
    const empty = document.createElementNS(HTML, "div");
    empty.id = "zia-icons-empty";
    empty.textContent = "No icons found";
    empty.hidden = true;
    page.append(bar, grid, empty);
    pages.appendChild(page);

    function showStyle() {
      const current = iconStyle();
      for (const [value, button] of Object.entries(styleButtons)) {
        button.toggleAttribute("selected", value === current);
      }
    }

    let showing = false;
    let picked = false;
    let resolvePick = null;
    let options = null;

    function choose(url) {
      picked = true;
      // as Zen does after its own picks: with an icon chosen, the "none"
      // (bin) button can take it off again
      panel.removeAttribute("hide-none-option");
      options?.onSelect?.(url);
      resolvePick?.(url);
      if (options?.closeOnSelect !== false) {
        panel.hidePopup();
      }
    }

    // Results are added a screenful at a time as the grid scrolls, so the
    // thousands of icons never load at once.
    const BATCH = 180;
    let results = [];
    let shown = 0;
    let lastQuery = null;
    const more = document.createElementNS(HTML, "div");
    more.id = "zia-icons-more";
    const moreWatcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          addMore();
        }
      },
      { root: grid, rootMargin: "200px" }
    );
    moreWatcher.observe(more);

    function addMore() {
      if (shown >= results.length) {
        return;
      }
      const style = iconStyle();
      const fragment = document.createDocumentFragment();
      for (const icon of results.slice(shown, shown + BATCH)) {
        const url = `${ICON_DIR}/${style}/${icon.name}.svg`;
        const item = document.createXULElement("toolbarbutton");
        item.className = "toolbarbutton-1 zen-emojis-picker-svg zia-icon-item";
        item.setAttribute("tooltiptext", icon.name.replace(/-/g, " "));
        item.style.listStyleImage = `url(${url})`;
        // Zen's picker takes every click on an icon with its class as one
        // of its own, and would pass on a broken address (it reads an
        // "icon" attribute these don't have) after Zia's
        item.addEventListener("command", (event) => {
          event.stopPropagation();
          choose(url);
        });
        fragment.appendChild(item);
      }
      shown = Math.min(results.length, shown + BATCH);
      grid.insertBefore(fragment, more);
    }

    function render() {
      const style = iconStyle();
      const query = `${style}:${(box.value || "").trim()}`;
      if (query === lastQuery) {
        return;
      }
      lastQuery = query;
      results = searchIcons(tablerIcons().filter((icon) => icon[style]), box.value || "");
      shown = 0;
      grid.replaceChildren(more);
      grid.scrollTop = 0;
      empty.hidden = results.length > 0;
      addMore();
    }

    function show() {
      showing = true;
      showStyle();
      render();
      box.focus({ preventScroll: true });
      page.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      tab.classList.add("selected");
      for (const other of tabs.children) {
        if (other !== tab) {
          other.classList.remove("selected");
        }
      }
    }

    tab.addEventListener("command", show);

    panel.addEventListener("command", (event) => {
      if (event.target === tab) {
        return;
      }
      if (event.target.id?.startsWith("PanelUI-zen-emojis-picker-change")) {
        showing = false;
        tab.classList.remove("selected");
      }
    });

    function matchZenSearch() {
      const zenBox = document.getElementById("PanelUI-zen-emojis-picker-search");
      if (!zenBox) {
        return;
      }
      const from = getComputedStyle(zenBox);
      for (const prop of [
        "appearance", "padding", "border", "borderRadius", "backgroundColor",
        "backgroundImage", "color", "font", "fontSize", "fontFamily",
        "boxShadow", "outline", "minHeight", "height", "lineHeight",
      ]) {
        const value = from[prop];
        if (value && value !== "auto") {
          box.style[prop] = value;
        }
      }

      const rect = zenBox.getBoundingClientRect();
      if (rect.height > 0) {
        box.style.boxSizing = "border-box";
        box.style.height = `${rect.height}px`;
        box.style.minHeight = `${rect.height}px`;
      }

      const header = document.getElementById("PanelUI-zen-emojis-picker-header");
      if (header) {
        const row = getComputedStyle(header);
        for (const prop of ["padding", "gap", "alignItems"]) {
          if (row[prop]) {
            bar.style[prop] = row[prop];
          }
        }
      }
      const zenList = document.getElementById("PanelUI-zen-emojis-picker-svgs");
      if (zenList) {
        const list = getComputedStyle(zenList);
        for (const prop of ["padding", "gap", "gridTemplateColumns"]) {
          if (list[prop]) {
            grid.style[prop] = list[prop];
          }
        }
      }
    }

    box.addEventListener("input", render);

    search?.addEventListener("input", () => {
      if (showing) {
        box.value = search.value;
        render();
      }
    });

    panel.addEventListener("popupshowing", () => {
      nameZenTab();
      matchZenSearch();
    });

    panel.addEventListener("popupshown", () => {
      nameZenTab();
      matchZenSearch();
      showing = false;
      tab.classList.remove("selected");
      if (search && lastQuery !== null) {
        render();
      }
    });

    const openPicker = picker.open.bind(picker);
    picker.open = function (anchor, settings = {}) {
      const zenPick = openPicker(anchor, settings);
      if (!zenPick) {
        return zenPick;
      }
      options = settings;
      picked = false;
      const ziaPick = new Promise((resolve) => {
        resolvePick = resolve;
      });

      return Promise.race([
        zenPick.catch((err) => {
          if (picked) {
            return ziaPick;
          }
          throw err;
        }),
        ziaPick,
      ]);
    };
  }
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
  // Native Zen group and drag behavior is used in this variant.
  // Native Zen group and drag behavior is used in this variant.
  // Native Zen group and drag behavior is used in this variant.
  // Optional: the last essential stretches across whatever's left of its row.
  // The grid can't span "to the end of the row" by itself, so Zia counts the
  // columns and sets the span.
  const FILL_ROW_PREF = "zia.essentials.fill-row";
  // Zia's narrower essentials (off: Zen's widths, which already fill the row)
  const ZIA_WIDTH_PREF = "zia.essentials.zia-width";

  // The grid's own columns, worked out as the grid does (as many as fit at
  // the tiles' least width). Its computed column list also holds the extra
  // columns a span wider than the grid creates; counting those grew the
  // span, which made more of them, until tiles were squeezed into slivers.
  const TWO_PER_ROW_PREF = "zia.essentials.two-per-row";

  function gridColumns(grid) {
    if (Services.prefs.getBoolPref(TWO_PER_ROW_PREF, false)) {
      return 2;
    }
    const style = getComputedStyle(grid);
    const width = grid.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const gap = parseFloat(style.columnGap) || 0;
    const least = parseFloat(getComputedStyle(root).getPropertyValue("--zia-essential-min-width")) || 54;
    return Math.max(1, Math.floor((width + gap) / (least + gap)));
  }

  function fillEssentialRows() {
    const on =
      Services.prefs.getBoolPref(FILL_ROW_PREF, false) &&
      (Services.prefs.getBoolPref(ZIA_WIDTH_PREF, true) || Services.prefs.getBoolPref(TWO_PER_ROW_PREF, false)) &&
      root.getAttribute("zen-sidebar-expanded") === "true";
    const wanted = new Map();
    if (on) {
      for (const grid of document.querySelectorAll(".zen-essentials-container")) {
        const tabs = [...grid.children].filter((tab) =>
          tab.matches?.(".tabbrowser-tab[zen-essential]:not([hidden], [zia-essential-proxy])")
        );
        const columns = gridColumns(grid);
        // (a single row already spans the sidebar: the grid folds away the
        // columns it doesn't need)
        const empty = columns - (tabs.length % columns || columns);
        if (tabs.length > columns && empty > 0) {
          wanted.set(tabs[tabs.length - 1], empty + 1);
        }
      }
    }
    for (const tab of document.querySelectorAll(".tabbrowser-tab[zia-fill-row]")) {
      if (!wanted.has(tab)) {
        tab.removeAttribute("zia-fill-row");
        tab.style.removeProperty("grid-column");
      }
    }
    for (const [tab, span] of wanted) {
      if (tab.style.getPropertyValue("grid-column") !== `span ${span}`) {
        tab.style.setProperty("grid-column", `span ${span}`);
      }
      tab.setAttribute("zia-fill-row", "true");
    }
  }

  function watchEssentialRows() {
    const essentials = document.getElementById("zen-essentials");
    if (!essentials) {
      return;
    }
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          fillEssentialRows();
        });
      }
    };
    new MutationObserver(schedule).observe(essentials, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "zen-essential"],
    });
    new ResizeObserver(schedule).observe(essentials);
    new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ["zen-sidebar-expanded"] });
    window.addEventListener("ZenWorkspacesUIUpdate", schedule);
    Services.prefs.addObserver(FILL_ROW_PREF, schedule);
    Services.prefs.addObserver(ZIA_WIDTH_PREF, schedule);
    Services.prefs.addObserver(TWO_PER_ROW_PREF, schedule);
    window.addEventListener("unload", () => {
      Services.prefs.removeObserver(FILL_ROW_PREF, schedule);
      Services.prefs.removeObserver(ZIA_WIDTH_PREF, schedule);
      Services.prefs.removeObserver(TWO_PER_ROW_PREF, schedule);
    });
    schedule();
  }
  // Native Zen group and drag behavior is used in this variant.
  function resolveColor(text) {
    if (!text) {
      return null;
    }
    let probe = document.getElementById("zia-color-probe");
    if (!probe) {
      probe = document.createElementNS(XHTML_NS, "div");
      probe.id = "zia-color-probe";
      probe.hidden = true;
      root.appendChild(probe);
    }
    probe.style.color = "";
    probe.style.color = text.trim();
    if (!probe.style.color) {
      return null;
    }
    return parseColor(getComputedStyle(probe).color);
  }

  const COLOR_TOKEN = /(?:rgba?|hsla?|color-mix|light-dark|oklch|oklab|lab|lch|color)\((?:[^()]|\([^()]*\))*\)|#[0-9a-fA-F]{3,8}\b|\btransparent\b/g;

  function paintColor(value) {
    if (!/gradient\(/.test(value)) {
      return resolveColor(value);
    }
    const stops = (value.match(COLOR_TOKEN) || []).map(resolveColor).filter(Boolean);
    if (!stops.length) {
      return null;
    }
    return [0, 1, 2, 3].map((i) => Math.round(stops.reduce((sum, c) => sum + c[i], 0) / stops.length));
  }

  function syncSidebarPaint() {
    const compact = root.getAttribute("zen-compact-mode") === "true";
    const layer = document.getElementById(compact ? "zen-toolbar-background" : "zen-browser-background");
    if (!layer) {
      return;
    }
    const name = compact ? "--zen-main-browser-background-toolbar" : "--zen-main-browser-background";
    const paint = paintColor(getComputedStyle(layer).getPropertyValue(name));
    const rootStyle = getComputedStyle(root);
    const tint = resolveColor(rootStyle.getPropertyValue("--zia-media-bg"));
    const base = resolveColor(rootStyle.getPropertyValue("--zia-media-card-base"));
    if (!paint || !tint || !base) {
      root.style.removeProperty("--zia-media-rest");
      root.style.removeProperty("--zia-media-solid");
      return;
    }

    root.style.setProperty("--zia-media-rest", cssColor(colorOver(tint, paint)));

    root.style.setProperty("--zia-media-solid", cssColor(colorOver(tint, colorOver(paint, base))));
  }

  function watchSidebarPaint() {
    syncSidebarPaint();
    const watcher = new MutationObserver(syncSidebarPaint);
    for (const id of ["zen-browser-background", "zen-toolbar-background"]) {
      const layer = document.getElementById(id);
      if (layer) {
        watcher.observe(layer, { attributes: true, attributeFilter: ["style"] });
      }
    }
    watcher.observe(root, { attributes: true, attributeFilter: ["zen-compact-mode"] });
  }

  function keepWindowButtonsInSidebar() {
    const manager = window.gZenVerticalTabsManager;
    if (!manager || manager.isWindowsStyledButtons) {
      return;
    }
    const wanted =
      root.getAttribute("zen-right-side") === "true" &&
      root.getAttribute("zen-compact-mode") !== "true" &&
      root.hasAttribute("zen-sidebar-expanded");
    if (!wanted) {
      return;
    }
    const buttons = manager.actualWindowButtons;
    const topButtons = document.getElementById("zen-sidebar-top-buttons");
    if (buttons && topButtons && buttons.parentNode !== topButtons) {
      topButtons.prepend(buttons);
    }
  }

  function watchWindowButtonsSide() {
    const soon = () => setTimeout(keepWindowButtonsInSidebar, 0);
    soon();
    setTimeout(keepWindowButtonsInSidebar, 1000);
    const watcher = new MutationObserver(soon);
    watcher.observe(root, {
      attributes: true,
      attributeFilter: ["zen-right-side", "zen-compact-mode", "zen-sidebar-expanded", "zen-single-toolbar"],
    });
    const navBar = document.getElementById("nav-bar");
    if (navBar) {
      watcher.observe(navBar, { childList: true });
    }
  }

  const TAB_CARD_DELAY = 600;
  const TAB_CARD_GRACE = 120;
  const TAB_CARD_GAP = 8;

  const ESSENTIAL_CARD_OVERLAP_X = 11;
  const ESSENTIAL_CARD_OVERLAP_Y = 2;
  const FOLDER_CARD_LIFT = 2;
  const DEFAULT_TAB_ICON = "chrome://sine/content/zia/icons/tab-default.svg";

  const TAB_CARD_ACTIONS = [
    {
      name: "essential",
      icon: "card-pin",
      label: "Add to Essentials",

      // Zen cannot promote a single pane without stranding the other tab.
      run: (tab) => {
        if (!inSplit(tab)) {
          gZenPinnedTabManager?.addToEssentials(tab);
        }
      },
      hidden: (tab) => tab.hasAttribute("zen-essential") || tab.pinned || inSplit(tab),
    },
    {
      name: "unpin",
      icon: "card-pinned-off",
      label: "Unpin",
      run: (tab) => {
        if (tab.hasAttribute("zen-essential")) {
          gZenPinnedTabManager?.removeEssentials(tab);
        } else {
          gBrowser.unpinTab(tab);
        }
      },
      hidden: (tab) => !tab.hasAttribute("zen-essential") && !tab.pinned,
    },
    {
      name: "split",
      icon: "card-split",
      label: "Add to Split",

      run: (tab) => {
        const other = tab === gBrowser.selectedTab ? lastUsedOtherTab(tab) : gBrowser.selectedTab;
        if (other) {
          gZenViewSplitter?.splitTabs(tab === gBrowser.selectedTab ? [tab, other] : [other, tab]);
        }
      },
      hidden: (tab) => !lastUsedOtherTab(tab),
    },
    {
      name: "copy",
      icon: "card-paperclip",
      label: "Copy link",
      run: (tab) => copyLink(tab),
      hidden: (tab) => tabCardKind(tab) !== "web",
      keepsCard: true,
    },
  ];

  const inSplit = (tab) => !!tab?.group?.hasAttribute?.("split-view-group");

  function copyLink(tab) {
    const uri = tab?.linkedBrowser?.currentURI;
    if (!uri || !/^https?$/.test(uri.scheme)) {
      return;
    }
    if (tab === gBrowser.selectedTab && typeof window.gZenCommonActions?.copyCurrentURLToClipboard === "function") {
      window.gZenCommonActions.copyCurrentURLToClipboard();
      return;
    }
    Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(uri.displaySpec);
    try {
      window.gZenUIManager?.showToast?.("zen-copy-current-url-confirmation");
    } catch (err) {
      noteError("copy link: copyLink", err);
    }
  }

  // Copying pops the paperclip into a tick: the paperclip shrinks, tilts
  // and fades, then the tick springs in, running a touch past full size.
  // After a moment the tick pops back into the paperclip the same way.
  const POP_SPRING = "cubic-bezier(0.3, 1.4, 0.5, 1)";
  const COPIED_ICON = "chrome://sine/content/zia/icons/ui/check.svg";
  const COPY_ICON = "chrome://sine/content/zia/icons/ui/paperclip.svg";

  function popIcon(icon, toTick, swap) {
    icon?.ziaPop?.cancel();
    if (typeof icon?.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      swap();
      return;
    }
    const out = icon.animate(
      toTick
        ? [{ opacity: 1, scale: 1, rotate: "0deg" }, { opacity: 0, scale: 0.35, rotate: "-40deg" }]
        : [{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.5 }],
      { duration: 130, easing: "ease-in", fill: "forwards" }
    );
    icon.ziaPop = out;
    out.finished.then(
      () => {
        swap();
        icon.ziaPop = icon.animate(
          toTick
            ? [
                { opacity: 0, scale: 0.35, rotate: "25deg" },
                { opacity: 1, scale: 1.18, rotate: "0deg", offset: 0.6 },
                { opacity: 1, scale: 1, rotate: "0deg" },
              ]
            : [{ opacity: 0, scale: 0.5, rotate: "-20deg" }, { opacity: 1, scale: 1, rotate: "0deg" }],
          { duration: toTick ? 380 : 320, easing: POP_SPRING }
        );
        out.cancel();
      },
      () => {}
    );
  }

  // The icon is an <img> (hover card, split pane bar) or the address bar
  // button's <image>, whose picture comes from CSS on [zia-copied].
  function showCopiedIcon(button, icon) {
    const set = (copied) => () => {
      if (copied) {
        button.setAttribute("zia-copied", "true");
      } else {
        button.removeAttribute("zia-copied");
      }
      if (icon?.localName === "img") {
        icon.setAttribute("src", copied ? COPIED_ICON : COPY_ICON);
      }
    };
    popIcon(icon, true, set(true));
    clearTimeout(button.ziaCopiedTimer);
    button.ziaCopiedTimer = setTimeout(() => popIcon(icon, false, set(false)), 1200);
  }

  function showCopied(button) {
    showCopiedIcon(button, button.querySelector(button.localName === "button" ? "img" : "image"));
  }

  // The paperclip goes beside Zen's site settings button, which Zen adds
  // to the address bar itself, sometimes only after Zia has started (with
  // Zia just installed into an open window, say); until then Zia waits for
  // it, as Zen's own copy button is hidden for the paperclip (zia.css)
  function addCopyLinkButton() {
    if (document.getElementById("zia-copy-link-button")) {
      return;
    }
    const siteData = document.getElementById("zen-site-data-icon-button");
    if (!siteData) {
      const urlbar = document.getElementById("urlbar");
      if (!urlbar || addCopyLinkButton.waiting) {
        return;
      }
      addCopyLinkButton.waiting = new MutationObserver(() => {
        if (document.getElementById("zen-site-data-icon-button")) {
          addCopyLinkButton.waiting.disconnect();
          safely("addCopyLinkButton", addCopyLinkButton);
        }
      });
      addCopyLinkButton.waiting.observe(urlbar, { childList: true, subtree: true });
      return;
    }
    const button = document.createXULElement("hbox");
    button.id = "zia-copy-link-button";
    button.className = "urlbar-page-action";
    button.setAttribute("role", "button");
    button.setAttribute("tooltiptext", "Copy link");
    const icon = document.createXULElement("image");
    icon.className = "urlbar-icon";
    button.appendChild(icon);
    button.addEventListener("click", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      try {
        copyLink(gBrowser.selectedTab);
        showCopied(button);
      } catch (err) {
        console.error("[Zia] Copy link failed:", err);
      }
    });
    siteData.before(button);
    const update = () => {
      const uri = gBrowser.selectedBrowser?.currentURI;
      button.hidden = !uri || !/^https?$/.test(uri.scheme);
    };

    // As faint as the site settings icon beside it (a fixed see-through
    // level); its colour follows the toolbar in CSS.
    const siteIcon = siteData.querySelector("image");
    if (siteIcon) {
      const style = getComputedStyle(siteIcon);
      icon.style.fillOpacity = style.fillOpacity;
      icon.style.opacity = style.opacity;
    }
    gBrowser.tabContainer.addEventListener("TabSelect", update);
    gBrowser.addProgressListener({
      onLocationChange: (progress) => {
        if (progress.isTopLevel) {
          update();
        }
      },
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
    });
    update();
  }
  function lastUsedOtherTab(tab) {
    let best = null;
    for (const other of gBrowser.visibleTabs) {
      if (other === tab || other.hasAttribute("zen-empty-tab") || other.hasAttribute("zen-essential") || other.closing) {
        continue;
      }
      if (!best || (other.lastAccessed || 0) > (best.lastAccessed || 0)) {
        best = other;
      }
    }
    return best;
  }

  const NEW_TAB_PAGES = new Set(["about:newtab", "about:home", "about:blank", "about:privatebrowsing"]);

  function tabCardKind(tab) {
    const uri = tab.linkedBrowser?.currentURI;
    const spec = uri?.spec || "";
    if (/^https?:/.test(spec)) {
      return "web";
    }
    if (!spec || NEW_TAB_PAGES.has(spec) || tab.hasAttribute("zen-empty-tab")) {
      return "new";
    }
    return "internal";
  }

  const INTERNAL_PAGE_NAMES = { preferences: "settings", addons: "extensions" };

  function tabCardDomain(tab) {
    try {
      const uri = tab.linkedBrowser?.currentURI;
      if (!uri || isMultiviewURI(uri)) {
        return "";
      }
      if (/^https?$/.test(uri.scheme)) {
        return uri.host.replace(/^www\./, "");
      }
      if (uri.scheme === "about") {
        const name = uri.filePath.split(/[?#]/)[0].toLowerCase();
        return INTERNAL_PAGE_NAMES[name] || name;
      }
      return "";
    } catch (err) {
      return "";
    }
  }

  function buildTabCard(onAction) {
    const card = document.createElementNS(XHTML_NS, "div");
    card.id = "zia-tab-card";
    card.hidden = true;
    const title = document.createElementNS(XHTML_NS, "div");
    title.className = "zia-tab-card-title";
    const sub = document.createElementNS(XHTML_NS, "div");
    sub.className = "zia-tab-card-sub";
    const row = document.createElementNS(XHTML_NS, "div");
    row.id = "zia-tab-card-actions";
    for (const action of TAB_CARD_ACTIONS) {
      const button = document.createElementNS(XHTML_NS, "button");
      button.className = "zia-tab-card-action";
      button.setAttribute("zia-action", action.name);
      button.title = action.label;

      const icon = document.createElementNS(XHTML_NS, "img");
      icon.setAttribute("src", `chrome://sine/content/zia/icons/ui/${action.icon}.svg`);
      icon.setAttribute("alt", "");
      button.appendChild(icon);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onAction(action);
      });
      row.appendChild(button);
    }
    card.append(title, sub, row);
    root.appendChild(card);
    return card;
  }

  function fillTabCard(card, tab) {
    const shown = tab;
    const isNew = tabCardKind(shown) === "new";
    card.querySelector(".zia-tab-card-title").textContent = shown.label || "New Tab";
    const sub = card.querySelector(".zia-tab-card-sub");
    sub.textContent = isNew ? "" : tabCardDomain(shown);
    sub.hidden = !sub.textContent;

    const row = card.querySelector("#zia-tab-card-actions");
    row.hidden = isNew;
    for (const button of row.children) {
      const action = TAB_CARD_ACTIONS.find((a) => a.name === button.getAttribute("zia-action"));
      button.hidden = !!action?.hidden?.(tab);
    }
  }

  function placeTabCard(card, tab) {
    const tile = tab.querySelector(":scope > .tab-stack > .tab-background");
    const tileBox = tile?.getBoundingClientRect();
    const tabBox = tileBox && tileBox.width > 0 && tileBox.height > 0 ? tileBox : tab.getBoundingClientRect();
    const sidebar = document.getElementById("navigator-toolbox")?.getBoundingClientRect() || tabBox;
    const onRight = root.getAttribute("zen-right-side") === "true";
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    let x;
    let y;
    let origin;
    if (tab.hasAttribute("zen-essential")) {
      card.setAttribute("zia-anchor", "essential");
      if (onRight) {
        card.setAttribute("zia-side", "right");
        x = tabBox.left - width + ESSENTIAL_CARD_OVERLAP_X;
        y = tabBox.bottom - ESSENTIAL_CARD_OVERLAP_Y;
        origin = "top right";
      } else {
        card.removeAttribute("zia-side");
        x = tabBox.right - ESSENTIAL_CARD_OVERLAP_X;
        y = tabBox.bottom - ESSENTIAL_CARD_OVERLAP_Y;
        origin = "top left";
      }
    } else {
      card.setAttribute("zia-anchor", "tab");
      card.removeAttribute("zia-side");
      x = onRight ? sidebar.left - width - TAB_CARD_GAP : sidebar.right + TAB_CARD_GAP;
      y = tabBox.top + tabBox.height / 2 - height / 2;
      origin = onRight ? "right center" : "left center";
    }
    x = Math.max(TAB_CARD_GAP, Math.min(x, window.innerWidth - width - TAB_CARD_GAP));
    y = Math.max(TAB_CARD_GAP, Math.min(y, window.innerHeight - height - TAB_CARD_GAP));
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(y)}px`;
    card.style.transformOrigin = origin;
  }

  function addTabHoverCards() {
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbox) {
      return;
    }
    let card = null;
    let current = null;
    let showTimer = 0;
    let hideTimer = 0;

    const CARD_OUT_MS = 120;
    let closeTimer = 0;
    const cardUp = () => [card].some((each) => each && !each.hidden && !each.hasAttribute("zia-closing"));
    const cardHovered = () => [card].some((each) => each && !each.hidden && each.matches(":hover"));

    // In compact mode the sidebar hides once the pointer leaves it, and the
    // cards sit outside it, so while the pointer is on a card Zia holds the
    // sidebar open the way Zen does while one of its own menus is open.
    // Leaving the card, the sidebar gets Zen's usual moment before it hides.
    let holding = false;
    const holdSidebar = (on) => {
      if (on === holding) {
        return;
      }
      if (on) {
        holding = !toolbox.hasAttribute("has-popup-menu");
        if (holding) {
          toolbox.setAttribute("has-popup-menu", "true");
        }
        return;
      }
      holding = false;
      toolbox.removeAttribute("has-popup-menu");
      try {
        const manager = window.gZenCompactModeManager;
        if (manager?.preference && !toolbox.matches(":hover")) {
          const keep = Services.prefs.getIntPref("zen.view.compact.sidebar-keep-hover.duration", 0);
          if (keep > 0) {
            manager.flashElement(toolbox, keep, `has-hover${toolbox.id}`, "zen-has-hover");
          }
        }
      } catch (err) {
        noteError("hover cards: release sidebar", err);
      }
    };

    const hide = (force = false) => {
      if (force !== true && cardHovered()) {
        return;
      }
      holdSidebar(false);
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      current = null;
      for (const each of [card]) {
        if (each && !each.hidden && !each.hasAttribute("zia-closing")) {
          each.removeAttribute("zia-snap");
          each.setAttribute("zia-closing", "true");
        }
      }
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        for (const each of [card]) {
          if (each?.hasAttribute("zia-closing")) {
            each.hidden = true;
            each.removeAttribute("zia-closing");
            each.removeAttribute("zia-open");
          }
        }
      }, CARD_OUT_MS);
    };

    const openCard = (shown, other, wasUp) => {
      clearTimeout(closeTimer);
      if (other) {
        other.hidden = true;
        other.removeAttribute("zia-open");
        other.removeAttribute("zia-closing");
      }
      shown.removeAttribute("zia-closing");
      shown.hidden = false;
      if (wasUp) {
        shown.setAttribute("zia-snap", "true");
        shown.setAttribute("zia-open", "true");
        return;
      }
      shown.removeAttribute("zia-snap");
      shown.removeAttribute("zia-open");
      void shown.offsetWidth;
      shown.setAttribute("zia-open", "true");
    };

    let keepCardUntil = 0;
    const hideSoon = () => {
      clearTimeout(hideTimer);
      const attempt = () => {
        const wait = keepCardUntil - Date.now();
        if (wait > 0) {
          hideTimer = setTimeout(attempt, wait);
          return;
        }
        hide();
      };
      hideTimer = setTimeout(attempt, TAB_CARD_GRACE);
    };
    const onCard = (node) => !!node && (card?.contains(node));

    const show = (tab) => {
      const wasUp = cardUp();
      if (!card) {
        card = buildTabCard((action) => {
          const tab = current;

          if (!action.keepsCard) {
            hide(true);
          } else {
            keepCardUntil = Date.now() + 1200;
            if (action.name === "copy") {
              const button = card.querySelector('[zia-action="copy"]');
              if (button) {
                showCopiedIcon(button, button.querySelector("img"));
              }
            }
          }
          if (!tab?.isConnected) {
            return;
          }
          try {
            Promise.resolve(action.run(tab)).catch((err) =>
              console.error(`[Zia] ${action.label} failed:`, err)
            );
          } catch (err) {
            console.error(`[Zia] ${action.label} failed:`, err);
          }
        });
        card.addEventListener("mouseenter", () => {
          clearTimeout(hideTimer);
          holdSidebar(true);
        });
        card.addEventListener("mouseleave", () => {
          holdSidebar(false);
          hideSoon();
        });
      }
      current = tab;
      fillTabCard(card, tab);
      card.hidden = false;
      placeTabCard(card, tab);
      openCard(card, null, wasUp);
    };

    toolbox.addEventListener("mouseover", (event) => {
      if (!featureOn("tab-hover-cards")) {
        return;
      }
      const tab = event.target?.closest?.(".tabbrowser-tab");
      if (!tab || tab.hasAttribute("pending-drag") || gBrowser.tabContainer.hasAttribute("movingtab")) {
        return;
      }
      clearTimeout(hideTimer);
      if (tab === current) {
        return;
      }
      clearTimeout(showTimer);
      if (current) {
        show(tab);
        return;
      }
      showTimer = setTimeout(() => {
        if (tab.isConnected && tab.matches(":hover")) {
          show(tab);
        }
      }, TAB_CARD_DELAY);
    });

    toolbox.addEventListener("mouseout", (event) => {
      const tab = event.target?.closest?.(".tabbrowser-tab");
      if (!tab) {
        return;
      }
      const to = event.relatedTarget;
      if (to && (tab.contains(to) || onCard(to))) {
        return;
      }
      clearTimeout(showTimer);
      hideSoon();
    });

    toolbox.addEventListener("mousedown", () => hide(), true);
    toolbox.addEventListener("dragstart", () => hide(true), true);
    toolbox.addEventListener("wheel", () => hide(), { passive: true, capture: true });
    for (const type of ["TabSelect", "TabClose"]) {
      gBrowser.tabContainer.addEventListener(type, () => {
        if ([card].some((each) => each && !each.hidden && each.matches(":hover"))) {
          return;
        }
        hide();
      });
    }
    window.addEventListener("blur", () => {
      if (Date.now() >= keepCardUntil) {
        hide();
      }
    });
  }
  function restoreNativeTabs() {
    // Arrow panels default to flipping on both axes. Zen centers this panel
    // with a negative Y offset; flipping that offset near the top places the
    // preview below its folder. Slide it within the screen instead.
    document.getElementById("zen-folder-tabs-popup")?.setAttribute("flip", "slide");

    // Undo only a haptics change explicitly marked by the previous drag code.
    if (Services.prefs.getBoolPref("zia.haptics.muted", false)) {
      Services.prefs.setBoolPref("zen.haptic-feedback.enabled", true);
      Services.prefs.clearUserPref("zia.haptics.muted");
    }
    const restore = () => {
      for (const tab of gBrowser.tabs) {
        for (const key of ["zia-split", "zia-split-of", "zia-split-side"]) {
          tab.removeAttribute(key);
          if (window.SessionStore?.getCustomTabValue(tab, key)) {
            window.SessionStore.deleteCustomTabValue(tab, key);
          }
        }
      }
    };
    if (window.SessionStore?.promiseAllWindowsRestored) {
      window.SessionStore.promiseAllWindowsRestored.then(restore, restore);
    } else {
      restore();
    }
  }

  // Zen's toasts (the little notes up in the corner, like "Copied") go away
  // on a timer that stops while the mouse is over them. Zia gives each one
  // a small ✕ to close it straight away, with the same fade Zen uses.
  function addToastCloseButtons() {
    const container = document.getElementById("zen-toast-container");
    if (!container) {
      return;
    }
    const close = (toast) => {
      toast.animate(
        [
          { opacity: 1, scale: 1 },
          { opacity: 0, scale: 0.5 },
        ],
        { duration: 200, easing: "ease-in", fill: "forwards" }
      ).finished.then(() => {
        toast.remove();
        if (!container.children.length) {
          container.setAttribute("hidden", "true");
        }
      });
    };
    const addTo = (toast) => {
      if (!toast.classList?.contains("zen-toast") || toast.querySelector(".zia-toast-close")) {
        return;
      }
      const button = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
      button.className = "zia-toast-close";
      button.title = "Close";
      button.setAttribute("aria-label", "Close");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        close(toast);
      });
      toast.append(button);
    };
    for (const toast of container.children) {
      addTo(toast);
    }
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          addTo(node);
        }
      }
    }).observe(container, { childList: true });
  }
  // A page glanced at from an essential shows as a small card fanned out from
  // behind the essential's icon (zia-essential-glance in chrome.css). It
  // springs out from the icon in CSS; closing, Zen takes the glance's tab away
  // at once, so a stand-in card is drawn in its place and sucked back into the
  // icon.
  function suckInEssentialGlances() {
    const SUCK_MS = 220;
    const OUT_MS = 400;
    const sprung = new WeakSet();

    // Out: once per glance. Zen restyles the tab more than once as it opens
    // it, which would replay a CSS animation, so it's played from here.
    const springOut = (tab) => {
      if (sprung.has(tab) || !tab.hasAttribute("zen-glance-tab") ||
          !tab.parentElement?.closest(".tabbrowser-tab[zen-essential]")) {
        return;
      }
      sprung.add(tab);
      tab.setAttribute("zia-glance-shown", "true");
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      tab.animate(
        [
          { translate: "-26px 0", scale: 0.12, rotate: "0deg", opacity: 0 },
          { opacity: 1, offset: 0.2 },
          { translate: "0 0", scale: 1, rotate: "6deg", opacity: 1 },
        ],
        { duration: OUT_MS, easing: "cubic-bezier(0.3, 1.4, 0.5, 1)" }
      );
    };
    new MutationObserver((records) => {
      for (const record of records) {
        springOut(record.target);
      }
    }).observe(gBrowser.tabContainer, { subtree: true, attributes: true, attributeFilter: ["zen-glance-tab"] });
    // any glance already open when Zia starts just shows
    for (const tab of gBrowser.tabContainer.querySelectorAll(".tabbrowser-tab[zen-glance-tab]")) {
      sprung.add(tab);
      tab.setAttribute("zia-glance-shown", "true");
    }

    gBrowser.tabContainer.addEventListener("GlanceClose", (event) => {
      const glanceTab = event.target;
      const content = glanceTab?.parentElement;
      const essential = content?.closest(".tabbrowser-tab[zen-essential]");
      if (!essential || !content.classList.contains("tab-content")) {
        return;
      }
      glanceTab.style.visibility = "hidden";
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      const ghost = document.createXULElement("hbox");
      ghost.className = "zia-glance-ghost";
      const icon = document.createXULElement("image");
      icon.className = "zia-glance-ghost-icon";
      const src = glanceTab.querySelector(".tab-icon-image")?.getAttribute("src");
      if (src) {
        icon.setAttribute("src", src);
      }
      ghost.append(icon);
      content.append(ghost);
      const easing = "cubic-bezier(0.55, 0, 0.8, 0.2)";
      ghost.animate(
        [
          { translate: "0 0", scale: 1, rotate: "6deg" },
          { translate: "-26px 0", scale: 0.12, rotate: "0deg" },
        ],
        { duration: SUCK_MS, easing, fill: "forwards" }
      );
      ghost
        .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, delay: SUCK_MS - 100, fill: "forwards" })
        .finished.catch(() => {})
        .then(() => ghost.remove());
    });
  }


  // Extension icons: right-click an extension's button (in the toolbar or
  // the extensions panel) to give it an icon of your own, an SVG from your
  // computer or one of Zia's icons. An SVG takes the toolbar's colour, as
  // Zia's own icons do, unless it keeps its own colours. Extensions that
  // change their icon themselves (on or off, per site) are noted, since a
  // custom icon hides that.
  const EXT_ICONS_PREF = "zia.extensionIcons";
  const EXT_CHANGING_PREF = "zia.extensionIcons.changing";
  const EXT_SVG_MAX = 300 * 1024;
  let extIcons = null;
  let extChanging = null;
  let extSheet = null;

  function readJSONPref(name, fallback) {
    try {
      return JSON.parse(Services.prefs.getStringPref(name, "")) || fallback;
    } catch (err) {
      return fallback;
    }
  }

  function extIconMap() {
    if (!extIcons) {
      extIcons = readJSONPref(EXT_ICONS_PREF, {});
    }
    return extIcons;
  }

  function saveExtIcons() {
    try {
      Services.prefs.setStringPref(EXT_ICONS_PREF, JSON.stringify(extIconMap()));
    } catch (err) {
      noteError("extension icons: save", err);
    }
  }

  function changingSet() {
    if (!extChanging) {
      extChanging = new Set(readJSONPref(EXT_CHANGING_PREF, []));
    }
    return extChanging;
  }

  function extIconsDir() {
    return PathUtils.join(PathUtils.profileDir, "zia-icons", "extensions");
  }

  // Uploaded icons are read through resource://, like Zia's own: Firefox
  // only lets an SVG take the toolbar's colour from there, not from a file
  const EXT_ICON_HOST = "zia-extension-icons";
  function pointAtExtIcons() {
    const handler = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    const dir = Services.io.newURI(`${PathUtils.toFileURI(extIconsDir())}/`);
    if (!handler.hasSubstitution(EXT_ICON_HOST) || handler.getSubstitution(EXT_ICON_HOST).spec !== dir.spec) {
      handler.setSubstitution(EXT_ICON_HOST, dir);
    }
  }

  function extIconUrl(entry) {
    if (!entry.uploaded) {
      return entry.url;
    }
    const name = entry.own ? entry.file : entry.tinted || entry.file;
    return name ? `resource://${EXT_ICON_HOST}/${encodeURIComponent(name)}` : "";
  }

  // The custom icons as one stylesheet: each overrides the image Firefox
  // gives the button (in the toolbar and the panel, light and dark)
  function applyExtIcons() {
    const rules = [];
    for (const [id, entry] of Object.entries(extIconMap())) {
      const url = extIconUrl(entry);
      if (!url) {
        continue;
      }
      const selector = `.webextension-browser-action[data-extensionid="${id.replace(/["\\]/g, "\\$&")}"]`;
      const image = `url("${url.replace(/["\\]/g, "\\$&")}")`;
      rules.push(`${selector} {
        --webextension-toolbar-image: ${image} !important;
        --webextension-toolbar-image-dark: ${image} !important;
        --webextension-menupanel-image: ${image} !important;
        --webextension-menupanel-image-dark: ${image} !important;
      }`);
      if (!entry.own) {
        rules.push(`${selector}, ${selector} .toolbarbutton-icon {
          -moz-context-properties: fill, fill-opacity, stroke, stroke-opacity !important;
          fill: var(--zia-toolbar-ink, var(--toolbarbutton-icon-fill, currentColor)) !important;
          stroke: var(--zia-toolbar-ink, var(--toolbarbutton-icon-fill, currentColor)) !important;
          fill-opacity: 1 !important;
          stroke-opacity: 1 !important;
        }`);
      }
    }
    const utils = window.windowUtils;
    if (extSheet) {
      try {
        utils.removeSheetUsingURIString(extSheet, utils.AUTHOR_SHEET);
      } catch (err) {
        noteError("extension icons: remove sheet", err);
      }
      extSheet = null;
    }
    extSheet = `data:text/css;charset=utf-8,${encodeURIComponent(rules.join("\n"))}`;
    try {
      utils.loadSheetUsingURIString(extSheet, utils.AUTHOR_SHEET);
    } catch (err) {
      noteError("extension icons: load sheet", err);
    }
  }

  // Only the drawing is kept: no scripts, links out, embedded pages or
  // pictures, or event handlers
  function cleanSvg(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.documentElement;
    if (!svg || svg.localName !== "svg" || doc.getElementsByTagName("parsererror").length) {
      return null;
    }
    for (const el of [...svg.querySelectorAll("script, foreignObject, iframe, object, embed, audio, video, image, feImage")]) {
      el.remove();
    }
    const outside = /url\(\s*['"]?\s*(?!#)/i;
    for (const el of [svg, ...svg.querySelectorAll("*")]) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith("on") || ((name === "href" || name === "xlink:href") && !value.startsWith("#")) || outside.test(value)) {
          el.removeAttribute(attr.name);
        }
      }
    }
    for (const style of svg.querySelectorAll("style")) {
      style.textContent = style.textContent.replace(/@import[^;]*;?/gi, "").replace(/url\(\s*['"]?\s*(?!#)[^)]*\)/gi, "none");
    }
    if (!svg.hasAttribute("viewBox")) {
      const width = parseFloat(svg.getAttribute("width"));
      const height = parseFloat(svg.getAttribute("height"));
      if (width > 0 && height > 0) {
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      }
    }
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    return svg;
  }

  // Its colours become the toolbar's (what Zia's own icons use)
  function tintSvg(svg) {
    const copy = svg.cloneNode(true);
    const keep = /^(none|transparent)$/i;
    for (const el of [copy, ...copy.querySelectorAll("*")]) {
      for (const prop of ["fill", "stroke"]) {
        const value = el.getAttribute(prop);
        if (value && !keep.test(value.trim())) {
          el.setAttribute(prop, "context-fill");
        }
      }
      const inline = el.getAttribute("style");
      if (inline) {
        el.setAttribute("style", inline.replace(/(^|;)\s*(fill|stroke)\s*:\s*(?!none|transparent)[^;]+/gi, "$1$2: context-fill"));
      }
    }
    for (const style of copy.querySelectorAll("style")) {
      style.textContent = style.textContent.replace(/\b(fill|stroke)\s*:\s*(?!none|transparent)[^;}]+/gi, "$1: context-fill");
    }
    if (!copy.hasAttribute("fill")) {
      copy.setAttribute("fill", "context-fill");
    }
    return copy;
  }

  async function removeExtIconFiles(entry) {
    if (!entry?.uploaded) {
      return;
    }
    for (const name of [entry.file, entry.tinted]) {
      if (name && !/[\\/]/.test(name)) {
        try {
          await IOUtils.remove(PathUtils.join(extIconsDir(), name), { ignoreAbsent: true });
        } catch (err) {
          noteError("extension icons: remove file", err);
        }
      }
    }
  }

  async function setExtIcon(id, entry) {
    const old = extIconMap()[id];
    if (entry) {
      extIconMap()[id] = entry;
    } else {
      delete extIconMap()[id];
    }
    saveExtIcons();
    applyExtIcons();
    if (old && old.file !== entry?.file) {
      await removeExtIconFiles(old);
    }
  }

  // A custom icon hides an extension's own changes to its icon: said first
  function okToCover(id) {
    if (!changingSet().has(id)) {
      return true;
    }
    const prompts = Services.prompt;
    const pressed = prompts.confirmEx(
      window,
      "This extension changes its own icon",
      "It uses its icon to show what it's doing (on or off, or something for the site you're on). A custom icon will hide that.",
      prompts.BUTTON_POS_0 * prompts.BUTTON_TITLE_IS_STRING + prompts.BUTTON_POS_1 * prompts.BUTTON_TITLE_CANCEL + prompts.BUTTON_POS_1_DEFAULT,
      "Use it anyway",
      null,
      null,
      null,
      {}
    );
    return pressed === 0;
  }

  // Asks for an SVG and cleans it: null when cancelled or unusable (said)
  function askForSvg(then) {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(window.browsingContext, "Choose an SVG icon", Ci.nsIFilePicker.modeOpen);
    picker.appendFilter("SVG images", "*.svg");
    picker.open(async (result) => {
      if (result !== Ci.nsIFilePicker.returnOK || !picker.file) {
        then(null);
        return;
      }
      try {
        const path = picker.file.path;
        if (!/\.svg$/i.test(path)) {
          Services.prompt.alert(window, "Only SVG icons", "Choose an .svg file: it can take the toolbar's colour, as Zia's own icons do.");
          then(null);
          return;
        }
        const info = await IOUtils.stat(path);
        if (info.size > EXT_SVG_MAX) {
          Services.prompt.alert(window, "That SVG is too big", "Icons need to be under 300 KB.");
          then(null);
          return;
        }
        const svg = cleanSvg(await IOUtils.readUTF8(path));
        if (!svg) {
          Services.prompt.alert(window, "That isn't an SVG Zia can read", "Choose another .svg file.");
        }
        then(svg);
      } catch (err) {
        console.error("[Zia] Could not use that icon:", err);
        then(null);
      }
    });
  }

  // Writes the SVG as it is and tinted, returning the two file names
  async function saveSvgIcon(dir, base, svg) {
    const serialize = (node) => new XMLSerializer().serializeToString(node);
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    await IOUtils.writeUTF8(PathUtils.join(dir, `${base}.svg`), serialize(svg));
    await IOUtils.writeUTF8(PathUtils.join(dir, `${base}.tinted.svg`), serialize(tintSvg(svg)));
    return { file: `${base}.svg`, tinted: `${base}.tinted.svg` };
  }

  function chooseExtSvg(id) {
    if (!okToCover(id)) {
      return;
    }
    askForSvg(async (svg) => {
      if (!svg) {
        return;
      }
      try {
        const names = await saveSvgIcon(extIconsDir(), `${id.replace(/[^\w.-]+/g, "_")}-${Date.now()}`, svg);
        pointAtExtIcons();
        await setExtIcon(id, { ...names, own: !!extIconMap()[id]?.own, uploaded: true });
      } catch (err) {
        console.error("[Zia] Could not use that icon:", err);
      }
    });
  }

  // Your own SVGs for folders and spaces (their menus' Change icon):
  // kept in the profile and read, tinted like Zia's icons, through
  // resource://, pointed at as this script loads, since Zen draws folder
  // and space icons as it restores them, before the rest of Zia starts.
  const OWN_ICON_HOST = "zia-own-icons";
  function ownIconsDir() {
    return PathUtils.join(PathUtils.profileDir, "zia-icons", "own");
  }
  function pointAtOwnIcons() {
    const handler = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    const dir = Services.io.newURI(`${PathUtils.toFileURI(ownIconsDir())}/`);
    if (!handler.hasSubstitution(OWN_ICON_HOST) || handler.getSubstitution(OWN_ICON_HOST).spec !== dir.spec) {
      handler.setSubstitution(OWN_ICON_HOST, dir);
    }
  }
  try {
    pointAtOwnIcons();
  } catch (err) {
    noteError("own icons: early", err);
  }

  // Asks for an SVG and gives its (tinted) address, or null
  function chooseOwnSvg() {
    return new Promise((resolve) => {
      askForSvg(async (svg) => {
        if (!svg) {
          resolve(null);
          return;
        }
        try {
          const { tinted } = await saveSvgIcon(ownIconsDir(), `icon-${Date.now()}`, svg);
          pointAtOwnIcons();
          resolve(`resource://${OWN_ICON_HOST}/${encodeURIComponent(tinted)}`);
        } catch (err) {
          console.error("[Zia] Could not use that icon:", err);
          resolve(null);
        }
      });
    });
  }

  function pickExtIcon(id, anchor) {
    const icons = window.gZenEmojiPicker;
    if (!icons?.open || !okToCover(id)) {
      return;
    }
    // Opened from the extensions menu, the picker hangs off its toolbar
    // button instead: the menu closes when the picker is clicked, and the
    // picker would close with it.
    const inMenu = anchor?.closest?.("panel, menupopup");
    const shown = anchor?.isConnected && !inMenu && anchor.getBoundingClientRect().width > 0;
    const at = shown ? anchor : document.getElementById("unified-extensions-button") || document.getElementById("nav-bar");
    // The picker stays open, and each icon clicked goes on the button
    // straight away; the bin puts the extension's own icon back
    const onSelect = (url) => {
      if (url === null) {
        setExtIcon(id, null);
      } else if (typeof url === "string" && /^(chrome|resource):/.test(url)) {
        setExtIcon(id, { url, own: false, uploaded: false });
      }
    };
    try {
      Promise.resolve(icons.open(at, { onlySvgIcons: true, allowNone: !!extIconMap()[id], closeOnSelect: false, onSelect })).catch(() => {});
    } catch (err) {
      noteError("extension icons: open the picker", err);
    }
  }

  // Which extensions change their icon: seen when the image Firefox gives
  // the button changes after it's first drawn
  const watchedExtButtons = new WeakSet();
  function extImageOf(button) {
    return (button.getAttribute("style") || "").match(/--webextension-toolbar-image:\s*([^;]+);/)?.[1]?.trim() || "";
  }
  function watchExtButtons() {
    for (const button of document.querySelectorAll(".webextension-browser-action[data-extensionid]")) {
      if (watchedExtButtons.has(button)) {
        continue;
      }
      watchedExtButtons.add(button);
      let first = extImageOf(button);
      new MutationObserver(() => {
        const now = extImageOf(button);
        if (!now || now === first) {
          return;
        }
        if (!first) {
          first = now;
          return;
        }
        const id = button.getAttribute("data-extensionid");
        if (id && !changingSet().has(id)) {
          changingSet().add(id);
          try {
            Services.prefs.setStringPref(EXT_CHANGING_PREF, JSON.stringify([...changingSet()]));
          } catch (err) {
            noteError("extension icons: note a change", err);
          }
        }
      }).observe(button, { attributes: true, attributeFilter: ["style"] });
    }
  }

  function addExtIconMenus() {
    for (const menuId of ["toolbar-context-menu", "unified-extensions-context-menu"]) {
      const menu = document.getElementById(menuId);
      if (!menu || menu.querySelector(".zia-ext-icon-menu")) {
        continue;
      }
      const separator = document.createXULElement("menuseparator");
      separator.className = "zia-ext-icon-separator";
      const item = document.createXULElement("menu");
      item.className = "zia-ext-icon-menu";
      item.setAttribute("label", "Change icon");
      const popup = document.createXULElement("menupopup");
      const note = document.createXULElement("menuitem");
      note.setAttribute("label", "This extension changes its own icon");
      note.setAttribute("disabled", "true");
      note.className = "zia-ext-icon-note";
      const noteSeparator = document.createXULElement("menuseparator");
      const upload = document.createXULElement("menuitem");
      upload.setAttribute("label", "Choose an SVG…");
      const choose = document.createXULElement("menuitem");
      choose.setAttribute("label", "Pick from Zia's icons…");
      const keepSeparator = document.createXULElement("menuseparator");
      const keep = document.createXULElement("menuitem");
      keep.setAttribute("type", "checkbox");
      keep.setAttribute("label", "Keep the SVG's own colours");
      const reset = document.createXULElement("menuitem");
      reset.setAttribute("label", "Reset to the original icon");
      popup.append(note, noteSeparator, upload, choose, keepSeparator, keep, reset);
      item.append(popup);
      menu.append(separator, item);

      let target = null;
      menu.addEventListener("popupshowing", (event) => {
        if (event.target !== menu) {
          return;
        }
        target = menu.triggerNode?.closest?.("[data-extensionid]") || null;
        const id = target?.getAttribute("data-extensionid");
        const show = !!id;
        item.hidden = separator.hidden = !show;
        if (!show) {
          return;
        }
        watchExtButtons();
        const entry = extIconMap()[id];
        const changes = changingSet().has(id);
        note.hidden = noteSeparator.hidden = !changes;
        keep.hidden = !entry?.uploaded;
        keep.setAttribute("checked", String(!!entry?.own));
        reset.disabled = !entry;
      });
      const idOf = () => target?.getAttribute("data-extensionid");
      const buttonOf = () => (target?.matches?.(".webextension-browser-action") ? target : target?.querySelector?.(".webextension-browser-action")) || target;
      upload.addEventListener("command", () => idOf() && chooseExtSvg(idOf()));
      choose.addEventListener("command", () => idOf() && pickExtIcon(idOf(), buttonOf()));
      keep.addEventListener("command", () => {
        const id = idOf();
        const entry = id && extIconMap()[id];
        if (entry) {
          setExtIcon(id, { ...entry, own: keep.getAttribute("checked") === "true" });
        }
      });
      reset.addEventListener("command", () => idOf() && setExtIcon(idOf(), null));
    }
  }

  function watchExtensionIcons() {
    try {
      pointAtExtIcons();
    } catch (err) {
      noteError("extension icons: point at folder", err);
    }
    applyExtIcons();
    addExtIconMenus();
    try {
      addOwnIconMenus();
    } catch (err) {
      noteError("own icons: menus", err);
    }
    watchExtButtons();
    try {
      CustomizableUI.addListener({
        onWidgetAfterDOMChange: () => watchExtButtons(),
        onWidgetAdded: () => requestAnimationFrame(watchExtButtons),
        onWidgetCreated: () => requestAnimationFrame(watchExtButtons),
      });
    } catch (err) {
      noteError("extension icons: listen", err);
    }
    document.getElementById("unified-extensions-panel")?.addEventListener("popupshowing", watchExtButtons);
    setTimeout(watchExtButtons, 3000);
  }

  // Spaces: Zen's "Change icon" becomes a menu like the
  // extensions' one, with your own SVG, Zia's icons (Zen's picker), your
  // SVG's own colours, and taking the icon off. Zen's own item stays,
  // hidden, as the way to its picker.
  const OWN_ICON_PREFIX = `resource://${OWN_ICON_HOST}/`;
  const isOwnIcon = (url) => typeof url === "string" && url.startsWith(OWN_ICON_PREFIX);
  const ownColoursOf = (url) => isOwnIcon(url) && !/\.tinted\.svg$/.test(url);

  function iconTargets() {
    return {
      space: {
        menuId: "zenWorkspaceMoreActions",
        itemId: "context_zenEditWorkspaceIcon",
        find(menu) {
          const node = menu.triggerNode;
          const id = node?.closest?.("toolbarbutton[zen-workspace-id]")?.getAttribute("zen-workspace-id") || gZenWorkspaces.activeWorkspace;
          return gZenWorkspaces.getWorkspaceFromId(id) ? id : null;
        },
        icon: (id) => gZenWorkspaces.getWorkspaceFromId(id)?.icon || null,
        async set(id, url) {
          const space = gZenWorkspaces.getWorkspaceFromId(id);
          if (space) {
            space.icon = url;
            await gZenWorkspaces.saveWorkspace(space);
          }
        },
        pick: () => gZenWorkspaces.changeWorkspaceIcon(),
      },
    };
  }

  function addOwnIconMenus() {
    for (const target of Object.values(iconTargets())) {
      const menu = document.getElementById(target.menuId);
      const zens = document.getElementById(target.itemId);
      if (!menu || !zens || menu.querySelector(".zia-own-icon-menu")) {
        continue;
      }
      const item = document.createXULElement("menu");
      item.className = "zia-own-icon-menu";
      item.setAttribute("label", "Change icon");
      const popup = document.createXULElement("menupopup");
      const upload = document.createXULElement("menuitem");
      upload.setAttribute("label", "Choose an SVG…");
      const choose = document.createXULElement("menuitem");
      choose.setAttribute("label", "Pick from Zia's icons…");
      const keepSeparator = document.createXULElement("menuseparator");
      const keep = document.createXULElement("menuitem");
      keep.setAttribute("type", "checkbox");
      keep.setAttribute("label", "Keep the SVG's own colours");
      const remove = document.createXULElement("menuitem");
      remove.setAttribute("label", "Remove icon");
      popup.append(upload, choose, keepSeparator, keep, remove);
      item.append(popup);
      zens.before(item);

      let subject = null;
      menu.addEventListener("popupshowing", (event) => {
        if (event.target !== menu) {
          return;
        }
        subject = null;
        try {
          subject = target.find(menu);
        } catch (err) {
          noteError("own icons: find", err);
        }
        // Zen's item stays hidden either way: ours takes its place
        zens.hidden = true;
        item.hidden = !subject;
        if (!subject) {
          zens.hidden = false;
          return;
        }
        const icon = target.icon(subject);
        keep.hidden = !isOwnIcon(icon);
        keep.setAttribute("checked", String(ownColoursOf(icon)));
        remove.disabled = !icon;
      });
      const run = (what) => async () => {
        const at = subject;
        if (at === null) {
          return;
        }
        try {
          await what(at);
        } catch (err) {
          console.error("[Zia] Could not change the icon:", err);
        }
      };
      upload.addEventListener("command", run(async (at) => {
        const url = await chooseOwnSvg();
        if (url) {
          await target.set(at, url);
        }
      }));
      choose.addEventListener("command", run((at) => target.pick(at)));
      keep.addEventListener("command", run(async (at) => {
        const icon = target.icon(at);
        if (!isOwnIcon(icon)) {
          return;
        }
        const own = keep.getAttribute("checked") === "true";
        const url = own ? icon.replace(/\.tinted\.svg$/, ".svg") : icon.replace(/(?<!\.tinted)\.svg$/, ".tinted.svg");
        await target.set(at, url);
      }));
      remove.addEventListener("command", run((at) => target.set(at, null)));
    }
  }

  // Tab numbers: hold Cmd (Ctrl on Windows and Linux) and a small key shows
  // at the end of each tab, and in the corner of each essential. Every tab
  // you can see has one, essentials first, and Zia takes over Cmd/Ctrl+
  // digit so each is reachable: Firefox's own shortcuts stop at 8 (9 is the
  // last tab). Typing a number lights its key up (in Zia blue or the
  // space's colour) and the tab is only chosen when the key is let go, so
  // nothing loads by accident; past nine, type the digits in turn (1 then 2
  // for the twelfth). Another key, or letting go with nothing typed,
  // changes nothing. The keys show the moment it goes down and stay until
  // it's let go or the window is left. Optionally they show all the time.
  const TAB_NUMBERS_ALWAYS_PREF = "zia.tab-numbers.always";
  const TAB_NUMBERS_COLOR_PREF = "zia.tab-numbers.color";

  // The tabs the keys go to, in order: what's on screen, in the tab strip's
  // order (a tab inside a closed folder is skipped)
  function numberableTabs() {
    return (gBrowser.visibleTabs || []).filter((tab) => {
      try {
        return tab.checkVisibility ? tab.checkVisibility() : tab.getBoundingClientRect().height > 0;
      } catch (err) {
        return true;
      }
    });
  }

  function keyOf(tab) {
    return tab.querySelector(":scope > .tab-stack > .tab-content > .zia-tab-number");
  }

  function numberTabs() {
    const tabs = numberableTabs();
    const numbers = new Map(tabs.map((tab, i) => [tab, i + 1]));
    for (const tab of gBrowser.tabs) {
      const number = numbers.get(tab);
      let key = keyOf(tab);
      if (!number) {
        key?.remove();
        continue;
      }
      if (!key) {
        key = document.createElementNS(HTML_NS, "span");
        key.className = "zia-tab-number";
        key.setAttribute("aria-hidden", "true");
        tab.querySelector(":scope > .tab-stack > .tab-content")?.append(key);
      }
      // the digits in a box of their own, trimmed to their height, so the
      // key can centre them exactly (zia.css)
      if (key.textContent !== String(number)) {
        const digits = document.createElementNS(HTML_NS, "span");
        digits.textContent = String(number);
        key.replaceChildren(digits);
      }
      // one digit keeps its key square; two widen it
      key.toggleAttribute("zia-wide", number > 9);
    }
    return tabs;
  }

  const TAB_NUMBERS_LEAVE_MS = 110;

  function watchTabNumbers() {
    const mac = AppConstants.platform === "macosx";
    const isModKey = (event) => event.key === (mac ? "Meta" : "Control");
    const modHeld = (event) =>
      (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey && !event.shiftKey;

    let tabs = [];
    let typed = "";
    let lastDigit = null;

    // The key of the tab typed so far lights up
    const markTarget = () => {
      tabs.forEach((tab, i) => keyOf(tab)?.toggleAttribute("zia-target", !!typed && Number(typed) === i + 1));
    };

    // Letting go, the keys slide back off to the right the way they came
    let leaving = null;
    const show = () => {
      clearTimeout(leaving);
      setFlag("zia-tab-numbers-leaving", false);
      tabs = numberTabs();
      setFlag("zia-tab-numbers", true);
    };
    const hide = () => {
      typed = "";
      markTarget();
      if (root.hasAttribute("zia-tab-numbers") && !Services.prefs.getBoolPref(TAB_NUMBERS_ALWAYS_PREF, false)) {
        setFlag("zia-tab-numbers-leaving", true);
        clearTimeout(leaving);
        leaving = setTimeout(() => setFlag("zia-tab-numbers-leaving", false), TAB_NUMBERS_LEAVE_MS);
      }
      setFlag("zia-tab-numbers", false);
    };
    // Letting go: the tab typed, if any
    const commit = () => {
      const tab = typed ? tabs[Number(typed) - 1] : null;
      hide();
      if (tab?.isConnected) {
        gBrowser.selectedTab = tab;
      }
    };
    const startsANumber = (prefix) => {
      for (let n = 1; n <= tabs.length; n++) {
        if (String(n).startsWith(prefix)) {
          return true;
        }
      }
      return false;
    };

    const onDigit = (digit) => {
      if (!root.hasAttribute("zia-tab-numbers")) {
        show();
      }
      // Carries on from the digits before if together they still name a
      // tab; otherwise starts again from this one
      const next = typed + digit;
      typed = startsANumber(next) ? next : startsANumber(digit) ? digit : "";
      markTarget();
    };

    // Seen both ways: keys pressed in a page reach the window only
    // afterwards, in the system group. A digit is handled once, but held
    // back from Firefox's own shortcut both times.
    for (const options of [{ capture: true }, { capture: true, mozSystemGroup: true }]) {
      window.addEventListener(
        "keydown",
        (event) => {
          if (isModKey(event)) {
            if (!event.repeat && !root.hasAttribute("zia-tab-numbers")) {
              show();
            }
            return;
          }
          const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1];
          if (digit !== undefined && modHeld(event)) {
            event.preventDefault();
            event.stopPropagation();
            const stamp = `${event.timeStamp}:${event.code}`;
            if (stamp !== lastDigit && !event.repeat) {
              lastDigit = stamp;
              onDigit(digit);
            }
          } else if (root.hasAttribute("zia-tab-numbers")) {
            // Any other shortcut (Cmd+W, Cmd+T…) or key: the keys go, and
            // nothing is chosen. Closing a tab can lose the letting go of
            // Cmd, which would otherwise leave them up.
            hide();
          }
        },
        options
      );
      window.addEventListener(
        "keyup",
        (event) => {
          if (isModKey(event)) {
            commit();
          }
        },
        options
      );
    }
    // Should the letting go of Cmd still be missed, the next key or move
    // of the mouse without it held puts the keys away
    const heldStill = (event) => (mac ? event.metaKey : event.ctrlKey);
    for (const type of ["mousemove", "mousedown", "wheel", "keyup"]) {
      window.addEventListener(
        type,
        (event) => {
          if (root.hasAttribute("zia-tab-numbers") && !heldStill(event) && !isModKey(event)) {
            hide();
          }
        },
        { capture: true, passive: true }
      );
    }
    // Only when the window itself is left: focus moving into the page just
    // chosen reads as a blur too, with the key still held
    window.addEventListener("blur", (event) => {
      if (event.target !== window) {
        return;
      }
      setTimeout(() => {
        if (Services.focus.activeWindow !== window) {
          hide();
        }
      }, 0);
    });
    document.addEventListener("visibilitychange", () => document.hidden && hide());

    // Kept up to date as tabs come and go, for when they show all the time
    let queued = false;
    const renumber = () => {
      if (queued || !(root.hasAttribute("zia-tab-numbers") || Services.prefs.getBoolPref(TAB_NUMBERS_ALWAYS_PREF, false))) {
        return;
      }
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        tabs = numberTabs();
      });
    };
    // TabSelect too: the newly selected tab can be redrawn, losing its key
    for (const type of ["TabSelect", "TabOpen", "TabClose", "TabMove", "TabShow", "TabHide", "TabPinned", "TabUnpinned", "TabGrouped", "TabUngrouped", "TabGroupExpand", "TabGroupCollapse"]) {
      gBrowser.tabContainer.addEventListener(type, renumber);
    }
    window.addEventListener("ZenWorkspacesUIUpdate", renumber);
    window.addEventListener("ZenWorkspaceChanged", renumber);
    Services.prefs.addObserver(TAB_NUMBERS_ALWAYS_PREF, renumber);

    // Zia blue or the space's colour for the number being typed
    const showColor = () => {
      const space = Services.prefs.getStringPref(TAB_NUMBERS_COLOR_PREF, "zia") === "space";
      if (space) {
        root.setAttribute("zia-tab-number-color", "space");
      } else {
        root.removeAttribute("zia-tab-number-color");
      }
    };
    showColor();
    Services.prefs.addObserver(TAB_NUMBERS_COLOR_PREF, showColor);
    renumber();
  }

  // The welcome tour (welcome/index.html): shown once on a first install,
  // and once after a release that has something to show, over a blurred
  // window. WELCOME_VERSION is the release that last asked for it: bump it
  // with that release ("release + welcome card"), and anyone who hasn't
  // seen that one gets the tour of what's new. Other releases leave it be.
  // Once closed it stays closed; it can be switched off after updates, or
  // asked for again, from Zia's settings.
  const WELCOME_VERSION = "2.83.0";
  const WELCOME_SEEN_PREF = "zia.welcome.seen";
  const WELCOME_UPDATES_PREF = "zia.welcome.show";
  const WELCOME_AGAIN_PREF = "zia.welcome.again";
  const WHATS_NEW_AGAIN_PREF = "zia.welcome.whats-new-again";
  const WELCOME_URL = "chrome://sine/content/zia/welcome/index.html";

  function showWelcome(mode) {
    if (document.getElementById("zia-welcome")) {
      return;
    }
    const overlay = document.createElementNS(HTML_NS, "div");
    overlay.id = "zia-welcome";
    // In the top layer, as pop-ups are: above the toolbar and address bar,
    // which sit over anything else in the window
    overlay.setAttribute("popover", "manual");
    const frame = document.createElementNS(HTML_NS, "iframe");
    frame.setAttribute("src", `${WELCOME_URL}#${mode === "update" ? `update-${WELCOME_VERSION}` : mode}`);
    frame.setAttribute("title", "Welcome to Zia");
    overlay.append(frame);

    const close = () => {
      if (!overlay.isConnected || overlay.hasAttribute("closing")) {
        return;
      }
      overlay.setAttribute("closing", "");
      setTimeout(() => {
        try {
          overlay.hidePopover?.();
        } catch (err) {}
        overlay.remove();
      }, 260);
      gBrowser.selectedBrowser?.focus();
    };
    // The page tells Zia what to do three ways (it runs apart from the
    // window, so functions handed to it don't reach it): an event on its
    // document, a message to this window, and a mark on the page, looked
    // for every quarter second. The first to arrive counts.
    let acted = false;
    const act = (text) => {
      if (acted) {
        return;
      }
      let message = {};
      try {
        message = JSON.parse(String(text));
      } catch (err) {
        return;
      }
      // Star on GitHub: a tab in this window, and the tour is done
      if (message.action === "open" && /^https:\/\/github\.com\/z1n-k\/zia\/?$/.test(message.url || "")) {
        gBrowser.selectedTab = gBrowser.addTrustedTab(message.url);
      }
      if (message.action === "open" || message.action === "done") {
        acted = true;
        close();
      }
    };
    const onMessage = (event) => {
      if (event.source === frame.contentWindow && typeof event.data?.ziaWelcome === "string") {
        act(event.data.ziaWelcome);
      }
    };
    window.addEventListener("message", onMessage);
    const watch = setInterval(() => {
      if (!overlay.isConnected) {
        clearInterval(watch);
        window.removeEventListener("message", onMessage);
        return;
      }
      try {
        const mark = frame.contentDocument?.documentElement?.getAttribute("data-zia-welcome");
        if (mark) {
          frame.contentDocument.documentElement.removeAttribute("data-zia-welcome");
          act(mark);
        }
      } catch (err) {
        noteError("welcome: look", err);
      }
    }, 250);
    frame.addEventListener("load", () => {
      try {
        frame.contentDocument?.addEventListener("ZiaWelcome", (event) => act(event.detail));
        frame.contentWindow?.focus();
      } catch (err) {
        noteError("welcome: hook", err);
      }
    });
    document.documentElement.appendChild(overlay);
    try {
      overlay.showPopover();
    } catch (err) {
      noteError("welcome: top layer", err);
    }
    requestAnimationFrame(() => overlay.setAttribute("shown", ""));
  }

  function watchWelcome() {
    const seen = Services.prefs.getStringPref(WELCOME_SEEN_PREF, "");
    if (seen !== WELCOME_VERSION) {
      const firstTime = !seen;
      // Marked seen straight away, so a second window opening now doesn't
      // show it too
      Services.prefs.setStringPref(WELCOME_SEEN_PREF, WELCOME_VERSION);
      if (firstTime || Services.prefs.getBoolPref(WELCOME_UPDATES_PREF, true)) {
        // after the window has settled, so it isn't lost under the restore
        setTimeout(() => showWelcome(firstTime ? "install" : "update"), 1500);
      }
    }

    // "Show the welcome tour again" and "Show what's new again" in
    // settings: each shows its tour, then turns itself back off
    for (const [pref, mode] of [[WELCOME_AGAIN_PREF, "install"], [WHATS_NEW_AGAIN_PREF, "update"]]) {
      const again = () => {
        if (!Services.prefs.getBoolPref(pref, false)) {
          return;
        }
        Services.prefs.setBoolPref(pref, false);
        if (Services.wm.getMostRecentWindow("navigator:browser") === window) {
          showWelcome(mode);
        }
      };
      Services.prefs.addObserver(pref, again);
      window.addEventListener("unload", () => Services.prefs.removeObserver(pref, again));
      again();
    }
  }

  // A page peeked at with Glance shows on its tab as a small picture of the
  // page, tipped at an angle, as in Dia, in place of Zen's icon tile.
  // Hovering the tab brings its close button over the picture, and that
  // first close shuts the glance; the next one closes the tab. It is
  // taken while the glance is on screen (Zia can only photograph a page
  // that's showing), when it opens, as it loads, and every few seconds
  // after, and kept when you switch away.
  const GLANCE_THUMB_PREF = "zia.glance.thumbnail";
  const GLANCE_THUMB_W = 36;
  const GLANCE_THUMB_H = 42;
  const GLANCE_THUMB_EVERY = 3000;
  // the sink in chrome.css; the hover tip eases home first
  const GLANCE_THUMB_SINK_MS = 300;
  const GLANCE_THUMB_UNTIP_MS = 450;
  const glanceHost = new WeakMap();
  // A close is marked as soon as the picture starts sinking, so the glance
  // mark coming off afterwards does not play the sink a second time.
  // Splitting also drops the mark, then immediately rebuilds the tab strip.
  // The sink waits out that rebuild, or the strip work eats into it and
  // the drop looks quicker than a close or an expand.
  const glanceClosing = new WeakSet();
  let glanceSplitOpen = false;

  function glanceTabsOnNormalTabs() {
    return [...gBrowser.tabContainer.querySelectorAll(
      ".tabbrowser-tab:not([zen-essential]) > .tab-stack > .tab-content > .tabbrowser-tab[zen-glance-tab]"
    )];
  }

  // Where the tab the glance sits on ends, so the picture is cut off there
  // (insets from the glance's own edges)
  function cutGlanceAtTab(glanceTab) {
    const background = glanceTab.parentElement
      ?.closest(".tabbrowser-tab")
      ?.querySelector(":scope > .tab-stack > .tab-background");
    if (!background) {
      return;
    }
    const glance = glanceTab.getBoundingClientRect();
    const tab = background.getBoundingClientRect();
    const px = (n) => `${Math.round(n * 2) / 2}px`;
    glanceTab.style.setProperty("--zia-glance-cut-top", px(tab.top - glance.top));
    glanceTab.style.setProperty("--zia-glance-cut-right", px(glance.right - tab.right));
    glanceTab.style.setProperty("--zia-glance-cut-bottom", px(glance.bottom - tab.bottom));
    const host = background.closest(".tabbrowser-tab");
    if (host && host !== glanceTab) {
      glanceHost.set(glanceTab, host);
    }
  }

  // Opening a glance into a real tab keeps the tab and drops the glance
  // mark. The picture was drawn on that tab, so without this it stays
  // in the stack and covers the site's icon.
  function clearGlanceThumb(glanceTab) {
    glanceTab.removeAttribute("zia-glance-thumb");
    glanceTab.style.removeProperty("--zia-glance-cut-top");
    glanceTab.style.removeProperty("--zia-glance-cut-right");
    glanceTab.style.removeProperty("--zia-glance-cut-bottom");
    glanceTab.querySelector(":scope > .tab-stack > .zia-glance-thumb")?.remove();
  }

  // The tab the glance was sitting on. Zen has already moved the glance
  // out by the time its mark comes off, so this is remembered while the
  // picture is still nested, and the previous tab is the fallback.
  function glanceHostTab(glanceTab) {
    const remembered = glanceHost.get(glanceTab);
    if (remembered?.isConnected && !remembered.hasAttribute("zen-essential")) {
      return remembered;
    }
    const nested = glanceTab.parentElement?.closest(".tabbrowser-tab");
    if (nested && nested !== glanceTab && !nested.hasAttribute("zen-essential")) {
      return nested;
    }
    const previous = glanceTab.previousElementSibling;
    if (previous?.classList?.contains("tabbrowser-tab") && !previous.hasAttribute("zen-essential")) {
      return previous;
    }
    return null;
  }

  // A copy stays on the parent tab and sinks through its bottom edge.
  // The real canvas leaves at once, so the opened tab's icon stays clear.
  // Closing passes true: Zen has already hidden the picture, and this copy
  // sinks while the page flies back. The later mark removal must not play it again.
  function sinkGlanceThumb(glanceTab, closing = false, defer = false) {
    if (!closing && (glanceClosing.has(glanceTab) || glanceTab.style.display === "none")) {
      glanceHost.delete(glanceTab);
      clearGlanceThumb(glanceTab);
      return false;
    }
    const canvas = glanceTab.querySelector(":scope > .tab-stack > .zia-glance-thumb");
    const parent = glanceHostTab(glanceTab);
    const content = parent?.querySelector(":scope > .tab-stack > .tab-content");
    glanceHost.delete(glanceTab);
    const thumbsOn = Services.prefs.getBoolPref(GLANCE_THUMB_PREF, true);
    if (!canvas || !parent?.isConnected || !content || !thumbsOn ||
        matchMedia("(prefers-reduced-motion: reduce)").matches) {
      clearGlanceThumb(glanceTab);
      return false;
    }
    if (closing) {
      glanceClosing.add(glanceTab);
    }

    const copy = document.createElementNS(HTML_NS, "canvas");
    copy.className = "zia-glance-thumb";
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext("2d").drawImage(canvas, 0, 0);

    const card = document.createElementNS(HTML_NS, "div");
    card.className = "zia-glance-thumb-exit-card";
    card.append(copy);

    const exit = document.createElementNS(HTML_NS, "div");
    exit.className = "zia-glance-thumb-exit";
    for (const name of ["--zia-glance-cut-top", "--zia-glance-cut-right", "--zia-glance-cut-bottom"]) {
      const value = glanceTab.style.getPropertyValue(name);
      if (value) {
        exit.style.setProperty(name, value);
      }
    }
    exit.append(card);
    content.querySelector(":scope > .zia-glance-thumb-exit")?.remove();

    // hovering tips the card further and dims it; that eases back, then
    // the card sinks
    const fromHover = parent.matches(":hover");
    if (fromHover) {
      card.style.rotate = "-16deg";
      copy.style.filter = "brightness(0.4)";
      card.style.animationDelay = `${GLANCE_THUMB_UNTIP_MS}ms`;
    }
    const drop = () => exit.remove();
    const play = () => {
      const live = parent.querySelector(":scope > .tab-stack > .tab-content");
      if (!live?.isConnected) {
        return;
      }
      live.querySelector(":scope > .zia-glance-thumb-exit")?.remove();
      card.style.animationPlayState = "running";
      live.append(exit);
      if (fromHover) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            card.style.rotate = "";
            copy.style.filter = "";
          });
        });
      }
      card.addEventListener("animationend", (event) => {
        if (event.animationName === "zia-glance-sink") {
          drop();
        }
      });
      setTimeout(drop, GLANCE_THUMB_SINK_MS + (fromHover ? GLANCE_THUMB_UNTIP_MS : 0) + 80);
    };
    // held off the tab until the strip has finished moving, so the sink
    // starts after that work instead of during it
    clearGlanceThumb(glanceTab);
    if (defer) {
      requestAnimationFrame(() => requestAnimationFrame(play));
    } else {
      play();
    }
    return true;
  }

  // The canvas that sits over a glance tab's tile
  function glanceThumbParts(glanceTab) {
    const stack = glanceTab.querySelector(":scope > .tab-stack");
    if (!stack) {
      return null;
    }
    cutGlanceAtTab(glanceTab);
    let canvas = stack.querySelector(":scope > .zia-glance-thumb");
    if (!canvas) {
      canvas = document.createElementNS(HTML_NS, "canvas");
      canvas.className = "zia-glance-thumb";
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(GLANCE_THUMB_W * ratio);
      canvas.height = Math.round(GLANCE_THUMB_H * ratio);
      stack.append(canvas);
    }
    return canvas;
  }

  async function photographGlance(glanceTab) {
    const canvas = glanceThumbParts(glanceTab);
    const browser = glanceTab.linkedBrowser;
    const windowGlobal = browser?.browsingContext?.currentWindowGlobal;
    const width = browser?.clientWidth;
    const height = browser?.clientHeight;
    if (!canvas || !windowGlobal || !width || !height) {
      return;
    }
    // The top of the page, cut to the tile's shape
    const rectHeight = Math.min(height, (width * GLANCE_THUMB_H) / GLANCE_THUMB_W);
    const scale = canvas.width / width;
    let bitmap = null;
    try {
      bitmap = await windowGlobal.drawSnapshot(new DOMRect(0, 0, width, rectHeight), scale, "white");
    } catch (err) {
      return;
    }
    // Expanded into a normal tab while the shot was being taken: the
    // canvas is already gone, and a late paint must not put it back.
    if (!bitmap || !canvas.isConnected || !glanceTab.hasAttribute("zen-glance-tab")) {
      bitmap?.close();
      return;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    glanceTab.setAttribute("zia-glance-thumb", "true");
  }

  // The glance on a normal tab, if it has one
  function glanceOnTab(tab) {
    return tab && !tab.hasAttribute("zen-essential")
      ? tab.querySelector(":scope > .tab-stack > .tab-content > .tabbrowser-tab[zen-glance-tab]")
      : null;
  }

  function closeGlanceOn(glanceTab) {
    const parent = glanceTab.parentElement?.closest(".tabbrowser-tab");
    try {
      if ((glanceTab.selected || parent?.selected) && window.gZenGlanceManager?.closeGlance) {
        window.gZenGlanceManager.closeGlance({ onTabClose: true });
      } else {
        gBrowser.removeTab(glanceTab, { animate: false });
      }
    } catch (err) {
      noteError("glance thumbnail: close", err);
    }
  }

  function watchGlanceThumbs() {
    const on = () => Services.prefs.getBoolPref(GLANCE_THUMB_PREF, true);
    // on unless switched off: the styles look for this mark, not the setting
    const markOff = () => setFlag("zia-glance-thumb-off", !on());
    markOff();
    Services.prefs.addObserver(GLANCE_THUMB_PREF, markOff);
    gBrowser.tabContainer.addEventListener(
      "GlanceClose",
      (event) => {
        if (event.target?.classList?.contains("tabbrowser-tab")) {
          glanceClosing.add(event.target);
        }
      },
      true
    );
    // Zen's close flies the page back into the tab and hides the picture
    // immediately. The picture sinks while that flight plays. A first click
    // that only asks for confirmation does not hide the tab, so it does not sink.
    const manager = window.gZenGlanceManager;
    if (manager?.closeGlance && !manager.closeGlance.ziaGlanceSink) {
      const originalClose = manager.closeGlance;
      const closeGlance = function (options) {
        const glanceTab = options?.noAnimation
          ? null
          : glanceTabsOnNormalTabs().find((tab) => tab.selected || glanceHost.get(tab)?.selected);
        const result = originalClose.call(this, options);
        if (glanceTab?.style.display === "none") {
          sinkGlanceThumb(glanceTab, true);
        }
        return result;
      };
      closeGlance.ziaGlanceSink = true;
      manager.closeGlance = closeGlance;
    }
    if (manager?.fullyOpenGlance && !manager.fullyOpenGlance.ziaGlanceSink) {
      const originalOpen = manager.fullyOpenGlance;
      const fullyOpenGlance = function (options) {
        const splitting = !!options?.forSplit;
        if (splitting) {
          glanceSplitOpen = true;
        }
        try {
          return originalOpen.call(this, options);
        } finally {
          if (splitting) {
            queueMicrotask(() => {
              glanceSplitOpen = false;
            });
          }
        }
      };
      fullyOpenGlance.ziaGlanceSink = true;
      manager.fullyOpenGlance = fullyOpenGlance;
    }
    const photographShowing = () => {
      if (!on() || document.hidden) {
        return;
      }
      for (const glanceTab of glanceTabsOnNormalTabs()) {
        const parent = glanceTab.parentElement?.closest(".tabbrowser-tab");
        // only a glance that's on screen: while it's open Zen selects the
        // glance's own tab, not the one it came from
        if (glanceTab.selected || parent?.selected) {
          photographGlance(glanceTab);
        } else {
          glanceThumbParts(glanceTab);
        }
      }
    };

    // A glance opening: photographed as it appears, as it loads, and after.
    // Opening it into a normal tab takes the mark off the same tab; the
    // picture sinks back into the tab it came from.
    new MutationObserver((records) => {
      let opened = false;
      for (const record of records) {
        const tab = record.target;
        if (!tab.classList?.contains("tabbrowser-tab")) {
          continue;
        }
        if (tab.hasAttribute("zen-glance-tab")) {
          opened = true;
        } else {
          const splitting = glanceSplitOpen;
          glanceSplitOpen = false;
          sinkGlanceThumb(tab, false, splitting);
        }
      }
      if (opened) {
        // cut where the tab ends before it's first drawn, not after
        glanceTabsOnNormalTabs().forEach(cutGlanceAtTab);
        [150, 600, 1500].forEach((ms) => setTimeout(photographShowing, ms));
      }
    }).observe(gBrowser.tabContainer, { subtree: true, attributes: true, attributeFilter: ["zen-glance-tab"] });
    gBrowser.tabContainer.addEventListener("TabSelect", () => setTimeout(photographShowing, 300));
    gBrowser.addTabsProgressListener({
      onStateChange(browser, webProgress, request, flags) {
        if (webProgress?.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_STOP &&
            gBrowser.getTabForBrowser(browser)?.hasAttribute("zen-glance-tab")) {
          setTimeout(photographShowing, 200);
        }
      },
    });
    setInterval(photographShowing, GLANCE_THUMB_EVERY);
    photographShowing();

    // A tab with a glance: its close button, which sits over the picture,
    // closes the glance first, and only then the tab
    const glanceUnderClose = (event) => {
      if (!on() || event.button !== 0) {
        return null;
      }
      const close = event.target?.closest?.(".tab-close-button");
      const tab = close?.closest(".tabbrowser-tab");
      return close?.parentElement?.parentElement?.parentElement === tab ? glanceOnTab(tab) : null;
    };
    gBrowser.tabContainer.addEventListener(
      "click",
      (event) => {
        const glanceTab = glanceUnderClose(event);
        if (glanceTab) {
          event.preventDefault();
          event.stopPropagation();
          closeGlanceOn(glanceTab);
        }
      },
      true
    );
    for (const type of ["mousedown", "mouseup"]) {
      gBrowser.tabContainer.addEventListener(
        type,
        (event) => {
          if (glanceUnderClose(event)) {
            event.stopPropagation();
          }
        },
        true
      );
    }
  }

  // Firefox's own sidebar panels (Bookmarks, History, Synced Tabs) are
  // pages of their own inside the panel, which Zia's chrome.css doesn't
  // reach: zia-sidebar.css is loaded into each as it opens. The panel's
  // frame is styled in chrome.css. On unless switched off in settings.
  const SIDEBAR_PANELS_PREF = "zia.sidebar-panels.style";
  // fresh each session, so an updated Zia's styles aren't served from cache
  const SIDEBAR_SHEET = `chrome://sine/content/zia/zia-sidebar.css?${Date.now()}`;

  // The tabs' own measurements, read off a tab in the sidebar, for the
  // panels' rows to match: text size and weight, row height, the gap
  // between rows, the corner radius and the padding before the icon
  function tabMeasurements() {
    const tabs = gBrowser.visibleTabs.filter((tab) => !tab.hasAttribute("zen-essential") && !tab.hasAttribute("zen-glance-tab"));
    // one whose icon is showing (not hovered, where the close button takes
    // its place, nor loading), else any to be seen
    const shownIcon = (t) => {
      const image = t.querySelector(".tab-icon-image");
      return image && !t.matches(":hover") && image.getBoundingClientRect().width > 0 ? image : null;
    };
    const tab = tabs.find((t) => t.getBoundingClientRect().height > 0 && shownIcon(t)) || tabs.find((t) => t.getBoundingClientRect().height > 0);
    if (!tab) {
      return null;
    }
    const background = tab.querySelector(".tab-background");
    const label = tab.querySelector(".tab-label");
    const content = tab.querySelector(".tab-content");
    const icon = shownIcon(tab);
    if (!background || !label || !content) {
      return null;
    }
    const height = background.getBoundingClientRect().height;
    const next = tabs[tabs.indexOf(tab) + 1]?.querySelector(".tab-background");
    const gap = next
      ? next.getBoundingClientRect().top - background.getBoundingClientRect().bottom
      : 2 * parseFloat(getComputedStyle(tab).getPropertyValue("--tab-margin-block") || "2");
    const text = getComputedStyle(label);
    const box = content.getBoundingClientRect();
    const toolbox = document.getElementById("navigator-toolbox")?.getBoundingClientRect();
    const inset = toolbox ? background.getBoundingClientRect().left - toolbox.left : 8;
    return {
      "--zia-row-h": `${height}px`,
      "--zia-row-gap": `${Math.max(0, Math.min(12, gap))}px`,
      "--zia-row-radius": getComputedStyle(background).borderTopLeftRadius,
      "--zia-row-font-size": text.fontSize,
      "--zia-row-font-weight": text.fontWeight,
      "--zia-row-font-family": text.fontFamily,
      // from the tab's own edge (its background), not its content box
      "--zia-row-pad": `${within(icon ? icon.getBoundingClientRect().left - background.getBoundingClientRect().left : NaN, 2, 24, 10)}px`,
      // text: an unselected tab's (dimmed, as in Dia) and a selected one's
      "--zia-row-text": labelColor(tabs.find((t) => !t.selected && !t.hasAttribute("visuallyselected"))) || "rgba(255, 255, 255, 0.8)",
      "--zia-row-text-selected": labelColor(gBrowser.selectedTab?.hasAttribute("zen-essential") ? null : gBrowser.selectedTab) || "rgb(255, 255, 255)",
      "--zia-row-inset": `${Math.max(0, Math.min(16, inset))}px`,
      "--zia-row-hover-bg": getComputedStyle(document.documentElement).getPropertyValue("--zia-tab-hover-bg").trim() || "rgba(255, 255, 255, 0.115)",
      "--zia-row-selected-bg": getComputedStyle(document.documentElement).getPropertyValue("--zia-active-tab-bg").trim() || "rgba(0, 0, 0, 0.1)",
      "--zia-row-indent": `${folderIndent(tab)}px`,
      "--zia-row-icon-gap": `${within(icon ? label.getBoundingClientRect().left - icon.getBoundingClientRect().right : NaN, 2, 16, 8)}px`,
    };
  }

  // a measurement only if it's a sensible one, else the usual
  function within(value, low, high, usual) {
    return Number.isFinite(value) && value >= low && value <= high ? value : usual;
  }

  function labelColor(tab) {
    const label = tab?.querySelector(".tab-label-container");
    return label ? getComputedStyle(label).color : null;
  }

  // How far a tab in a folder steps in from one that isn't
  function folderIndent(tab) {
    const inFolder = gBrowser.visibleTabs.find((t) => t.closest("zen-folder, tab-group:not([split-view-group])") && t.getBoundingClientRect().height > 0);
    const outer = tab.closest("zen-folder, tab-group") ? null : tab;
    if (inFolder && outer) {
      const step = inFolder.querySelector(".tab-background").getBoundingClientRect().left - outer.querySelector(".tab-background").getBoundingClientRect().left;
      if (step > 0 && step < 40) {
        return step;
      }
    }
    return 14;
  }

  // The tab sidebar's own sides: from the window's edge to its tabs, and
  // from its tabs to the page's card. The panel takes the same, mirrored
  // (less the splitter, which is the gap on its card side).
  function sidebarSides() {
    const tab = gBrowser.visibleTabs.find((t) => !t.hasAttribute("zen-essential") && !t.closest("zen-folder, tab-group") && t.getBoundingClientRect().height > 0);
    const background = tab?.querySelector(".tab-background")?.getBoundingClientRect();
    const card = document.getElementById("zen-appcontent-wrapper")?.getBoundingClientRect();
    const splitter = document.getElementById("sidebar-splitter")?.getBoundingClientRect().width || 0;
    if (!background || !card) {
      return;
    }
    const right = document.documentElement.getAttribute("zen-right-side") === "true";
    // On the tab sidebar's own side, the panel sits between the tabs and
    // the card, parted from the tabs by a line: the gap from the tabs to
    // that line is the panel's gap after it, and before the card
    const panel = document.getElementById("sidebar-box");
    const panelOnRight = panel?.hasAttribute("sidebar-positionend");
    if (panel && !panel.hidden && document.documentElement.hasAttribute("zia-panels-beside") && panelOnRight === right) {
      const edge = panel.getBoundingClientRect();
      const gap = right ? background.left - edge.right : edge.left - background.right;
      if (gap >= 0 && gap < 40) {
        document.documentElement.style.setProperty("--zia-panel-pad-window", `${gap}px`);
        document.documentElement.style.setProperty("--zia-panel-pad-card", `${Math.max(0, gap - splitter)}px`);
      }
      return;
    }
    const windowSide = right ? window.innerWidth - background.right : background.left;
    const cardSide = right ? background.left - card.right : card.left - background.right;
    if (windowSide >= 0 && windowSide < 40 && cardSide >= 0 && cardSide < 40) {
      document.documentElement.style.setProperty("--zia-panel-pad-window", `${windowSide}px`);
      document.documentElement.style.setProperty("--zia-panel-pad-card", `${Math.max(0, cardSide - splitter)}px`);
    }
  }

  // The close button in the downloads button's colour: its icon's fill,
  // at the strength it's drawn (its fill's own and the button's opacity)
  function matchCloseToDownloads() {
    const icon = document.querySelector("#downloads-button .toolbarbutton-icon, #downloads-button image");
    if (!icon || !icon.getBoundingClientRect().width) {
      return;
    }
    const style = getComputedStyle(icon);
    let strength = (parseFloat(style.fillOpacity) || 1) * (parseFloat(style.opacity) || 1);
    for (let el = icon.parentElement; el && el.id !== "zia-workspace-slot" && el !== document.documentElement; el = el.parentElement) {
      strength *= parseFloat(getComputedStyle(el).opacity) || 1;
      if (el.id === "downloads-button") {
        break;
      }
    }
    const root = document.documentElement.style;
    root.setProperty("--zia-panel-close-fill", style.fill && style.fill !== "none" ? style.fill : "rgb(255, 255, 255)");
    root.setProperty("--zia-panel-close-opacity", String(Math.round(strength * 1000) / 1000));
  }

  function matchTabs(doc) {
    safely("sidebar panels: sides", sidebarSides);
    safely("sidebar panels: close colour", matchCloseToDownloads);
    const sizes = tabMeasurements();
    if (sizes) {
      for (const [name, value] of Object.entries(sizes)) {
        doc.documentElement.style.setProperty(name, value);
      }
    }
    // beside the page, the panel's own sides give the room
    if (document.documentElement.hasAttribute("zia-panels-beside")) {
      doc.documentElement.style.setProperty("--zia-panel-inset", "0px");
    } else {
      doc.documentElement.style.removeProperty("--zia-panel-inset");
    }
    // the highlights' shape: the space name's own pill
    const label = document.getElementById("zia-space-label");
    if (label) {
      const pill = getComputedStyle(label);
      doc.documentElement.style.setProperty("--zia-pill-radius", pill.borderTopLeftRadius);
      const corner = pill.getPropertyValue("corner-top-left-shape");
      if (corner) {
        doc.documentElement.style.setProperty("--zia-pill-corner", corner);
      }
    }
    roundTreeRows(doc);
    styleSearchField(doc);
    doc.defaultView.requestAnimationFrame(() =>
      doc.defaultView.requestAnimationFrame(() => {
        levelTitle();
        spaceTitle(doc);
      })
    );
  }

  // The space between the panel's title and its search field is the one
  // between the space's name and the essentials below it, text to tile:
  // measured on both, and the header's padding made up to it
  function spaceTitle(doc) {
    const label = document.getElementById("zia-space-label") || document.querySelector(".zen-current-workspace-indicator-name");
    const essential = [...document.querySelectorAll(".zen-essentials-container .tabbrowser-tab[zen-essential] > .tab-stack > .tab-background")]
      .find((e) => e.getBoundingClientRect().height > 0);
    const title = document.getElementById("sidebar-title");
    const header = document.getElementById("sidebar-header");
    const browser = document.getElementById("sidebar");
    const search = doc.querySelector("#search-box, .sidebar-search-container.selected .tabsFilter");
    if (!label || !essential || !title || !header || !browser || !search) {
      return;
    }
    const textBottom = (el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2 + parseFloat(getComputedStyle(el).fontSize) / 2;
    };
    const wanted = essential.getBoundingClientRect().top - textBottom(label);
    const now = browser.getBoundingClientRect().top + search.getBoundingClientRect().top - textBottom(title);
    if (!(wanted > 0 && wanted < 48) || Math.abs(wanted - now) < 0.5) {
      return;
    }
    const padding = parseFloat(getComputedStyle(header).paddingBottom) || 0;
    document.documentElement.style.setProperty("--zia-panel-title-pad", `${Math.max(0, padding + wanted - now)}px`);
  }

  // The panel's title sits level with the space's name across the window
  function levelTitle() {
    const label = document.getElementById("zia-space-label");
    const pill = document.getElementById("sidebar-switcher-target");
    const header = document.getElementById("sidebar-header");
    if (!label || !pill || !header || !label.getBoundingClientRect().height || !pill.getBoundingClientRect().height) {
      return;
    }
    const off = label.getBoundingClientRect().top - pill.getBoundingClientRect().top;
    if (Math.abs(off) < 0.5) {
      return;
    }
    const padding = parseFloat(getComputedStyle(header).paddingTop) || 0;
    const next = padding + off;
    if (next >= 0 && next < 40) {
      document.documentElement.style.setProperty("--zia-panel-title-top", `${next}px`);
    }
  }

  // The search field draws itself inside a component of its own, which a
  // page's styles don't reach: Zia hands it its own few rules there. A
  // faint hairline when it's focused, inside it so nothing is cut off at
  // the panel's edge, in place of Firefox's thick ring.
  const SEARCH_FIELD_RULES = `
    #input {
      appearance: none !important;
      border: 1px solid transparent !important;
      outline: none !important;
      box-shadow: none !important;
    }
    #input:focus,
    #input:focus-visible {
      outline: none !important;
      border-color: rgba(255, 255, 255, 0.14) !important;
    }
  `;

  function styleSearchField(doc) {
    const win = doc.defaultView;
    for (const field of doc.querySelectorAll("moz-input-search")) {
      const apply = () => {
        const root = field.shadowRoot;
        if (!root || root.ziaStyled) {
          return;
        }
        try {
          const sheet = new win.CSSStyleSheet();
          sheet.replaceSync(SEARCH_FIELD_RULES);
          root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
          root.ziaStyled = true;
        } catch (err) {
          noteError("sidebar panels: search field", err);
        }
      };
      apply();
      // drawn a moment later, the first time
      field.updateComplete?.then(apply, () => {});
      win.setTimeout(apply, 300);
    }
  }

  // Bookmarks and History are trees, whose rows can't be rounded or
  // spaced apart. Zia draws the hovered and the selected row's highlight
  // itself, behind the tree, shaped like a tab: as tall as a tab, rounded
  // like one, with the gap between rows left clear.
  function roundTreeRows(doc) {
    const tree = doc.querySelector(".sidebar-placesTree");
    if (!tree || doc.getElementById("zia-row-pills")) {
      return;
    }
    const win = doc.defaultView;
    const layer = doc.createElementNS(HTML_NS, "div");
    layer.id = "zia-row-pills";
    const hover = doc.createElementNS(HTML_NS, "div");
    hover.className = "zia-row-pill";
    hover.setAttribute("hover", "");
    const chosen = doc.createElementNS(HTML_NS, "div");
    chosen.className = "zia-row-pill";
    chosen.setAttribute("selected", "");
    layer.append(chosen, hover);
    tree.before(layer);

    let hoveredRow = -1;
    const put = (pill, row) => {
      const body = tree.treeBody || tree.querySelector("treechildren");
      const height = tree.rowHeight;
      if (row < 0 || !body || !height) {
        pill.hidden = true;
        return;
      }
      const shown = row - tree.getFirstVisibleRow();
      const box = body.getBoundingClientRect();
      // each row is a tab's height and the gap after it: the pill is the tab
      const gap = parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--zia-row-gap")) || 0;
      const top = box.top + shown * height;
      if (shown < 0 || top + height > box.bottom + 1) {
        pill.hidden = true;
        return;
      }
      // a row inside a folder steps in, as a folder's tabs do
      const indent = (tree.view?.getLevel(row) || 0) * (parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--zia-row-indent")) || 0);
      pill.hidden = false;
      pill.style.top = `${top + gap / 2}px`;
      pill.style.left = `${box.left + indent}px`;
      pill.style.width = `${Math.max(0, box.width - indent)}px`;
      pill.style.height = `${height - gap}px`;
    };
    let queued = false;
    const update = () => {
      if (queued) {
        return;
      }
      queued = true;
      win.requestAnimationFrame(() => {
        queued = false;
        try {
          // the selected row keeps its look under the pointer, as a tab does
          const current = tree.view?.selection?.count ? tree.currentIndex : -1;
          put(chosen, current);
          put(hover, hoveredRow === current ? -1 : hoveredRow);
        } catch (err) {
          noteError("sidebar panels: rows", err);
        }
      });
    };
    tree.addEventListener("mousemove", (event) => {
      const row = tree.getRowAt(event.clientX, event.clientY);
      if (row !== hoveredRow) {
        hoveredRow = row;
        update();
      }
    });
    tree.addEventListener("mouseleave", () => {
      hoveredRow = -1;
      update();
    });
    for (const type of ["select", "wheel", "keydown", "click", "focus", "blur"]) {
      tree.addEventListener(type, update, true);
    }
    win.addEventListener("resize", update);
    // rows coming and going (a search, a folder opened) and scrolling the
    // tree itself don't all tell anyone: checked over as well while open
    const every = win.setInterval(update, 250);
    win.addEventListener("unload", () => win.clearInterval(every));
    update();
  }

  function watchSidebarPanels() {
    const on = () => Services.prefs.getBoolPref(SIDEBAR_PANELS_PREF, true);
    const styled = new WeakSet();
    const style = () => {
      const win = document.getElementById("sidebar")?.contentWindow;
      const doc = win?.document;
      if (!doc || doc.documentURI === "about:blank") {
        return;
      }
      try {
        // switched off with a panel open: its styles go straight away
        if (!on()) {
          if (styled.has(doc)) {
            win.windowUtils.removeSheetUsingURIString(SIDEBAR_SHEET, win.windowUtils.AUTHOR_SHEET);
            styled.delete(doc);
          }
        } else {
          if (!styled.has(doc)) {
            win.windowUtils.loadSheetUsingURIString(SIDEBAR_SHEET, win.windowUtils.AUTHOR_SHEET);
            styled.add(doc);
          }
          matchTabs(doc);
        }
      } catch (err) {
        noteError("sidebar panels: style", err);
      }
    };
    const markPlain = () => {
      setFlag("zia-panels-plain", !on());
      style();
    };
    markPlain();
    Services.prefs.addObserver(SIDEBAR_PANELS_PREF, markPlain);
    window.addEventListener("unload", () => Services.prefs.removeObserver(SIDEBAR_PANELS_PREF, markPlain));
    // each panel's page loads into the same #sidebar browser
    document.getElementById("sidebar")?.addEventListener("load", style, true);
    safely("placeSidebarPanel", placeSidebarPanel);
  }

  // Zen puts the panel inside the page's card, under the toolbar. Zia
  // moves it beside the card instead, full height on the window's own
  // background, a second sidebar, on whichever side it's set to (Firefox's
  // "Move sidebar to left/right"). Off in settings: back where Zen has it.
  const SIDEBAR_BESIDE_PREF = "zia.sidebar-panels.beside";

  function placeSidebarPanel() {
    const box = document.getElementById("sidebar-box");
    const splitter = document.getElementById("sidebar-splitter");
    const card = document.getElementById("zen-appcontent-wrapper");
    if (!box || !splitter || !card) {
      return;
    }
    // where Zen had them, to put them back
    const home = box.parentNode;
    const homeNext = splitter.nextSibling;
    const resize = [splitter.getAttribute("resizebefore"), splitter.getAttribute("resizeafter")];

    const reload = () => {
      // a moved panel's page starts again: shown again if it was open
      try {
        const id = window.SidebarController?.currentID;
        if (id && !box.hidden) {
          window.SidebarController.show(id);
        }
      } catch (err) {
        noteError("sidebar panels: reload", err);
      }
    };
    const place = () => {
      const beside = Services.prefs.getBoolPref(SIDEBAR_BESIDE_PREF, true);
      setFlag("zia-panels-beside", beside);
      const end = box.hasAttribute("sidebar-positionend");
      let moved = false;
      if (beside) {
        // the splitter sits between the card and the panel, and resizes
        // the panel
        if (end && (card.nextElementSibling !== splitter || splitter.nextElementSibling !== box)) {
          card.after(splitter, box);
          moved = true;
        } else if (!end && (card.previousElementSibling !== splitter || splitter.previousElementSibling !== box)) {
          card.before(box, splitter);
          moved = true;
        }
        splitter.setAttribute("resizebefore", end ? "none" : "sibling");
        splitter.setAttribute("resizeafter", end ? "sibling" : "none");
      } else if (box.parentNode !== home) {
        home.insertBefore(box, homeNext);
        home.insertBefore(splitter, homeNext);
        splitter.setAttribute("resizebefore", resize[0] ?? "sibling");
        splitter.setAttribute("resizeafter", resize[1] ?? "none");
        moved = true;
      }
      if (moved) {
        reload();
      }
    };
    place();
    Services.prefs.addObserver(SIDEBAR_BESIDE_PREF, place);

    // no wider than Zen lets the tab sidebar be (dragging its edge stops
    // there too), and following that setting if it's changed
    const MAX_PREF = "zen.view.sidebar-expanded.max-width";
    // the tab sidebar's own limit as Zen sets it on it, else its setting
    const maxWidth = () => {
      const toolbox = parseFloat(gNavToolbox?.style.maxWidth || getComputedStyle(gNavToolbox).maxWidth);
      if (toolbox > 0) {
        return toolbox;
      }
      try {
        return Services.prefs.getIntPref(MAX_PREF);
      } catch (err) {
        return 300;
      }
    };
    let clamping = false;
    const cap = () => {
      if (clamping) {
        return;
      }
      const beside = Services.prefs.getBoolPref(SIDEBAR_BESIDE_PREF, true);
      const max = maxWidth();
      if (!beside || !(max > 0)) {
        box.style.removeProperty("max-width");
        return;
      }
      box.style.setProperty("max-width", `${max}px`, "important");
      // dragged past it anyway: back to the limit, as the tab sidebar stops
      if (box.getBoundingClientRect().width > max + 0.5) {
        clamping = true;
        box.style.width = `${max}px`;
        box.setAttribute("width", String(max));
        clamping = false;
      }
    };
    cap();
    new MutationObserver(cap).observe(box, { attributes: true, attributeFilter: ["width", "style"] });
    new MutationObserver(cap).observe(gNavToolbox, { attributes: true, attributeFilter: ["style"] });
    Services.prefs.addObserver(MAX_PREF, cap);
    Services.prefs.addObserver(SIDEBAR_BESIDE_PREF, cap);
    window.addEventListener("unload", () => {
      Services.prefs.removeObserver(MAX_PREF, cap);
      Services.prefs.removeObserver(SIDEBAR_BESIDE_PREF, cap);
    });
    window.addEventListener("unload", () => Services.prefs.removeObserver(SIDEBAR_BESIDE_PREF, place));
    // moving it to the other side
    new MutationObserver(place).observe(box, { attributes: true, attributeFilter: ["sidebar-positionend"] });

    // It slides in from the window's edge as it opens, the page giving way
    // to it, and back out as it closes: exactly as Zen slides the tab
    // sidebar (its outer margin, from minus its width to nothing, with
    // Zen's own spring: no bounce, a tenth of a second)
    const beside = () => Services.prefs.getBoolPref(SIDEBAR_BESIDE_PREF, true) && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    let slides = 0;
    const sliding = (on) => {
      slides = Math.max(0, slides + (on ? 1 : -1));
      // a little after it stops, as the site catches up with its new size
      if (slides) {
        setFlag("zia-panel-sliding", true);
      } else {
        setTimeout(() => !slides && setFlag("zia-panel-sliding", false), 250);
      }
    };
    // the tab sidebar's own slide too: Zen marks it while it runs, and the
    // colour is held a moment after, as the site catches up
    let zenSliding = false;
    new MutationObserver(() => {
      const now = document.documentElement.hasAttribute("zen-compact-animating");
      if (now !== zenSliding) {
        zenSliding = now;
        sliding(now);
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["zen-compact-animating"] });
    const slide = (opening) => {
      const run = slideBox(opening);
      sliding(true);
      return run.finally(() => {
        sliding(false);
        // its sides measured where it has come to rest
        if (opening) {
          safely("sidebar panels: sides", sidebarSides);
        }
      });
    };
    const slideBox = (opening) => {
      // off the window's edge; but on the tab sidebar's own side that edge
      // is the tabs, so it's tucked under the page instead (the margin on
      // the page's side), never sliding over the tabs
      const onRight = box.hasAttribute("sidebar-positionend");
      const besideTabs = onRight === (document.documentElement.getAttribute("zen-right-side") === "true");
      const side = onRight !== besideTabs ? "marginRight" : "marginLeft";
      const hidden = `-${box.getBoundingClientRect().width}px`;
      const motion = window.gZenUIManager?.motion;
      const done = () => box.style.removeProperty(side === "marginRight" ? "margin-right" : "margin-left");
      if (motion?.animate) {
        box.style[side] = opening ? hidden : "0px";
        return Promise.resolve(
          motion.animate(box, { [side]: opening ? [hidden, "0px"] : ["0px", hidden] }, {
            ease: opening ? "easeOut" : "easeIn",
            type: "spring",
            bounce: 0,
            duration: 0.1,
          })
        ).then(() => {
          if (opening) {
            done();
          }
          return done;
        });
      }
      const run = box.animate([{ [side]: opening ? hidden : "0px" }, { [side]: opening ? "0px" : hidden }], {
        duration: 100,
        easing: opening ? "ease-out" : "ease-in",
        fill: "forwards",
      });
      return run.finished.catch(() => {}).then(() => () => run.cancel());
    };
    let wasHidden = box.hidden;
    new MutationObserver(() => {
      if (wasHidden && !box.hidden && beside()) {
        slide(true).catch((err) => noteError("sidebar panels: slide in", err));
      }
      wasHidden = box.hidden;
    }).observe(box, { attributes: true, attributeFilter: ["hidden"] });

    // closing: slid out first, then hidden as Firefox would have
    const controller = window.SidebarController;
    if (controller && typeof controller.hide === "function" && !controller.ziaSlides) {
      const hide = controller.hide;
      let sliding = false;
      controller.hide = function (...args) {
        if (sliding || box.hidden || !beside()) {
          return hide.apply(this, args);
        }
        sliding = true;
        slide(false)
          .catch((err) => {
            noteError("sidebar panels: slide out", err);
            return () => {};
          })
          .then((undo) => {
            sliding = false;
            try {
              hide.apply(this, args);
            } finally {
              undo?.();
            }
          });
        return undefined;
      };
      controller.ziaSlides = true;
    }
  }
  // A page that's gone full screen (a YouTube video, say) is shown square
  // and edge to edge. Zen and Zia only count the window as full screen when
  // it takes over the screen; when a video goes full screen inside the
  // window instead, the page kept its rounded card, and the video's corners
  // were rounded off with grey behind them.
  function watchPageFullscreen() {
    const update = () => setFlag("zia-page-fullscreen", !!document.fullscreenElement);
    const soon = () => requestAnimationFrame(update);
    window.addEventListener("MozDOMFullscreen:Entered", soon);
    window.addEventListener("MozDOMFullscreen:Exited", soon);
    document.addEventListener("fullscreenchange", soon);
    update();
  }
  // Swiping back or forward with two fingers: Dia's round arrow slides in
  // from the page's edge, level with the middle of the page, in place of
  // Firefox's, with a tap as it comes fully in. Hold the swipe there and it
  // opens, with another tap, into a card of the pages it goes back (or
  // forward) through, the next one first; the card stays once the fingers
  // lift, to click the page wanted, and a click anywhere else closes it.
  // A quick swipe just goes back a page, as before. Firefox does the
  // navigating; Zia wraps its swipe animation (gHistorySwipeAnimation) and
  // gesture handling (gGestureSupport) to follow the gesture.
  const SWIPE_PREF = "zia.swipe.dia-arrow";
  const SWIPE_HOLD_MS = 450;
  const SWIPE_MAX_PAGES = 8;
  const SWIPE_ROW = 34;
  const SWIPE_LEAVE_MS = 260;

  function swipePages(forward) {
    const pages = [];
    try {
      const history = gBrowser.selectedBrowser.browsingContext.sessionHistory;
      const step = forward ? 1 : -1;
      for (let i = history.index + step; i >= 0 && i < history.count && pages.length < SWIPE_MAX_PAGES; i += step) {
        const entry = history.getEntryAtIndex(i);
        const url = entry.URI?.spec || "";
        pages.push({ title: entry.title || url, url });
      }
    } catch (err) {
      noteError("swipe arrow: history", err);
    }
    return pages;
  }

  function swipeChevron() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M14 5.5l-5.5 6.5l5.5 6.5");
    svg.append(path);
    return svg;
  }

  // a tap on the trackpad, if Zen's haptics are on
  function swipeTap() {
    try {
      if (Services.prefs.getBoolPref("zen.haptic-feedback.enabled", true)) {
        window.zenHaptic?.();
      }
    } catch (err) {
      noteError("swipe arrow: tap", err);
    }
  }

  function watchSwipeArrow() {
    const swipe = window.gHistorySwipeAnimation;
    if (!swipe || swipe.ziaWrapped) {
      return;
    }
    swipe.ziaWrapped = true;
    const on = () => Services.prefs.getBoolPref(SWIPE_PREF, true);
    // Firefox's own arrow is hidden while Zia's is on (zia.css)
    const mark = () => setFlag("zia-swipe-arrow", on());
    mark();
    Services.prefs.addObserver(SWIPE_PREF, mark);
    window.addEventListener("unload", () => Services.prefs.removeObserver(SWIPE_PREF, mark));

    // between a swipe starting and ending; Firefox calls its animation's
    // methods for every swipe, whether or not its own arrow is shown
    let swiping = false;
    let el = null;
    let backdrop = null;
    let holdTimer = null;
    let side = null;
    let pinned = false;
    // macOS only plays a tap while a trackpad event is being handled, so
    // the card's tap goes with the swipe's own updates: the card opens on
    // one once the hold is long enough, or, held quite still (no updates
    // coming), on a timer, its tap then waiting for the next update or
    // the fingers lifting
    let willSince = 0;
    let tapOwed = false;
    const payTap = () => {
      if (tapOwed) {
        tapOwed = false;
        swipeTap();
      }
    };

    const clearHold = () => {
      clearTimeout(holdTimer);
      holdTimer = null;
    };

    const fade = (node) => {
      if (!node) {
        return;
      }
      node.setAttribute("leaving", "");
      setTimeout(() => node.remove(), SWIPE_LEAVE_MS);
    };

    const discard = () => {
      clearHold();
      pinned = false;
      el?.remove();
      backdrop?.remove();
      el = null;
      backdrop = null;
      side = null;
    };

    const close = () => {
      clearHold();
      pinned = false;
      fade(el);
      backdrop?.remove();
      el = null;
      backdrop = null;
      side = null;
    };

    const goTo = (depth, forward) => {
      try {
        const history = gBrowser.selectedBrowser.browsingContext.sessionHistory;
        const target = history.index + (forward ? depth : -depth);
        if (target >= 0 && target < history.count) {
          gBrowser.gotoIndex(target);
        }
      } catch (err) {
        noteError("swipe arrow: go to page", err);
      }
    };

    const build = (forward) => {
      discard();
      const stack = gBrowser.selectedBrowser?.closest(".browserStack");
      if (!stack) {
        return;
      }
      side = forward ? "forward" : "back";
      el = document.createElementNS(HTML_NS, "div");
      el.id = "zia-swipe";
      el.setAttribute("side", side);
      const arrow = document.createElementNS(HTML_NS, "div");
      arrow.className = "zia-swipe-arrow";
      arrow.append(swipeChevron());
      const list = document.createElementNS(HTML_NS, "div");
      list.className = "zia-swipe-pages";
      el.append(arrow, list);
      stack.append(el);
    };

    // The card of pages, the next one first. It stays from here on, a click
    // on a page going to it and a click anywhere round it closing it.
    const open = (fromEvent = false) => {
      clearHold();
      if (!el || el.hasAttribute("open")) {
        return;
      }
      const pages = swipePages(side === "forward");
      if (!pages.length) {
        return;
      }
      const forward = side === "forward";
      const list = el.querySelector(".zia-swipe-pages");
      list.replaceChildren(
        ...pages.map((page, i) => {
          const row = document.createElementNS(HTML_NS, "div");
          row.className = "zia-swipe-page";
          row.toggleAttribute("selected", i === 0);
          const icon = document.createElementNS(HTML_NS, "img");
          icon.alt = "";
          icon.src = `page-icon:${page.url}`;
          icon.addEventListener("error", () => icon.setAttribute("src", "chrome://global/skin/icons/defaultFavicon.svg"), { once: true });
          const title = document.createElementNS(HTML_NS, "span");
          title.textContent = page.title;
          row.append(icon, title);
          row.addEventListener("click", () => {
            close();
            goTo(i + 1, forward);
          });
          return row;
        })
      );
      el.style.setProperty("--zia-swipe-h", `${pages.length * SWIPE_ROW + 12}px`);
      el.setAttribute("open", "");
      pinned = true;
      // behind the card, over the page: a click anywhere round it closes it
      backdrop = document.createElementNS(HTML_NS, "div");
      backdrop.id = "zia-swipe-backdrop";
      backdrop.addEventListener("mousedown", close);
      el.before(backdrop);
      // the arrow turning into the card
      tapOwed = true;
      if (fromEvent) {
        payTap();
      }
    };

    const follow = (animation, update) => {
      if (!on() || !swiping) {
        return;
      }
      payTap();
      if (pinned) {
        return;
      }
      const back = !!animation._willGoBack?.(update);
      const forward = !back && !!animation._willGoForward?.(update);
      if (!back && !forward) {
        if (el) {
          el.style.setProperty("--p", "0");
          el.removeAttribute("will");
        }
        clearHold();
        return;
      }
      const wanted = forward ? "forward" : "back";
      if (!el || side !== wanted) {
        build(forward);
      }
      if (!el) {
        return;
      }
      const progress = Math.min(Math.abs(update?.delta || 0) * 4, 1);
      el.style.setProperty("--p", `${progress}`);
      const will = progress >= 1;
      if (will && !el.hasAttribute("will")) {
        // the arrow fully in: letting go now goes back
        swipeTap();
        willSince = Date.now();
      }
      el.toggleAttribute("will", will);
      if (will) {
        if (Date.now() - willSince >= SWIPE_HOLD_MS) {
          open(true);
        } else if (!holdTimer) {
          holdTimer = setTimeout(open, SWIPE_HOLD_MS + 120);
        }
      } else {
        clearHold();
      }
    };

    const leave = () => {
      payTap();
      // the card stays once the fingers lift
      if (pinned) {
        return;
      }
      close();
    };

    window.addEventListener(
      "keydown",
      (event) => {
        if (pinned && event.key === "Escape") {
          close();
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );

    const start = swipe.startAnimation;
    swipe.startAnimation = function () {
      discard();
      swiping = true;
      tapOwed = false;
      return start.apply(this, arguments);
    };
    const update = swipe.updateAnimation;
    swipe.updateAnimation = function (aSwipeUpdate) {
      const result = update.apply(this, arguments);
      try {
        follow(this, aSwipeUpdate);
      } catch (err) {
        noteError("swipe arrow: update", err);
      }
      return result;
    };
    const stop = swipe.stopAnimation;
    swipe.stopAnimation = function () {
      swiping = false;
      try {
        leave();
      } catch (err) {
        noteError("swipe arrow: stop", err);
      }
      return stop.apply(this, arguments);
    };
    gBrowser.tabContainer.addEventListener("TabSelect", discard);

    // Letting go with the card open: no going back, the card stays to pick
    // from; otherwise Firefox's one page back
    const gestures = window.gGestureSupport;
    const coordinate = gestures?._coordinateSwipeEventWithAnimation;
    if (gestures && coordinate) {
      gestures._coordinateSwipeEventWithAnimation = function (aEvent, aDir) {
        if (on() && pinned) {
          swipe.stopAnimation();
          return;
        }
        return coordinate.apply(this, arguments);
      };
    }
  }
  function safely(name, fn) {
    try {
      const result = fn();
      result?.catch?.((err) => console.error(`[Zia] ${name} failed:`, err));
    } catch (err) {
      console.error(`[Zia] ${name} failed:`, err);
    }
  }

  // Give Sine's other scripts and the first browser paint a turn before
  // optional panels, icon menus and decoration initialize. Each idle slice
  // is short, including when the browser stays busy restoring a session.
  const startupTasks = [];
  let startupIdle = 0;
  let startupTimer = 0;
  let startupStopped = false;

  function scheduleStartupTasks() {
    if (startupStopped || startupIdle || !startupTasks.length) {
      return;
    }
    startupIdle = requestIdleCallback((deadline) => {
      startupIdle = 0;
      const started = performance.now();
      do {
        const [name, fn] = startupTasks.shift();
        safely(name, fn);
      } while (startupTasks.length && !startupStopped &&
               performance.now() - started < 4 && deadline.timeRemaining() > 1);
      scheduleStartupTasks();
    }, { timeout: 250 });
  }

  function afterStartup(name, fn) {
    startupTasks.push([name, fn]);
    scheduleStartupTasks();
  }

  window.addEventListener("unload", () => {
    startupStopped = true;
    startupTasks.length = 0;
    cancelIdleCallback(startupIdle);
    clearTimeout(startupTimer);
  }, { once: true });

  function canUnload(tab) {
    return tab?.linkedBrowser?.isRemoteBrowser !== false;
  }

  function watchUnloadable() {
    const mark = (tab) => {
      if (!tab?.isConnected) {
        return;
      }
      tab.toggleAttribute("zia-no-unload", tab.pinned && !tab.hasAttribute("zen-essential") && !canUnload(tab));
    };
    const markAll = () => gBrowser.tabs.forEach(mark);
    for (const type of ["TabOpen", "TabPinned", "TabUnpinned", "TabSelect", "TabAttrModified"]) {
      gBrowser.tabContainer.addEventListener(type, (event) => mark(event.target));
    }
    gBrowser.addTabsProgressListener({
      onLocationChange(browser) {
        mark(gBrowser.getTabForBrowser(browser));
      },
    });
    markAll();
  }

  function currentSeparator() {
    const own = window.gZenWorkspaces?.pinnedTabsContainer?.querySelector?.(".pinned-tabs-container-separator");
    if (own) {
      return own;
    }
    const all = document.querySelectorAll(".pinned-tabs-container-separator");
    for (const sep of all) {
      const box = sep.getBoundingClientRect();
      if (box.width > 0 && sep.checkVisibility?.({ visibilityProperty: true }) !== false) {
        return sep;
      }
    }
    return all[0] || null;
  }

  // The sidebar only ever scrolls up and down. Where its tab list is a few
  // pixels wider than the sidebar (on Linux), selecting a tab scrolled it
  // sideways into view too, so the tabs shifted over against the page and
  // the essentials were cut off on both sides. Any sideways scroll goes
  // straight back.
  function keepSidebarUnscrolledSideways() {
    const toolbox = document.getElementById("navigator-toolbox");
    const LISTS = "#zen-tabs-wrapper, .workspace-arrowscrollbox, #tabbrowser-arrowscrollbox, .zen-essentials-container";
    toolbox?.addEventListener("scroll", (event) => {
      const target = event.target;
      if (!target?.matches?.(LISTS)) {
        return;
      }
      for (const el of [target, target.scrollbox]) {
        if (el?.scrollLeft) {
          el.scrollLeft = 0;
        }
      }
    }, { capture: true, passive: true });
  }

  function start() {
    const urlbar = gURLBar.textbox || document.getElementById("urlbar");

    safely("restoreNativeTabs", restoreNativeTabs);
    safely("applyZenDefaults", applyZenDefaults);
    afterStartup("setupIconPack", setupIconPack);
    safely("watchOptions", watchOptions);
    safely("watchUrlbarPosition", watchUrlbarPosition);
    safely("watchPipWindows", watchPipWindows);
    safely("watchMultiview", watchMultiview);
    safely("watchNewTabPage", watchNewTabPage);
    safely("createWorkspaceSlot", createWorkspaceSlot);
    safely("watchTabAnimations", watchTabAnimations);
    safely("closeSplitTabsInPlace", closeSplitTabsInPlace);
    safely("hideTabListScrollbars", hideTabListScrollbars);
    safely("hideWwwInUrlbar", hideWwwInUrlbar);
    safely("watchRightEdges", watchRightEdges);
    ifOn("media-player", "watchMediaOpacity", watchMediaOpacity);
    ifOn("media-player", "watchMediaGlow", watchMediaGlow);
    ifOn("media-player", "watchMediaWorkspace", watchMediaWorkspace);
    safely("keepMediaCardsInPlace", keepMediaCardsInPlace);
    safely("watchTabSoundBars", watchTabSoundBars);
    safely("watchSelectedTabGlow", watchSelectedTabGlow);
    safely("watchSplitDrop", watchSplitDrop);
    safely("watchSplitPanes", watchSplitPanes);
    ifOn("find-bar", "watchFindBars", watchFindBars);
    safely("watchSpaceColor", watchSpaceColor);
    safely("animateEssentialsAdds", animateEssentialsAdds);
    ifOn("undo-close", "watchUndoClose", watchUndoClose);
    ifOn("tab-numbers", "watchTabNumbers", watchTabNumbers);
    afterStartup("watchWelcome", watchWelcome);
    afterStartup("watchGlanceThumbs", watchGlanceThumbs);
    afterStartup("watchSidebarPanels", watchSidebarPanels);
    safely("watchTypedAddress", watchTypedAddress);
    safely("registerScrollActor", registerScrollActor);
    safely("registerPdfActor", registerPdfActor);
    safely("watchScrollInput", watchScrollInput);
    safely("createTitleElement", createTitleElement);
    safely("watchTitleOnly", watchTitleOnly);
    safely("addDownloadProgress", addDownloadProgress);
    safely("flyFirstDownloadToButton", flyFirstDownloadToButton);
    afterStartup("addIconPicker", () => ifOn("icon-picker", "addIconPicker", addIconPicker));
    safely("watchCompactTopRow", watchCompactTopRow);
    afterStartup("watchOldIcons", watchOldIcons);
    safely("watchEssentialRows", watchEssentialRows);
    safely("watchSidebarPaint", watchSidebarPaint);
    safely("watchWindowButtonsSide", watchWindowButtonsSide);
    afterStartup("addTabHoverCards", addTabHoverCards);

    gBrowser.tabContainer.addEventListener("TabSelect", () => {
      const browser = gBrowser.selectedBrowser;
      if (isLoading(browser) && !isErrorPage(browser)) {
        startLoader(0.25,  true);
      } else {
        cancelLoader();
      }
      snapColorForTab(browser);
      scheduleColor(60);
      scheduleColor(400);
      updateTitle();
    });

    gBrowser.tabContainer.addEventListener("TabAttrModified", (event) => {
      if (event.target === gBrowser.selectedTab) {
        updateTitle();
      }
    });

    const { STATE_START, STATE_STOP, STATE_IS_WINDOW } = Ci.nsIWebProgressListener;
    const { LOCATION_CHANGE_SAME_DOCUMENT, LOCATION_CHANGE_ERROR_PAGE } = Ci.nsIWebProgressListener;

    gBrowser.addTabsProgressListener({
      onStateChange(browser, webProgress, request, stateFlags) {
        if (!webProgress.isTopLevel || !(stateFlags & STATE_IS_WINDOW)) {
          return;
        }
        if (browser !== gBrowser.selectedBrowser) {
          return;
        }
        if (stateFlags & STATE_START) {
          scrollPositions.delete(browser);
          startLoader();

          colorRequestId++;
        } else if (stateFlags & STATE_STOP) {
          if (isErrorPage(browser)) {
            cancelLoader();
            showErrorColor();
          } else {
            finishLoader();
            scheduleColor(50);
            scheduleColor(800);
            scheduleColor(2000);
            scheduleColor(4500);
          }
          updateTitle();
        }
      },

      onProgressChange(browser, webProgress, request, curSelf, maxSelf, curTotal, maxTotal) {
        if (browser === gBrowser.selectedBrowser && maxTotal > 0) {
          reportRealProgress(curTotal / maxTotal);
        }
      },

      onLocationChange(browser, webProgress, request, location, flags) {
        if (!webProgress.isTopLevel) {
          return;
        }
        redirectBlankNewTab(browser, location, flags);

        if (flags & LOCATION_CHANGE_ERROR_PAGE) {
          errorBrowsers.add(browser);
        } else if (!(flags & LOCATION_CHANGE_SAME_DOCUMENT)) {
          errorBrowsers.delete(browser);
          scrollPositions.delete(browser);
        }
        if (browser !== gBrowser.selectedBrowser) {
          return;
        }
        if (flags & LOCATION_CHANGE_ERROR_PAGE) {
          cancelLoader();
          showErrorColor();
        } else if (flags & LOCATION_CHANGE_SAME_DOCUMENT) {
          scheduleColor(150);
        } else {
          const known = rememberedSiteColor(browser);
          if (known) {
            applyColor(known);
          }
        }
        updateTitle();
      },
    });

    new MutationObserver(updateTitle).observe(urlbar, {
      attributes: true,
      attributeFilter: ["pageproxystate"],
    });

    urlbar.addEventListener("mouseenter", rememberClosedText);
    urlbar.addEventListener(
      "mousedown",
      () => {
        rememberClosedText();
        clickedUrlbarAt = Date.now();
      },
      true
    );
    gBrowser.tabContainer.addEventListener("TabSelect", () => requestAnimationFrame(rememberClosedText));
    window.addEventListener("resize", () => requestAnimationFrame(rememberClosedText));
    setTimeout(rememberClosedText, 800);
    new MutationObserver(alignOpenedUrlbarSoon).observe(urlbar, {
      attributes: true,
      attributeFilter: ["breakout-extend"],
    });
    window.addEventListener("resize", alignOpenedUrlbarSoon);

    safely("keepWholeUrlSelected", () => keepWholeUrlSelected(urlbar));
    safely("addCopyLinkButton", addCopyLinkButton);
    safely("addToastCloseButtons", addToastCloseButtons);
    safely("suckInEssentialGlances", suckInEssentialGlances);
    safely("animateNavButtons", animateNavButtons);
    safely("springReloadHover", springReloadHover);
    afterStartup("watchExtensionIcons", watchExtensionIcons);
    safely("keepSidebarUnscrolledSideways", keepSidebarUnscrolledSideways);
    safely("watchRealtimeTint", watchRealtimeTint);
    safely("watchColorDrift", watchColorDrift);
    safely("watchPopUpColor", watchPopUpColor);
    safely("watchUnloadable", watchUnloadable);
    safely("watchPageFullscreen", watchPageFullscreen);
    safely("watchSwipeArrow", watchSwipeArrow);
    safely("revertTypedTextOnLeave", () => revertTypedTextOnLeave(urlbar));
    safely("neverShowScheme", neverShowScheme);

    updateColor();
    updateTitle();
  }

  const queueStart = () => {
    if (!startupStopped) {
      startupTimer = setTimeout(() => {
        startupTimer = 0;
        if (!startupStopped) {
          safely("start", start);
        }
      }, 0);
    }
  };
  if (window.gBrowserInit?.delayedStartupFinished) {
    queueStart();
  } else {
    const observer = (subject) => {
      if (subject === window) {
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
        queueStart();
      }
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  }
})();
