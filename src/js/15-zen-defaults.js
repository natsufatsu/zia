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
    tidyMenuSeparators();
  }

  // The toolbar's right-click menu without a separator next to another, or at either end:
  // Zen hides Set Profile with no profiles to pick, but not the separator after it, so the
  // sidebar's foot showed two in a row (thanks Poumpky). Run once Zen and Firefox have
  // shown and hidden their items (the event bubbles to the window after them).
  function tidyMenuSeparators() {
    window.addEventListener("popupshowing", (event) => {
      const menu = event.target;
      if (menu.id !== "toolbar-context-menu") {
        return;
      }
      for (const el of menu.querySelectorAll(":scope > menuseparator[zia-tidied]")) {
        el.hidden = false;
        el.removeAttribute("zia-tidied");
      }
      const shown = [...menu.children].filter((el) => !el.hidden && !el.collapsed && getComputedStyle(el).display !== "none");
      let last = null;
      for (const el of shown) {
        if (el.localName === "menuseparator" && (!last || last.localName === "menuseparator")) {
          el.hidden = true;
          el.setAttribute("zia-tidied", "true");
          continue;
        }
        last = el;
      }
      if (last?.localName === "menuseparator") {
        last.hidden = true;
        last.setAttribute("zia-tidied", "true");
      }
    });
  }
