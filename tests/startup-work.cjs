const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/js/29-start.js'), 'utf8');

function clock() {
  let id = 0, now = 0;
  const frames = new Map(), timers = new Map(), idle = new Map(), listeners = new Map();
  const add = (map, fn) => { map.set(++id, fn); return id; };
  const fire = (map) => {
    const entry = map.entries().next().value;
    assert.ok(entry, 'a callback must be scheduled');
    map.delete(entry[0]);
    entry[1]({timeRemaining: () => 10});
  };
  return {
    frames, timers, idle, fire,
    advance: ms => { now += ms; },
    globals: {
      console,
      performance: {now: () => now},
      requestAnimationFrame: fn => add(frames, fn),
      cancelAnimationFrame: id => frames.delete(id),
      setTimeout: fn => add(timers, fn), clearTimeout: id => timers.delete(id),
      requestIdleCallback: fn => add(idle, fn), cancelIdleCallback: id => idle.delete(id),
      window: {addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      }},
    },
    emit(type) { for (const fn of listeners.get(type) || []) fn(); },
  };
}

// A peer can run before decoration; a busy browser still makes progress one
// bounded slice at a time, and closing a window stops pending initialization.
{
  const time = clock(), calls = [];
  const context = vm.createContext(time.globals);
  vm.runInContext(source.slice(0, source.indexOf('  function canUnload')), context);
  for (const name of ['icons', 'panels', 'hover']) {
    context.afterStartup(name, () => { calls.push(name); time.advance(5); });
  }
  calls.push('peer');
  assert.deepEqual(calls, ['peer']);
  assert.equal(time.idle.size, 1);
  time.fire(time.idle);
  assert.deepEqual(calls, ['peer', 'icons']);
  time.fire(time.idle);
  assert.deepEqual(calls, ['peer', 'icons', 'panels']);
  time.fire(time.idle);
  assert.deepEqual(calls, ['peer', 'icons', 'panels', 'hover']);
  assert.equal(time.idle.size, 0);
  context.afterStartup('busy', () => calls.push('busy'));
  context.afterStartup('busy-next', () => calls.push('busy-next'));
  const timedOut = time.idle.entries().next().value;
  time.idle.delete(timedOut[0]);
  timedOut[1]({didTimeout: true, timeRemaining: () => 0});
  assert.ok(calls.includes('busy') && !calls.includes('busy-next'));
  time.fire(time.idle);
  assert.ok(calls.includes('busy-next'));
  context.afterStartup('closed', () => calls.push('closed'));
  time.emit('unload');
  assert.equal(time.idle.size, 0);
  assert.ok(!calls.includes('closed'));
}

// Exercise actual selected-row decoration without forcing a layout for every
// tab during restore, or repeatedly removing/readding an unchanged attribute.
{
  const time = clock(), events = new Map();
  let reads = 0, writes = 0;
  const row = (visible = true) => {
    const attrs = new Set();
    return {
      getBoundingClientRect() { reads++; return {height: visible ? 30 : 0}; },
      checkVisibility: () => visible,
      hasAttribute: name => attrs.has(name),
      setAttribute(name) { writes++; attrs.add(name); },
      removeAttribute(name) { writes++; attrs.delete(name); },
    };
  };
  const first = row(), second = row(), hidden = row(false);
  const rows = [hidden, first, second, ...Array.from({length: 997}, () => row())];
  const browser = {selectedTab: first, tabContainer: {addEventListener(type, fn) { events.set(type, fn); }}};
  let observe, disconnected = false, removedPref = false;
  const context = vm.createContext({
    ...time.globals, gBrowser: browser,
    window: {...time.globals.window, gZenWorkspaces: {pinnedTabsContainer: {querySelectorAll: () => rows}}},
    MutationObserver: class {
      constructor(fn) { observe = fn; }
      observe() {} disconnect() { disconnected = true; }
    },
    Services: {prefs: {addObserver() {}, removeObserver() { removedPref = true; }}},
    setInterval() { assert.fail('sidebar scans must not poll while idle'); },
  });
  vm.runInContext(source.slice(source.indexOf('  function watchEdgeGlow'), source.indexOf('  function start()')), context);
  context.watchEdgeGlow();
  for (let i = 0; i < 200; i++) events.get('TabMove')();
  assert.equal(reads, 0, 'tab event bursts must not synchronously force layout');
  assert.equal(time.frames.size, 1);
  assert.equal(time.timers.size, 1, 'one final check after transitions settle');
  time.fire(time.frames);
  assert.equal(reads, 2, 'stop at the first visible row');
  assert.ok(first.hasAttribute('zia-no-glow'));
  const before = writes;
  time.fire(time.timers);
  time.fire(time.frames);
  assert.equal(writes, before, 'unchanged selection must not dirty styles');

  browser.selectedTab = second;
  events.get('TabSelect')();
  time.fire(time.frames);
  assert.ok(!first.hasAttribute('zia-no-glow'));
  assert.ok(!second.hasAttribute('zia-no-glow'));

  const split = row();
  const splitAttr = split.hasAttribute;
  split.hasAttribute = name => name === 'split-view-group' || splitAttr(name);
  split.contains = child => child === first || child === second;
  second.group = split;
  observe();
  time.fire(time.frames);
  // The split, rather than just one of its tabs, occupies the first row.
  assert.ok(split.hasAttribute('zia-no-glow'));
  const atSplit = writes;
  events.get('TabSelect')();
  time.fire(time.frames);
  assert.ok(split.hasAttribute('zia-no-glow'));
  assert.equal(writes, atSplit);

  browser.selectedTab = row();
  browser.selectedTab.setAttribute('zen-essential');
  events.get('TabSelect')();
  time.fire(time.frames);
  assert.ok(!split.hasAttribute('zia-no-glow'));
  time.emit('unload');
  assert.equal(time.frames.size, 0);
  assert.equal(time.timers.size, 0);
  assert.ok(disconnected && removedPref);
}

console.log('Passed: startup yields to peers, idle work is bounded/cancelable, tab bursts coalesce, first-row/split decoration is retained, idle polling and redundant writes are absent.');
