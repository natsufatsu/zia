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

