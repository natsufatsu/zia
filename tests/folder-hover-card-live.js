const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const gb = win.gBrowser, root = doc.documentElement, toolbox = doc.getElementById('navigator-toolbox');
const results = {positions: []}, folders = [];
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
const check = (ok, message) => { if (!ok) throw new Error(message); };
async function snapshot(card) {
  const box = card.getBoundingClientRect();
  const bitmap = await win.browsingContext.currentWindowGlobal.drawSnapshot(
    new win.DOMRect(box.x, box.y, box.width, box.height), 2, '#202020');
  const canvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.toDataURL().split(',')[1];
}
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
  if (card.contains(doc.activeElement)) doc.activeElement.blur();
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
      const tabs = Array.from({length: size}, (_, i) => gb.addTrustedTab('about:blank#folder-tab-' + i, {inBackground: true}));
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
          const add = card.querySelector('[zia-new-tab]'), rowBox = rows[0].getBoundingClientRect();
          const addBox = add.getBoundingClientRect();
          check(Math.abs(addBox.height - rowBox.height) < 1, 'New Tab row is taller than tab rows');
          check(win.getComputedStyle(add).fontSize === win.getComputedStyle(rows[0]).fontSize, 'New Tab text size differs from tabs');
          check(addBox.left === rowBox.left && addBox.width === rowBox.width, 'New Tab row horizontal alignment differs from tabs');
          const field = card.querySelector('.zia-folder-card-search-field'), search = card.querySelector('.zia-folder-card-search');
          check(win.getComputedStyle(search).borderRadius === '0px' && win.getComputedStyle(search).borderTopWidth === '0px',
            'Native search input pill returned');
          check(win.getComputedStyle(field).borderRadius === '8px', 'Search field lost reference corner radius');
          if (size === 2) {
            const gap = rows[1].getBoundingClientRect().top - rowBox.bottom;
            check(Math.abs(addBox.top - rows[1].getBoundingClientRect().bottom - gap) < 1,
              'Extra space separates New Tab from folder tabs');
          }
          if (size === 12) {
            const list = card.querySelector('.zia-folder-card-list');
            check(list.scrollHeight > list.clientHeight, 'Long folder preview does not scroll');
            const add = card.querySelector('[zia-new-tab]'), searchBar = card.querySelector('.zia-folder-card-search-bar');
            check(!list.contains(add), 'New Tab still belongs to the scrolling list');
            const addTop = add.getBoundingClientRect().top, searchTop = searchBar.getBoundingClientRect().top;
            list.scrollTop = list.scrollHeight;
            await delay(30);
            check(Math.abs(add.getBoundingClientRect().top - addTop) < 1, 'New Tab moves when tabs scroll');
            check(Math.abs(searchBar.getBoundingClientRect().top - searchTop) < 1, 'Search moves when tabs scroll');
            check(add.getBoundingClientRect().bottom <= box.bottom, 'New Tab extends below preview');
            list.scrollTop = 0;
          }
          results.positions.push({size, right, top: box.top, height: box.height});
          if (!right && top === 10) {
            results.screenshots ||= {};
            results.screenshots['folder-' + size] = await snapshot(card);
          }
          await leave(card);
        }
      }
    }
    results.fixedSearchAndFooter = true;
    Services.prefs.setBoolPref(side, false);
    await delay(150);
    // about:blank's initial title update can replace labels during the long placement check.
    [...folders[1].tabs].filter(tab => !tab.hasAttribute('zen-empty-tab'))
      .forEach((tab, i) => tab.label = 'Folder tab ' + i);
    let searchedCard = await hover(folders[1], 100);
    const search = searchedCard.querySelector('.zia-folder-card-search');
    const list = searchedCard.querySelector('.zia-folder-card-list');
    const footerTop = searchedCard.querySelector('[zia-new-tab]').getBoundingClientRect().top;
    const visibleRows = () => [...list.querySelectorAll('.zia-folder-card-row:not([hidden])')];
    const query = value => { search.value = value; search.dispatchEvent(new win.Event('input', {bubbles: true})); };
    query('fOlDeR TaB 1');
    check(visibleRows().length === 3, 'Case-insensitive title search failed');
    check(Math.abs(searchedCard.querySelector('[zia-new-tab]').getBoundingClientRect().top - footerTop) < 1,
      'Search results moved the fixed footer');
    query('about:blank');
    check(visibleRows().length === 12, 'URL search failed');
    query('no-such-tab');
    check(visibleRows().length === 0 && !list.querySelector('.zia-folder-card-empty').hidden, 'No-results state missing');
    check(!searchedCard.querySelector('[zia-new-tab]').hidden, 'Search hid New Tab');
    search.focus();
    currentLabel.dispatchEvent(new win.MouseEvent('mouseout', {bubbles: true}));
    searchedCard.dispatchEvent(new win.MouseEvent('mouseleave'));
    await delay(350);
    check(!searchedCard.hidden && doc.activeElement === search && toolbox.hasAttribute('has-popup-menu'),
      'Typing search loses preview or compact sidebar');
    query('folder tab 11');
    const selectedResult = visibleRows()[0].ziaTab;
    const copy = searchedCard.querySelector('.zia-folder-card-copy');
    const expectedURLs = folders[1].tabs.filter(tab => !tab.closing && !tab.hasAttribute('zen-empty-tab'))
      .map(tab => tab.linkedBrowser.currentURI.spec);
    copy.click();
    const copiedURLs = await win.navigator.clipboard.readText();
    check(expectedURLs.length === 12 && new Set(expectedURLs).size === 12, 'Copy fixture lost distinct folder URLs');
    check(copiedURLs === expectedURLs.join('\n'), 'Copy links did not include every tab in folder order while filtered');
    check(copy.textContent === 'Copied' && !searchedCard.hidden && search.value === 'folder tab 11', 'Copy feedback changed search or hid preview');
    results.copyAllLinks = true;
    for (const key of ['Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const event = new win.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});
      search.dispatchEvent(event);
      check(!event.defaultPrevented && gb.selectedTab === start, 'Preview intercepted search key: ' + key);
    }
    check(search.value === 'folder tab 11', 'Preview shortcut changed search text');
    check(search.tabIndex === -1 && copy.tabIndex === -1 && searchedCard.querySelector('[zia-new-tab]').tabIndex === -1 && list.tabIndex === -1,
      'Preview controls entered normal Tab traversal');
    visibleRows()[0].click();
    check(gb.selectedTab === selectedResult, 'Click did not select filtered result');
    gb.selectedTab = start;
    await leave(searchedCard);
    searchedCard = await hover(folders[1], 100);
    check(searchedCard.querySelector('.zia-folder-card-search').value === '', 'Search did not reset after reopening');
    await leave(searchedCard);
    results.search = {titles: true, urls: true, empty: true, focus: true, mouseSelection: true, keysUnchanged: true, reset: true};
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
    const retainedSearch = card.querySelector('.zia-folder-card-search');
    retainedSearch.value = muted.label;
    retainedSearch.dispatchEvent(new win.Event('input', {bubbles: true}));
    retainedSearch.focus();
    muteRow.querySelector('[zia-act="mute"]').click();
    check(!muted.hasAttribute('muted'), 'Preview mute action did not unmute its tab');
    await waitFor(() => ![...card.querySelectorAll('.zia-folder-card-row')]
      .find(row => row.ziaTab === muted)?.querySelector('[zia-act="mute"]'), 'mute row refresh');
    results.muteAction = true;
    check(card.querySelector('.zia-folder-card-search') === retainedSearch &&
      retainedSearch.value === muted.label && doc.activeElement === retainedSearch, 'Control refresh reset search or its focus');
    retainedSearch.value = '';
    retainedSearch.dispatchEvent(new win.Event('input', {bubbles: true}));
    results.searchSurvivesRefresh = true;
    // Moving into the preview keeps it and the compact sidebar open.
    win.InspectorUtils.addPseudoClassLock(card, ':hover');
    card.dispatchEvent(new win.MouseEvent('mouseenter'));
    currentLabel.dispatchEvent(new win.MouseEvent('mouseout', {bubbles: true, relatedTarget: card}));
    await delay(350);
    check(!card.hidden && toolbox.hasAttribute('has-popup-menu'), 'Card entry lost preview or compact sidebar');
    results.cardEntry = true;
    // Skip native popup setup before it can install document keyboard hooks.
    const keyListeners = () => Services.els.getListenerInfoFor(doc).filter(info =>
      info.type === 'keydown' && String(info.listenerObject).includes('folders-tabs-list-item[selected]')).length;
    const beforeKeys = keyListeners();
    for (let attempt = 0; attempt < 3; attempt++) {
      win.gZenFolders.openTabsPopup({target: currentLabel, stopPropagation() {}});
    }
    await delay(100);
    check(doc.getElementById('zen-folder-tabs-popup').state === 'closed', 'Duplicate native preview opened');
    check(win.gZenFolders.openTabsPopup.ziaOriginalFolderPopup === win.__nativeTabMethods.folderPopup, 'Native popup fallback lost');
    check(keyListeners() === beforeKeys, 'Suppressed native previews leaked document keyboard handlers');
    for (const key of ['Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const event = new win.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});
      doc.dispatchEvent(event);
      check(!event.defaultPrevented && gb.selectedTab === start, 'Hidden native preview intercepted browser key: ' + key);
    }
    results.noLeakedKeyboardHandlers = true;
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
    await waitFor(() => internal.linkedBrowser.isRemoteBrowser === false &&
      internal.linkedBrowser.currentURI?.spec === 'about:preferences' &&
      internal.linkedBrowser.contentDocument?.readyState === 'complete', 'non-unloadable folder tab');
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
