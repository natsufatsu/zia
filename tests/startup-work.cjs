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

console.log('Passed: startup yields to peers, idle work is bounded/cancelable.');
