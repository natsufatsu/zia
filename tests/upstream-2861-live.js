const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const gb = win.gBrowser, root = doc.documentElement, results = {};
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
function check(ok, message) { if (!ok) throw new Error(message); }
async function waitFor(fn, name) {
  const end = Date.now() + 4500;
  while (Date.now() < end) { if (fn()) return; await delay(25); }
  throw new Error('Timed out: ' + name);
}
(async () => {
  const prefs = ['zia.sidebar.space-name-in-list', 'zia.sidebar.hide-space-name',
    'zia.tabs.no-glow', 'zia.essentials.two-per-row', 'zia.page.edge-to-edge', 'zia.swipe.dia-arrow'];
  const saved = prefs.map(key => ({key, had: Services.prefs.prefHasUserValue(key), value: Services.prefs.getBoolPref(key, false)}));
  const original = gb.selectedTab;
  const light = root.getAttribute('zen-should-be-dark-mode');
  let stripTab;
  try {
    check(doc.getElementById('zia-copy-link-button'), 'Late site-settings button did not recover the paperclip');
    check(win.__lateCopyRecovered, 'Missing site-settings startup case was not exercised');
    results.lateCopyRecovery = true;

    const indicator = win.gZenWorkspaces.activeWorkspaceElement.indicator;
    Services.prefs.setBoolPref('zia.sidebar.space-name-in-list', true);
    await waitFor(() => indicator.parentElement === win.gZenWorkspaces.activeWorkspaceElement,
      'workspace indicator returned above the tabs');
    check(root.hasAttribute('zia-space-name-in-list') && !root.hasAttribute('zia-workspace-slot'), 'Workspace location flags disagree');
    check(win.getComputedStyle(indicator).display !== 'none', 'Native workspace indicator was left hidden');
    Services.prefs.setBoolPref('zia.sidebar.space-name-in-list', false);
    await waitFor(() => indicator.parentElement?.id === 'zia-workspace-slot', 'workspace indicator restored to top row');
    Services.prefs.setBoolPref('zia.sidebar.hide-space-name', true);
    await delay(100);
    check(win.getComputedStyle(doc.querySelector('#zia-space-label .zia-space-name')).display === 'none', 'Hide-name setting does not hide name');
    Services.prefs.setBoolPref('zia.sidebar.hide-space-name', false);
    results.workspaceOptions = true;

    const background = original.querySelector('.tab-background');
    for (const value of ['true', 'false']) {
      root.setAttribute('zen-should-be-dark-mode', value);
      Services.prefs.setBoolPref('zia.tabs.no-glow', true);
      await delay(100);
      check(win.getComputedStyle(background).boxShadow === 'none', 'No-glow toggle failed on ' + value + ' sidebar');
      Services.prefs.setBoolPref('zia.tabs.no-glow', false);
      await delay(100);
      check(win.getComputedStyle(background).boxShadow !== 'none', 'Disabling no-glow did not restore selected-tab shadow');
    }
    if (light === null) root.removeAttribute('zen-should-be-dark-mode'); else root.setAttribute('zen-should-be-dark-mode', light);
    results.optionalGlow = true;
    Services.prefs.setBoolPref('zia.essentials.two-per-row', true);
    await delay(100);
    const grid = doc.querySelector('.zen-essentials-container');
    check(win.getComputedStyle(grid).gridTemplateColumns.split(' ').length === 2, 'Essentials option does not use two columns');
    Services.prefs.setBoolPref('zia.essentials.two-per-row', false);
    Services.prefs.setBoolPref('zia.page.edge-to-edge', true);
    await delay(100);
    check(win.getComputedStyle(root).getPropertyValue('--zia-card-gap').trim() === '0px', 'Edge-to-edge option kept page gap');
    Services.prefs.setBoolPref('zia.page.edge-to-edge', false);
    results.layoutOptions = true;

    const swipe = win.gHistorySwipeAnimation;
    check(swipe?.ziaWrapped, 'Swipe integration was not initialized');
    swipe.startAnimation();
    const event = new win.MouseEvent('MozSwipeGestureUpdate');
    const delta = swipe._willGoBack({event, delta: 0.3}) ? 0.3 : -0.3;
    results.swipeState = {canGoBack: swipe._canGoBack, canGoForward: swipe._canGoForward,
      delta, back: swipe._willGoBack({event, delta}), forward: swipe._willGoForward({event, delta}),
      history: gb.selectedBrowser.browsingContext.sessionHistory.count, active: swipe.active,
      container: !!gb.selectedBrowser.closest('.browserStack')};
    swipe.updateAnimation({event, delta});
    await waitFor(() => doc.getElementById('zia-swipe')?.hasAttribute('will'), 'swipe arrow');
    await waitFor(() => doc.getElementById('zia-swipe')?.hasAttribute('open'), 'held swipe history card');
    check(doc.querySelectorAll('#zia-swipe .zia-swipe-page').length > 0, 'Swipe card has no history rows');
    swipe.stopAnimation();
    win.dispatchEvent(new win.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    await delay(350);
    check(!doc.getElementById('zia-swipe'), 'Escape did not dismiss swipe card');
    results.swipeCard = true;

    const page = '<!doctype html><title>Thin strip</title><style>html,body{margin:0;background:rgb(30,40,50);min-height:300vh}.strip{height:8px;background:rgb(220,20,20)}</style><div class="strip"></div>';
    stripTab = gb.addTrustedTab('data:text/html,' + encodeURIComponent(page), {inBackground: false});
    gb.selectedTab = stripTab;
    const tint = () => root.style.getPropertyValue('--zia-site-bg');
    await waitFor(() => tint() === 'rgb(30, 40, 50)', 'thin-strip top-band colour');
    const samples = [];
    for (let i = 0; i < 30; i++) { samples.push(tint()); await delay(100); }
    check(samples.every(value => value === 'rgb(30, 40, 50)'), 'Idle checker and load sampler disagreed on top band');
    results.consistentTopBand = true;
    check(!win.__compatErrors.length, 'Mod errors: ' + win.__compatErrors.join('\n'));
  } finally {
    if (light === null) root.removeAttribute('zen-should-be-dark-mode'); else root.setAttribute('zen-should-be-dark-mode', light);
    gb.selectedTab = original;
    if (stripTab?.isConnected) gb.removeTab(stripTab, {animate: false});
    for (const item of saved) {
      if (item.had) Services.prefs.setBoolPref(item.key, item.value); else Services.prefs.clearUserPref(item.key);
    }
  }
})().then(() => done(results), error => done({...results, error: String(error), stack: error.stack}));
