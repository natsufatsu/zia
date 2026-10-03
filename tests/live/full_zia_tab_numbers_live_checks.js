const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const root = doc.documentElement, gb = win.gBrowser;
const results = {};
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
const check = (ok, message) => {if (!ok) throw new Error(message);};
function badge(tab = gb.selectedTab) {return tab.querySelector('.zia-tab-number');}
function state() {
  const node = badge();
  return {held: root.hasAttribute('zia-tab-numbers'),
    display: node ? win.getComputedStyle(node).display : null,
    text: node?.textContent ?? null};
}
function key(type, key, code, held) {
  win.dispatchEvent(new win.KeyboardEvent(type, {key, code,
    ctrlKey: held, bubbles: true, cancelable: true}));
}
(async () => {
  // Inject into Zen's chrome window to exercise the actual handlers and
  // computed CSS. This checks the UI, rather than operating-system key hooks.
  key('keydown', 'Control', 'ControlLeft', true);
  results.ctrlDown = state();
  key('keyup', 'Control', 'ControlLeft', false);
  results.releaseAnimation = root.hasAttribute('zia-tab-numbers-leaving');
  await delay(160);
  results.ctrlUp = state();
  check(results.ctrlDown.held && results.ctrlDown.text !== null, 'Holding Ctrl did not create numbered badges');
  check(!results.ctrlUp.held, 'The Ctrl release handler did not clear the held state');
  check(results.ctrlUp.display === 'none', 'Badge remains visible after Ctrl release despite the held state being cleared');
  check(results.ctrlDown.display === 'grid', 'Held badges did not use the imported outlined-key styling');
  const start = gb.selectedTab;
  for (let i = 0; i < 3; i++) {
    key('keydown', 'Control', 'ControlLeft', true);
    check(state().display === 'grid', 'Badges missing on repeated Ctrl press');
    key('keyup', 'Control', 'ControlLeft', false);
    await delay(160);
    check(state().display === 'none' && gb.selectedTab === start, 'Ctrl alone changed tabs or left badges visible');
  }
  results.repeatedPressRelease = true;
  const second = gb.addTrustedTab('about:blank', {inBackground: true});
  await delay(250);
  key('keydown', 'Control', 'ControlLeft', true);
  const targetNumber = badge(second).textContent;
  for (const digit of targetNumber) {
    key('keydown', digit, `Digit${digit}`, true);
    key('keyup', digit, `Digit${digit}`, true);
  }
  check(gb.selectedTab === start && badge(second).hasAttribute('zia-target'), 'Typed target must highlight without selecting early');
  key('keyup', 'Control', 'ControlLeft', false);
  await delay(160);
  check(gb.selectedTab === second && state().display === 'none', 'Ctrl+number selection or release visibility failed');
  results.numberSelection = true;
  gb.selectedTab = start;
  gb.removeTab(second);

  key('keydown', 'Control', 'ControlLeft', true);
  key('keydown', 'c', 'KeyC', true);
  await delay(160);
  check(state().display === 'none', 'Another Ctrl shortcut did not cancel the badges');
  key('keyup', 'Control', 'ControlLeft', false);
  results.shortcutCancellation = true;
  key('keydown', 'Control', 'ControlLeft', true);
  doc.dispatchEvent(new win.Event('visibilitychange'));
  key('keyup', 'Control', 'ControlLeft', false);
  await delay(160);
  check(state().display === 'none', 'Release after a visibility event left badges visible');

  Services.prefs.setBoolPref('zia.tab-numbers.always', true);
  await delay(100);
  check(!state().held && state().display === 'grid', 'Always-show setting did not display badges without Ctrl');
  Services.prefs.setBoolPref('zia.tab-numbers.always', false);
  await delay(100);
  check(state().display === 'none', 'Disabling always-show did not hide badges');
  results.alwaysShowSetting = true;
  check(win.__compatErrors.length === 0, 'Mod errors: ' + win.__compatErrors.join('\n'));
  done(results);
})().catch(error => done({...results, error: String(error), stack: error.stack}));
