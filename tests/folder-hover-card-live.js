const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const gb = win.gBrowser, root = doc.documentElement, toolbox = doc.getElementById('navigator-toolbox');
const results = {positions: []}, folders = [];
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
const check = (ok, message) => { if (!ok) throw new Error(message); };
async function waitFor(fn, name) {
  const end = Date.now() + 2500;
  while (Date.now() < end) { if (fn()) return; await delay(30); }
  throw new Error('Timed out: ' + name);
}
const pref = 'zia.features.tab-hover-cards', side = 'zen.tabs.vertical.right-side';
const hadPref = Services.prefs.prefHasUserValue(pref), savedPref = Services.prefs.getBoolPref(pref, true);
const hadSide = Services.prefs.prefHasUserValue(side), savedSide = Services.prefs.getBoolPref(side, false);
const revealed = toolbox.hasAttribute('zen-user-show'), start = gb.selectedTab;
let currentLabel = null;
async function hover(folder, top) {
  const label = folder.querySelector('.tab-group-label-container');
  label.style.cssText = 'position:fixed!important;left:8px;top:0!important;width:164px;z-index:1000';
  label.style.setProperty('translate', '0 ' + (top - label.getBoundingClientRect().top) + 'px', 'important');
  currentLabel = label;
  win.InspectorUtils.addPseudoClassLock(label, ':hover');
  label.dispatchEvent(new win.MouseEvent('mouseover', {bubbles: true}));
  await waitFor(() => {
    const card = doc.getElementById('zia-folder-card');
    return card && !card.hidden && card.ziaFolder === folder && !card.hasAttribute('zia-closing');
  }, 'collapsed folder hover card');
  await delay(280);
  return doc.getElementById('zia-folder-card');
}
async function leave(card) {
  if (currentLabel) {
    win.InspectorUtils.removePseudoClassLock(currentLabel, ':hover');
    currentLabel.dispatchEvent(new win.MouseEvent('mouseout', {bubbles: true}));
    currentLabel = null;
  }
  win.InspectorUtils.removePseudoClassLock(card, ':hover');
  card.dispatchEvent(new win.MouseEvent('mouseleave'));
  await waitFor(() => card.hidden, 'hover card dismissal');
}
(async () => {
  try {
    Services.prefs.setBoolPref(pref, true);
    await waitFor(() => Services.els.getListenerInfoFor(toolbox).some(info =>
      info.type === 'mouseover' && String(info.listenerObject).includes('hoveredFolderLabel')), 'hover-card startup');
    toolbox.setAttribute('zen-user-show', 'true');
    await delay(400);
    for (const size of [2, 12]) {
      const tabs = Array.from({length: size}, () => gb.addTrustedTab('about:blank', {inBackground: true}));
      tabs.forEach((tab, i) => tab.label = 'Folder tab ' + i);
      const folder = await win.gZenFolders.createFolder(tabs, {label: 'Hover ' + size, renameFolder: false});
      folders.push(folder);
      gb.selectedTab = start;
      await delay(150);
      folder.collapsed = true;
      for (const right of [false, true]) {
        Services.prefs.setBoolPref(side, right);
        await waitFor(() => win.gZenVerticalTabsManager._prefsRightSide === right, 'sidebar side');
        await delay(100);
        folder.collapsed = true;
        await delay(50);
        for (const top of [10, Math.round(win.innerHeight / 2), win.innerHeight - 48]) {
          const card = await hover(folder, top), box = card.getBoundingClientRect();
          const anchor = currentLabel.getBoundingClientRect(), sidebar = toolbox.getBoundingClientRect();
          const rows = [...card.querySelectorAll('.zia-folder-card-row:not([zia-new-tab])')];
          check(rows.length === size && rows.every((row, i) => row.ziaTab === tabs[i]), 'Folder tabs missing or reordered');
          check(box.top >= 0 && box.bottom <= win.innerHeight + 1, 'Hover card exceeds window height');
          check(right ? box.right <= sidebar.left + 1 : box.left >= sidebar.right - 1, 'Hover card on wrong side');
          check(box.top <= anchor.top + 1 && box.bottom >= anchor.bottom - 1, 'Hover card displaced from folder');
          if (top === 10) check(box.top <= 10, 'High folder card was displaced downwards');
          check(card.querySelector('[zia-new-tab]'), 'New Tab action missing');
          if (size === 12) {
            const list = card.querySelector('.zia-folder-card-list');
            check(list.scrollHeight > list.clientHeight, 'Long folder preview does not scroll');
          }
          results.positions.push({size, right, top: box.top, height: box.height});
          await leave(card);
        }
      }
    }
    const folder = folders[0];
    Services.prefs.setBoolPref(side, false);
    await delay(150);
    const muted = [...folder.tabs].find(tab => !tab.hidden && !tab.hasAttribute('zen-empty-tab'));
    check(muted, 'No visible folder tab for mute control');
    muted.toggleMuteAudio();
    check(muted.hasAttribute('muted'), 'Could not mute preview fixture');
    let card = await hover(folder, 100);
    const muteRow = [...card.querySelectorAll('.zia-folder-card-row')].find(row => row.ziaTab === muted);
    check(muteRow, 'Muted tab missing from folder preview');
    muteRow.querySelector('[zia-act="mute"]').click();
    check(!muted.hasAttribute('muted'), 'Preview mute action did not unmute its tab');
    await waitFor(() => ![...card.querySelectorAll('.zia-folder-card-row')]
      .find(row => row.ziaTab === muted)?.querySelector('[zia-act="mute"]'), 'mute row refresh');
    results.muteAction = true;
    // Moving into the preview keeps it and the compact sidebar open.
    win.InspectorUtils.addPseudoClassLock(card, ':hover');
    card.dispatchEvent(new win.MouseEvent('mouseenter'));
    currentLabel.dispatchEvent(new win.MouseEvent('mouseout', {bubbles: true, relatedTarget: card}));
    await delay(350);
    check(!card.hidden && toolbox.hasAttribute('has-popup-menu'), 'Card entry lost preview or compact sidebar');
    results.cardEntry = true;
    // Zen's own method is unchanged, but its popup must not cover Zia's card.
    win.gZenFolders.openTabsPopup({target: currentLabel, stopPropagation() {}});
    await delay(100);
    check(doc.getElementById('zen-folder-tabs-popup').state === 'closed', 'Duplicate native preview opened');
    check(win.gZenFolders.openTabsPopup === win.__nativeTabMethods.folderPopup, 'Native folder method replaced');
    results.noDuplicatePopup = true;
    const picked = card.querySelector('.zia-folder-card-row:not([zia-new-tab])');
    picked.click();
    check(gb.selectedTab === picked.ziaTab, 'Clicking preview did not select its tab');
    gb.selectedTab = start;
    await leave(card);
    card = await hover(folder, 100);
    card.querySelector('[zia-new-tab]').click();
    const added = gb.selectedTab;
    check(added !== start && added.closest('zen-folder') === folder, 'New Tab was not added inside the native folder');
    results.tabSelection = true;
    results.newTabInFolder = true;
    gb.selectedTab = start;
    await leave(card);
    const internal = gb.addTrustedTab('about:preferences', {inBackground: true});
    folder.addTabs([internal]);
    await waitFor(() => internal.linkedBrowser.isRemoteBrowser === false, 'non-unloadable folder tab');
    gb.selectedTab = start;
    await delay(200);
    folder.collapsed = true;
    await delay(50);
    card = await hover(folder, 100);
    const closeRow = [...card.querySelectorAll('.zia-folder-card-row')].find(row => row.ziaTab === internal);
    check(closeRow, 'Internal folder tab missing from preview');
    closeRow.querySelector('[zia-act="close"]').click();
    await waitFor(() => !internal.isConnected, 'close action');
    results.closeAction = true;
    Services.prefs.setBoolPref(pref, false);
    await waitFor(() => card.hidden, 'disabled preview dismissal');
    results.disabledDismissal = true;
    check(!toolbox.hasAttribute('has-popup-menu'), 'Sidebar remained held after dismissing preview');
    check(!folder.hasAttribute('zia-folder-color') && !doc.querySelector('.zia-folder-close'), 'Native folder styling changed');
    check(win.__compatErrors.length === 0, 'Mod errors: ' + win.__compatErrors.join('; '));
  } finally {
    if (currentLabel) win.InspectorUtils.removePseudoClassLock(currentLabel, ':hover');
    const card = doc.getElementById('zia-folder-card');
    if (card) win.InspectorUtils.removePseudoClassLock(card, ':hover');
    if (hadPref) Services.prefs.setBoolPref(pref, savedPref); else Services.prefs.clearUserPref(pref);
    if (hadSide) Services.prefs.setBoolPref(side, savedSide); else Services.prefs.clearUserPref(side);
    gb.selectedTab = start;
    for (const folder of folders) await folder.delete();
    if (!revealed) toolbox.removeAttribute('zen-user-show');
    // Pair synthetic entry events with a native sidebar exit before the next check.
    toolbox.dispatchEvent(new win.MouseEvent('mouseleave', {relatedTarget: doc.getElementById('browser')}));
    await delay(400);
  }
  done(results);
})().catch(error => done({...results, error: String(error), stack: error.stack}));
