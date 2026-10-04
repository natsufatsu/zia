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
