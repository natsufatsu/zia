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
