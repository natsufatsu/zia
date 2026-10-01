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

  function watchEdgeGlow() {
    let pending = 0;
    let settled = 0;
    let marked = null;
    const mark = (next) => {
      if (next === marked) {
        return;
      }
      marked?.removeAttribute("zia-no-glow");
      marked = next;
      marked?.setAttribute("zia-no-glow", "true");
    };
    const update = () => {
      pending = 0;
      if (!gBrowser?.selectedTab) {
        return;
      }
      const tab = gBrowser.selectedTab;
      if (!tab || tab.hasAttribute("zen-essential")) {
        mark(null);
        return;
      }
      // (a split glows as a whole: at the top, it's the split that goes
      // without, whichever of its tabs is open)
      const split = tab.group?.hasAttribute?.("split-view-group") ? tab.group : null;
      const glowing = split || tab;

      const sections = [
        window.gZenWorkspaces?.pinnedTabsContainer,
        window.gZenWorkspaces?.activeWorkspaceStrip,
      ].filter(Boolean);
      if (sections.length) {
        let first = null;
        for (const section of sections) {
          for (const row of section.querySelectorAll(
            ".tabbrowser-tab:not([zen-essential], [zen-empty-tab], [hidden]), .tab-group-label-container"
          )) {
            const box = row.getBoundingClientRect();
            if (box.height > 4 && row.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false) {
              first = row;
              break;
            }
          }
          if (first) {
            break;
          }
        }
        mark(first === tab || (split && first && split.contains(first)) ? glowing : null);
        return;
      }
      const mine = glowing.getBoundingClientRect();
      if (!mine.height) {
        mark(null);
        return;
      }
      let above = false;
      for (const row of document.querySelectorAll(
        "#tabbrowser-tabs .tabbrowser-tab:not([zen-essential], [zen-empty-tab], [hidden]), #tabbrowser-tabs .tab-group-label-container"
      )) {
        if (row === tab || (split && split.contains(row))) {
          continue;
        }
        const box = row.getBoundingClientRect();

        if (!box.height || !box.width || box.right <= mine.left || box.left >= mine.right) {
          continue;
        }
        if (row.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) {
          continue;
        }
        if (box.bottom <= mine.top + 1) {
          above = true;
          break;
        }
      }
      mark(!above ? glowing : null);
    };
    const schedule = () => {
      if (!pending) {
        pending = requestAnimationFrame(update);
      }
    };
    const soon = () => {
      schedule();
      clearTimeout(settled);
      settled = setTimeout(schedule, 250);
    };
    for (const type of [
      "TabSelect", "TabOpen", "TabClose", "TabMove", "TabPinned", "TabUnpinned", "TabGrouped",
      "TabUngrouped", "TabGroupCollapse", "TabGroupExpand", "TabShow", "TabHide",
    ]) {
      gBrowser.tabContainer.addEventListener(type, soon);
    }
    window.addEventListener("dragend", soon, true);
    window.addEventListener("resize", soon);
    window.addEventListener("ZenWorkspacesUIUpdate", soon);
    gBrowser.tabContainer.addEventListener("transitionend", schedule);
    gBrowser.tabContainer.addEventListener("animationend", schedule);
    const changes = new MutationObserver(soon);
    changes.observe(gBrowser.tabContainer, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["hidden", "collapsed", "split-view-group"],
    });
    Services.prefs.addObserver("zen.workspaces.active", soon);
    window.addEventListener("unload", () => {
      cancelAnimationFrame(pending);
      clearTimeout(settled);
      changes.disconnect();
      Services.prefs.removeObserver("zen.workspaces.active", soon);
    }, { once: true });
    soon();
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
    safely("watchEdgeGlow", watchEdgeGlow);
    afterStartup("watchExtensionIcons", watchExtensionIcons);
    safely("keepSidebarUnscrolledSideways", keepSidebarUnscrolledSideways);
    safely("watchColorDrift", watchColorDrift);
    safely("watchPopUpColor", watchPopUpColor);
    safely("watchUnloadable", watchUnloadable);
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
