const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const gb = win.gBrowser, popup = doc.getElementById('zen-folder-tabs-popup');
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
const results = {positions: []};
function check(value, message) { if (!value) throw new Error(message); }
async function waitFor(fn, name) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if (fn()) return;
    await delay(30);
  }
  throw new Error('Timed out: ' + name);
}
async function open(folder, top) {
  const label = folder.querySelector('.tab-group-label-container');
  label.style.cssText = 'position:fixed!important;left:8px;top:0!important;width:164px;z-index:1000';
  label.style.setProperty('translate', '0 ' + (top - label.getBoundingClientRect().top) + 'px', 'important');
  await delay(50);
  doc.activeElement?.blur();
  win.gZenFolders.openTabsPopup({target: label, stopPropagation() {}});
  await waitFor(() => popup.state === 'open', 'folder preview');
  await delay(50);
  return {anchor: label.getBoundingClientRect().toJSON(), popup: popup.getBoundingClientRect().toJSON(),
    screen: popup.getOuterScreenRect().toJSON(), count: doc.getElementById('zen-folder-tabs-list').children.length};
}
async function close() {
  popup.hidePopup();
  await waitFor(() => popup.state === 'closed', 'preview close');
}
(async () => {
  const folders = [];
  const toolbox = doc.getElementById('navigator-toolbox');
  const compact = doc.documentElement.getAttribute('zen-compact-mode') === 'true';
  const wasRevealed = toolbox.hasAttribute('zen-user-show');
  const sidePref = 'zen.tabs.vertical.right-side';
  const hadSide = Services.prefs.prefHasUserValue(sidePref), savedSide = Services.prefs.getBoolPref(sidePref, false);
  const savedFlip = popup.getAttribute('flip');
  const nativeOpen = win.__nativeTabMethods.folderPopup;
  const featurePref = 'zia.features.tab-hover-cards';
  const hadFeature = Services.prefs.prefHasUserValue(featurePref), savedFeature = Services.prefs.getBoolPref(featurePref, true);
  check(savedFlip === 'slide', 'Folder preview must slide at screen edges');
  check(win.gZenFolders.openTabsPopup === nativeOpen, 'Native folder popup method was replaced');
  try {
    // Disabling Zia's cards restores the native searchable folder popup.
    Services.prefs.setBoolPref(featurePref, false);
    if (compact) {
      toolbox.setAttribute('zen-user-show', 'true');
      await delay(400);
    }
    for (const size of [2, 8]) {
      const tabs = Array.from({length: size}, () => gb.addTrustedTab('about:blank', {inBackground: true}));
      const folder = await win.gZenFolders.createFolder(tabs, {label: 'Preview ' + size, renameFolder: false});
      folders.push(folder);
      folder.collapsed = true;
      for (const right of [false, true]) {
        Services.prefs.setBoolPref(sidePref, right);
        await delay(300);
        await waitFor(() => win.gZenVerticalTabsManager._prefsRightSide === right, 'sidebar side');
        for (const top of [10, Math.round(win.innerHeight / 2), win.innerHeight - 48]) {
          const value = await open(folder, top);
          check(value.count === size, 'Native folder contents changed');
          check(value.screen.top >= win.screen.availTop - 1 && value.screen.bottom <= win.screen.availTop + win.screen.availHeight + 1,
            'Preview extends beyond the screen');
          check(right ? value.popup.right <= value.anchor.left + 1 : value.popup.left >= value.anchor.right - 1,
            'Preview is on the wrong side of its folder');
          check(value.popup.top <= value.anchor.top + 1 && value.popup.bottom >= value.anchor.bottom - 1,
            'Preview no longer overlaps its folder vertically');
          if (top === 10) check(value.popup.top < value.anchor.top, 'High-folder preview was displaced downward');
          if (top === Math.round(win.innerHeight / 2))
            check(value.popup.top < value.anchor.top - 20, 'Middle-folder preview lost its normal upward offset');
          results.positions.push({size, right, top, ...value});
          // Search still filters native items and resets when dismissed.
          const search = doc.getElementById('zen-folder-tabs-list-search');
          search.value = 'no such preview tab';
          search.dispatchEvent(new win.Event('input', {bubbles: true}));
          check([...doc.getElementById('zen-folder-tabs-list').children].every(item => item.hidden), 'Native search failed');
          await close();
          check(search.value === '', 'Search did not reset on dismissal');
        }
        if (size === 8 && !right) {
          // Re-enable the original arrow-panel policy to prove the regression
          // case: its negative offset flips down when the top is offscreen.
          popup.setAttribute('flip', 'both');
          results.original = await open(folder, 10);
          check(results.original.popup.top > results.original.anchor.bottom + 50, 'Original displacement was not reproduced');
          await close();
          popup.setAttribute('flip', savedFlip);
        }
      }
    }
    check(win.__compatErrors.length === 0, 'Mod errors: ' + win.__compatErrors.join('; '));
    results.nativeSearch = true;
    results.nativePopupMethod = true;
  } finally {
    popup.hidePopup();
    popup.setAttribute('flip', savedFlip);
    if (hadSide) Services.prefs.setBoolPref(sidePref, savedSide);
    else Services.prefs.clearUserPref(sidePref);
    if (hadFeature) Services.prefs.setBoolPref(featurePref, savedFeature);
    else Services.prefs.clearUserPref(featurePref);
    for (const folder of folders) await folder.delete();
    if (compact && !wasRevealed) toolbox.removeAttribute('zen-user-show');
  }
  done(results);
})().catch(error => done({...results, error: String(error), stack: error.stack}));
