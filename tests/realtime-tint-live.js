const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const root = doc.documentElement, gb = win.gBrowser;
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
const results = {samples: []};
function check(value, message) { if (!value) throw new Error(message); }
function tint() { return root.style.getPropertyValue('--zia-site-bg').match(/[\d.]+/g)?.map(Number).slice(0, 3); }
async function waitFor(fn, name) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (fn()) return; await delay(20); }
  throw new Error('Timed out: ' + name);
}
(async () => {
  const pref = 'zia.toolbar.realtime-tint', master = 'zia.toolbar.site-color';
  const saved = [pref, master].map(key => ({key, had: Services.prefs.prefHasUserValue(key), value: Services.prefs.getBoolPref(key, false)}));
  const original = gb.selectedTab;
  const page = `<!doctype html><title>initial</title>
    <style>html,body{margin:0;background:rgb(20,30,40);min-height:300vh}</style>
    <script>
      function color(r,g,b){document.documentElement.style.background=document.body.style.background='rgb('+[r,g,b]+')';}
      addEventListener('load',()=>{
        setTimeout(()=>{color(100,110,120);document.title='changed';},2200);
        setTimeout(()=>{
          document.title='alternating'; let n=0;
          window.flicker=setInterval(()=>color(...(++n%2?[180,190,200]:[20,30,40])),100);
        },4200);
        setTimeout(()=>{clearInterval(window.flicker);color(40,50,60);document.title='settled';},6200);
      });
    </script>`;
  let tab;
  try {
    check(!Services.prefs.getBoolPref(pref, false), 'Experimental mode must default off');
    check(!root.hasAttribute('zia-realtime-tint'), 'Default toolbar unexpectedly uses experimental mode');
    Services.prefs.setBoolPref(master, true);
    Services.prefs.setBoolPref(pref, true);
    check(root.getAttribute('zia-realtime-tint') === 'true', 'Toggle did not apply live');
    tab = gb.addTrustedTab('data:text/html;charset=utf-8,' + encodeURIComponent(page), {inBackground: false});
    gb.selectedTab = tab;
    await waitFor(() => tint()?.[0] === 20 && tab.label === 'initial', 'initial sampled colour');
    check(win.getComputedStyle(doc.getElementById('zen-appcontent-navbar-wrapper')).transitionProperty === 'border-color',
      'CSS colour transition competes with the smoothing filter');
    const start = Date.now();
    while (Date.now() - start < 7300) {
      results.samples.push({ms: Date.now() - start, stage: tab.label, rgb: tint()});
      await delay(25);
    }
    const changed = results.samples.filter(s => s.stage === 'changed' && s.rgb);
    check(changed.some(s => s.rgb[0] > 25 && s.rgb[0] < 95), 'Colour change had no intermediate filtered values');
    check(changed.at(-1)?.rgb[0] >= 98, 'Real-time tint did not converge without navigation or scrolling');
    const alternating = results.samples.filter(s => s.stage === 'alternating' && s.rgb);
    const jumps = alternating.slice(1).map((s, i) => Math.abs(s.rgb[0] - alternating[i].rgb[0]));
    check(jumps.length > 10 && Math.max(...jumps) < 35, 'Rapid colour changes flickered: ' + Math.max(...jumps));
    await waitFor(() => tint()?.[0] === 40, 'final steady colour');
    results.maxFlickerStep = Math.max(...jumps);
    results.finalTint = tint();
    const bgTab = gb.addTrustedTab('about:blank', {inBackground: true});
    gb.selectedTab = bgTab;
    await delay(250);
    gb.selectedTab = tab;
    check(tint()?.[0] === 40, 'Tab switch did not restore cached tint immediately');
    gb.removeTab(bgTab, {animate: false});
    Services.prefs.setBoolPref(master, false);
    check(!root.style.getPropertyValue('--zia-site-bg'), 'Master toggle did not clear tint');
    check(!root.hasAttribute('zia-realtime-tint'), 'Master toggle did not stop experimental mode');
    Services.prefs.setBoolPref(pref, false);
    gb.selectedTab = original;
    Services.prefs.setBoolPref(master, true);
    await waitFor(() => tint()?.[0] === 238, 'legacy tint restored');
    check(!root.hasAttribute('zia-realtime-tint'), 'Disabling mode did not restore legacy behaviour');
    check(!win.__compatErrors.length, 'Runtime errors: ' + win.__compatErrors.join('\n'));
    results.passed = true;
  } finally {
    gb.selectedTab = original;
    if (tab?.isConnected) gb.removeTab(tab, {animate: false});
    for (const item of saved) {
      if (item.had) Services.prefs.setBoolPref(item.key, item.value);
      else Services.prefs.clearUserPref(item.key);
    }
  }
})().then(() => done(results), error => done({...results, error: String(error), stack: error.stack}));
