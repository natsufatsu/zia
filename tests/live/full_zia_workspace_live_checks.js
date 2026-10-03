const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const root = doc.documentElement, toolbox = doc.getElementById('navigator-toolbox');
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
const results = {};
function snapshot() {
  const slot = doc.getElementById('zia-workspace-slot');
  const row = doc.getElementById('zen-sidebar-top-buttons');
  const parents = [];
  for (let node = row; node; node = node.parentElement) parents.push(node.id || node.localName);
  return {compact: root.getAttribute('zen-compact-mode'),
    panelOpen: root.getAttribute('zia-panel-open'),
    slotVisible: slot.checkVisibility({visibilityProperty: true, opacityProperty: true}),
    rowVisible: row.checkVisibility({visibilityProperty: true, opacityProperty: true}),
    slotBox: slot.getBoundingClientRect().toJSON(), parents,
    slotInSidebar: toolbox.contains(slot),
    rowVisibility: win.getComputedStyle(row).visibility,
    titlebarVisibility: win.getComputedStyle(doc.getElementById('titlebar')).visibility};
}
(async () => {
  await delay(700);
  results.hidden = snapshot();
  // Inspect both states before asserting so a failure records the placement.
  toolbox.setAttribute('zen-user-show', 'true');
  await delay(700);
  results.revealed = snapshot();
  toolbox.removeAttribute('zen-user-show');
  await delay(700);
  results.hiddenAgain = snapshot();
  if (results.hidden.slotVisible || results.hiddenAgain.slotVisible)
    throw new Error('Workspace indicator leaks beside the URL bar with the compact sidebar hidden');
  if (!results.revealed.slotInSidebar || !results.revealed.slotVisible)
    throw new Error('Workspace indicator must remain visible inside the revealed sidebar');
  win.gZenCompactModeManager.preference = false;
  await delay(700);
  results.normal = snapshot();
  if (!results.normal.slotInSidebar || !results.normal.slotVisible)
    throw new Error('Workspace indicator did not return to the normal sidebar');
  win.gZenCompactModeManager.preference = true;
  await delay(700);
  results.toggledHidden = snapshot();
  if (results.toggledHidden.slotVisible || !results.toggledHidden.slotInSidebar)
    throw new Error('Workspace indicator leaks after compact mode is toggled on');
  // Reproduce a later toolbar layout update moving the titlebar to the
  // address-bar row. The sidebar's top buttons must not follow it there.
  const titlebar = doc.getElementById('titlebar');
  const parent = titlebar.parentNode, next = titlebar.nextSibling;
  doc.getElementById('nav-bar').prepend(titlebar);
  titlebar.style.visibility = 'visible';
  await delay(300);
  results.reparentedHidden = snapshot();
  if (!results.reparentedHidden.slotInSidebar || results.reparentedHidden.slotVisible)
    throw new Error('A later toolbar layout update moved the workspace indicator into the address-bar row');
  toolbox.setAttribute('zen-user-show', 'true');
  await delay(700);
  results.reparentedRevealed = snapshot();
  if (!results.reparentedRevealed.slotInSidebar || !results.reparentedRevealed.slotVisible)
    throw new Error('Workspace indicator is missing from the revealed sidebar after a toolbar layout update');
  parent.insertBefore(titlebar, next);
  titlebar.style.removeProperty('visibility');
  toolbox.removeAttribute('zen-user-show');
  win.gZenCompactModeManager.preference = false;
  await delay(700);
  win.gZenCompactModeManager.hideToolbar();
  win.gZenCompactModeManager.preference = true;
  await delay(700);
  results.toolbarOnly = snapshot();
  if (!results.toolbarOnly.slotInSidebar || !results.toolbarOnly.slotVisible)
    throw new Error('Toolbar-only compact mode unexpectedly hides the sidebar workspace indicator');
  win.gZenCompactModeManager.preference = false;
  await delay(700);
  win.gZenCompactModeManager.hideSidebar();
  done(results);
})().catch(error => done({...results, error: String(error), stack: error.stack}));
