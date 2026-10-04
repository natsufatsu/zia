const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser');
const doc = win.document, root = doc.documentElement;
const sidebar = doc.getElementById('navigator-toolbox');
const urlbar = doc.getElementById('urlbar');
const manager = win.gZenCompactModeManager;
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
const elements = ['zen-appcontent-navbar-container', 'urlbar'].map(id => doc.getElementById(id));
const results = [];
const assert = (value, message) => { if (!value) throw new Error(message); };
const readClip = el => {
  const value = win.getComputedStyle(el).clipPath;
  if (value === 'none') return [0, 0];
  const values = value.slice(value.indexOf('(') + 1, value.indexOf(')')).split(/\s+/).map(parseFloat);
  return [Math.max(0, values[3] ?? values[1] ?? values[0]), Math.max(0, values[1] ?? values[0])];
};
const expectedClip = el => {
  if (root.getAttribute('zen-compact-mode') !== 'true' ||
      win.getComputedStyle(sidebar).visibility === 'hidden' ||
      el.getAttribute('breakout-extend') === 'true') return [0, 0];
  const rect = sidebar.getBoundingClientRect(), style = win.getComputedStyle(sidebar);
  const left = rect.left + parseFloat(style.paddingLeft), right = rect.right - parseFloat(style.paddingRight);
  const target = el.getBoundingClientRect();
  if (rect.bottom <= target.top || rect.top >= target.bottom || right <= target.left || left >= target.right) return [0, 0];
  const onRight = root.getAttribute('zen-right-side') === 'true';
  const amount = Math.min(target.width, Math.max(0, onRight ? target.right - left : right - target.left));
  return onRight ? [0, amount] : [amount, 0];
};
async function phase(name, action, reverseAfter = null) {
  let mutations = 0;
  const observer = new win.MutationObserver(records => { mutations += records.length; });
  for (const el of elements) observer.observe(el, {attributes:true,attributeFilter:['style']});
  const samples = [];
  action();
  if (reverseAfter !== null) win.setTimeout(() => manager._setElementExpandAttribute(sidebar, false), reverseAfter);
  const start = win.performance.now();
  await new Promise(resolve => {
    // Inspect after the frame's other callbacks have applied pending state.
    const sample = () => win.setTimeout(() => {
      for (const el of elements) {
        const actual = readClip(el), expected = expectedClip(el);
        samples.push({id:el.id,at:win.performance.now()-start,actual,expected,
          error:Math.max(...actual.map((value,i) => Math.abs(value-expected[i])))});
      }
      if (win.performance.now() - start < 420) win.requestAnimationFrame(sample);
      else resolve();
    }, 0);
    win.requestAnimationFrame(sample);
  });
  observer.disconnect();
  const stable = samples.filter(s => s.at > 30);
  const maxError = Math.max(...stable.map(s => s.error));
  const summary = {name,mutations,samples:samples.length,maxError};
  results.push(summary);
  assert(maxError <= 2, name + ': clipping lost the sidebar edge: ' + JSON.stringify(stable.filter(s => s.error > 2).slice(0,4)));
  assert(mutations <= 12, name + ': clipping still rewrites styles throughout the animation: ' + mutations);
}
(async () => {
  Services.prefs.setBoolPref('zen.view.compact.hide-tabbar', true);
  Services.prefs.setBoolPref('zen.view.compact.hide-toolbar', false);
  manager.preference = true;
  await delay(400);
  manager._setElementExpandAttribute(sidebar, false);
  await delay(400);
  await phase('left reveal', () => manager._setElementExpandAttribute(sidebar, true));
  await phase('left hide', () => manager._setElementExpandAttribute(sidebar, false));
  await phase('reveal reversed mid-slide', () => manager._setElementExpandAttribute(sidebar, true), 70);
  root.setAttribute('zen-right-side', 'true');
  await delay(350);
  await phase('right reveal', () => manager._setElementExpandAttribute(sidebar, true));
  await phase('right hide', () => manager._setElementExpandAttribute(sidebar, false));
  root.removeAttribute('zen-right-side');
  manager._setElementExpandAttribute(sidebar, true);
  await delay(350);
  urlbar.setAttribute('breakout-extend','true');
  await delay(80);
  assert(urlbar.style.clipPath === '' && win.getComputedStyle(urlbar).clipPath === 'none', 'expanded URL bar must be unclipped');
  urlbar.removeAttribute('breakout-extend');
  await delay(80);
  assert(readClip(urlbar).every((value,i) => Math.abs(value-expectedClip(urlbar)[i])<=2), 'URL bar must restore clipping wherever the sidebar overlaps it');
  await phase('resize with sidebar shown', () => win.resizeTo(920,680));
  manager.preference = false;
  await delay(450);
  assert(elements.every(el => el.style.clipPath === ''), 'leaving compact mode must clear toolbar clips');
  assert(!win.__compatErrors.length, JSON.stringify(win.__compatErrors));
  done({results,expandedUrlbar:true,normalModeCleared:true});
})().catch(error => done({error:String(error),stack:error.stack,results}));
