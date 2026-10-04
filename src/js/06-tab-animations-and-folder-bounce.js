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
