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
