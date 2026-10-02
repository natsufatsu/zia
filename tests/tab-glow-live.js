const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const gb = win.gBrowser, root = doc.documentElement;
const results = {tabs: [], splits: []};
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
function check(value, message) { if (!value) throw new Error(message); }
async function waitFor(fn, name) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (fn()) return;
    await delay(30);
  }
  throw new Error('Timed out: ' + name);
}
function decoration(element) {
  const style = win.getComputedStyle(element), shine = win.getComputedStyle(element, '::after');
  return {shadow: style.boxShadow, shine: shine.display, content: shine.content};
}
function assertGlow(value, name) {
  check(value.shadow !== 'none' && !value.shadow.includes('rgba(0, 0, 0, 0)'), name + ': missing glow: ' + value.shadow);
  check(value.shine !== 'none' && value.content !== 'none', name + ': missing border shine');
}
(async () => {
  const second = gb.selectedTab;
  const first = gb.addTrustedTab('about:blank', {inBackground: true});
  const pref = 'zia.tabs.favicon-glow';
  const hadPref = Services.prefs.prefHasUserValue(pref), savedPref = Services.prefs.getBoolPref(pref, false);
  const originalImage = second.getAttribute('image');
  const canvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  canvas.width = canvas.height = 16;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff3030'; context.fillRect(0, 0, 16, 16);
  const image = canvas.toDataURL();
  for (const tab of [first, second]) {
    tab.setAttribute('image', image);
    tab.dispatchEvent(new win.CustomEvent('TabAttrModified', {bubbles: true, detail: {changed: ['image']}}));
  }
  try {
    await delay(350);
    const rows = [...win.gZenWorkspaces.activeWorkspaceStrip.querySelectorAll('.tabbrowser-tab:not([zen-essential], [hidden])')]
      .filter(tab => tab.getBoundingClientRect().height > 4 && tab.checkVisibility());
    check(rows[0] === first, 'Test tab is not the first visible workspace row: ' + JSON.stringify({first: first.id, rows: rows.map(tab => ({id: tab.id, label: tab.label})), pinned: first.pinned}));
    check(root.getAttribute('zen-sidebar-expanded') === 'true', 'Test requires an expanded sidebar');
    for (const tinted of [false, true]) {
      Services.prefs.setBoolPref(pref, tinted);
      for (const [position, tab] of [['first', first], ['second', second]]) {
        gb.selectedTab = tab;
        await delay(300);
        if (tinted) await waitFor(() => tab.hasAttribute('zia-glow'), 'favicon palette');
        const background = tab.querySelector('.tab-background');
        const normal = decoration(background);
        assertGlow(normal, position + ' normal');
        for (const state of ['normal', 'playing', 'muted', 'playing-muted']) {
          tab.toggleAttribute('soundplaying', state.includes('playing'));
          tab.toggleAttribute('muted', state.includes('muted'));
          await delay(50);
          const value = decoration(background);
          assertGlow(value, position + ' ' + state);
          check(JSON.stringify(value) === JSON.stringify(normal), position + ' ' + state + ': audio changed the selection decoration');
          results.tabs.push({position, state, tinted, ...value});
        }
        tab.removeAttribute('soundplaying'); tab.removeAttribute('muted');
      }
    }
    // The selected tab glows as part of a single pill when split. Its first
    // row must also keep that decoration, whichever pane has focus.
    await win.gZenViewSplitter.splitTabs([first, second], 'vsep', 0);
    await waitFor(() => first.group?.hasAttribute('split-view-group'), 'first-row split');
    const group = first.group, container = group.querySelector('.tab-group-container');
    for (const tinted of [false, true]) {
      Services.prefs.setBoolPref(pref, tinted);
      for (const [pane, tab] of [['left', first], ['right', second]]) {
        gb.selectedTab = tab;
        await delay(300);
        if (tinted) await waitFor(() => group.hasAttribute('zia-glow'), 'split favicon palette');
        const normal = decoration(container);
        assertGlow(normal, 'first-row split ' + pane);
        tab.setAttribute('soundplaying', 'true'); tab.setAttribute('muted', 'true');
        await delay(50);
        const audio = decoration(container);
        check(JSON.stringify(audio) === JSON.stringify(normal), 'Audio changed the split glow');
        results.splits.push({pane, tinted, ...audio});
        tab.removeAttribute('soundplaying'); tab.removeAttribute('muted');
      }
    }
    check(win.__compatErrors.length === 0, 'Mod errors: ' + win.__compatErrors.join('; '));
  } finally {
    if (first.splitView) win.gZenViewSplitter.unsplitCurrentView();
    for (const tab of [first, second]) {
      tab.removeAttribute('soundplaying'); tab.removeAttribute('muted');
    }
    if (originalImage === null) second.removeAttribute('image');
    else second.setAttribute('image', originalImage);
    gb.selectedTab = second;
    gb.removeTab(first, {animate: false});
    if (hadPref) Services.prefs.setBoolPref(pref, savedPref);
    else Services.prefs.clearUserPref(pref);
  }
  done(results);
})().catch(error => done({...results, error: String(error), stack: error.stack}));
