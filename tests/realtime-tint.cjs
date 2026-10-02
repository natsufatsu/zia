const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = ['01-site-colour.js', '01a-realtime-tint.js']
  .map(name => fs.readFileSync(path.join(__dirname, '../src/js', name), 'utf8')).join('\n');

function setup() {
  let now = 0, next = 0, calls = 0;
  const timers = new Map(), frames = new Map(), observers = new Map(), events = new Map(), flags = new Map();
  const prefs = new Map(), styles = new Map();
  const browser = {browsingContext: {currentWindowGlobal: {}}, webProgress: {isLoadingDocument: false}};
  const gb = {selectedBrowser: browser, tabContainer: {addEventListener: listen}, getTabForBrowser: () => null};
  function listen(type, fn) {
    if (!events.has(type)) events.set(type, []);
    events.get(type).push(fn);
  }
  const doc = {hidden: false, addEventListener: listen};
  const win = {addEventListener: listen, STATE_MINIMIZED: 2, windowState: 1};
  const context = vm.createContext({console, Math, document: doc, window: win, gBrowser: gb,
    root: {style: {setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key)}},
    Services: {prefs: {
      getBoolPref: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback,
      getStringPref: (key, fallback) => fallback,
      addObserver: (key, fn) => observers.set(key, fn), removeObserver: key => observers.delete(key),
    }},
    setFlag: (key, value) => flags.set(key, value),
    performance: {now: () => now},
    setTimeout: (fn, delay) => { timers.set(++next, {fn, due: now + delay}); return next; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.set(++next, fn); return next; },
    cancelAnimationFrame: id => frames.delete(id),
    noteError: (...args) => context.errors.push(args),
    safely: (name, fn) => fn(), errors: [],
    getComputedStyle: () => ({getPropertyValue: () => '#121212'}),
    matchMedia: () => ({matches: true}),
  });
  vm.runInContext(source + `
    sampleTopColor = browser => mockSample(browser);
    globalThis.api = {watchRealtimeTint, updateColor, checkColor, requestScrollSample, snapColorForTab,
      requestRealtimeSample, smoothRealtimeColor,
      seed: (browser, rgb) => colorCache.set(browser, rgb),
      state: realtimeState, cache: browser => colorCache.get(browser)};
  `, context);
  let sample = () => Promise.resolve({rgb: [100, 100, 100], share: 0.1});
  context.mockSample = b => { calls++; return sample(b); };
  const emit = type => { for (const fn of events.get(type) || []) fn(); };
  const change = (key, value) => { prefs.set(key, value); observers.get(key)?.(); };
  async function tick(ms) {
    now += ms;
    const due = [...timers].filter(([, item]) => item.due <= now);
    for (const [id, item] of due) { timers.delete(id); item.fn(); }
    const paint = [...frames]; frames.clear();
    for (const [, fn] of paint) fn(now);
    await Promise.resolve(); await Promise.resolve();
  }
  return {api: context.api, timers, frames, observers, flags, browser, gb, doc, win, context, tick, emit, change,
    setSample: fn => { sample = fn; }, calls: () => calls,
    tint: () => styles.get('--zia-site-bg')};
}

(async () => {
  // The default adds no capture timer, and a 100ms sample rate is bounded
  // even when the page is loading or several event sources request a sample.
  const h = setup();
  h.api.watchRealtimeTint();
  assert.equal(h.timers.size, 0);
  h.api.seed(h.browser, [0, 0, 0]);
  h.change('zia.toolbar.realtime-tint', true);
  assert.equal(h.flags.get('zia-realtime-tint'), true);
  await h.tick(0);
  assert.equal(h.calls(), 1);
  assert.equal(h.api.state(h.browser).target[0], 100, 'gradient-like low-share readings are accepted');
  await h.tick(16); await h.tick(16);
  const first = h.api.state(h.browser).shown[0];
  assert.ok(first > 0 && first < 20, 'a large colour change starts smoothly');
  h.api.requestScrollSample(); await h.api.updateColor(); await h.api.checkColor();
  assert.equal(h.calls(), 1, 'legacy event/check paths must not add captures');
  await h.tick(68);
  assert.equal(h.calls(), 2);
  assert.equal(h.api.cache(h.browser)[0], 0, 'experimental updates leave the legacy cache intact');
  for (let i = 0; i < 15; i++) await h.tick(100);
  assert.ok(h.api.state(h.browser).shown[0] > 99, 'filter follows a sustained change');
  assert.equal(h.context.errors.length, 0);

  // Time-based smoothing converges identically at different frame rates.
  let fine = [0], coarse = [0];
  for (let i = 0; i < 20; i++) fine = h.api.smoothRealtimeColor(fine, [100], 10);
  for (let i = 0; i < 4; i++) coarse = h.api.smoothRealtimeColor(coarse, [100], 50);
  assert.ok(Math.abs(fine[0] - coarse[0]) < 1e-9);
  const flash = h.api.smoothRealtimeColor([0], [255], 16)[0];
  assert.ok(flash < 16, 'one-frame flashes are attenuated');

  h.doc.hidden = true; h.emit('visibilitychange');
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0);
  const pausedCalls = h.calls(); await h.tick(5000);
  assert.equal(h.calls(), pausedCalls);
  h.doc.hidden = false; h.emit('visibilitychange'); await h.tick(0);
  assert.equal(h.calls(), pausedCalls + 1);
  h.win.windowState = 2; h.emit('sizemodechange');
  assert.equal(h.timers.size, 0);
  h.win.windowState = 1; h.emit('sizemodechange');
  h.browser.webProgress.isLoadingDocument = true;
  await h.tick(100);
  assert.equal(h.timers.size, 1);
  await h.tick(0);
  assert.equal(h.timers.size, 1, 'loading pages do not spin zero-delay timers');
  h.browser.webProgress.isLoadingDocument = false;

  // Slow snapshots serialize. Late results after a tab/document switch,
  // pref change, hide or unload cannot repaint the toolbar.
  let release;
  h.setSample(() => new Promise(resolve => { release = resolve; }));
  await h.tick(100);
  const pendingCalls = h.calls();
  for (let i = 0; i < 5; i++) { h.api.requestRealtimeSample(); await h.tick(100); }
  assert.equal(h.calls(), pendingCalls);
  const other = {browsingContext: {currentWindowGlobal: {}}, webProgress: {isLoadingDocument: false}};
  h.gb.selectedBrowser = other; h.api.seed(other, [20, 20, 20]);
  h.api.snapColorForTab(other); h.emit('TabSelect');
  assert.equal(h.tint(), 'rgb(20, 20, 20)');
  release({rgb: [255, 0, 0], share: 1}); await h.tick(0);
  assert.equal(h.api.state(other), null);
  assert.equal(h.tint(), 'rgb(20, 20, 20)');
  h.setSample(() => Promise.resolve({rgb: [50, 60, 70], share: 1}));
  await h.tick(100); await h.tick(16);
  assert.equal(h.api.state(other).target[0], 50);
  other.browsingContext.currentWindowGlobal = {};
  assert.equal(h.api.state(other), null, 'navigation clears the old document filter');

  h.change('zia.toolbar.site-color', false);
  await h.tick(16); await h.tick(16);
  assert.equal(h.flags.get('zia-realtime-tint'), false);
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0);
  assert.equal(h.tint(), undefined);
  h.change('zia.toolbar.site-color', true);
  await h.tick(100);
  await h.tick(16); await h.tick(16);
  h.emit('unload');
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0); assert.equal(h.observers.size, 0);
  assert.equal(h.context.errors.length, 0);
  const off = setup();
  off.api.watchRealtimeTint(); off.api.seed(off.browser, [20, 20, 20]);
  let finish;
  off.setSample(() => new Promise(resolve => { finish = resolve; }));
  off.change('zia.toolbar.realtime-tint', true); await off.tick(0);
  off.setSample(() => Promise.resolve({rgb: [20, 20, 20], share: 1}));
  off.change('zia.toolbar.realtime-tint', false);
  finish({rgb: [255, 0, 0], share: 1});
  await off.tick(16); await off.tick(16);
  assert.equal(off.tint(), 'rgb(20, 20, 20)', 'disabled-mode late capture overwrote the legacy tint');
  assert.equal(off.timers.size, 0); assert.equal(off.frames.size, 0);
  console.log('Passed: opt-in tint rate/smoothing, legacy isolation, visibility, loading, slow captures, tab/navigation races and cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
