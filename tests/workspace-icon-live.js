const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const manager = win.gZenWorkspaces, toolbox = doc.getElementById('navigator-toolbox');
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
const results = {frames: [], fetches: {}};
function check(value, message) { if (!value) throw new Error(message); }
async function waitFor(fn, name) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (fn()) return;
    await delay(25);
  }
  throw new Error('Timed out: ' + name);
}
function label() { return doc.querySelector('#zia-workspace-slot #zia-space-label'); }
function icon() { return label()?.querySelector('.zia-space-svg')?.dataset.src || label()?.getAttribute('zia-icon') || ''; }
(async () => {
  const original = {...manager.getActiveWorkspace()};
  const originalFetch = win.fetch;
  const firstIcon = 'resource://zia-tabler/outline/sun.svg';
  const secondIcon = 'resource://zia-tabler/outline/moon.svg';
  const lateIcon = 'resource://zia-tabler/outline/star.svg';
  const gates = new Map(), created = [];
  let sampling = false, frame = 0;
  const wasRevealed = toolbox.hasAttribute('zen-user-show');
  const compact = doc.documentElement.getAttribute('zen-compact-mode') === 'true';
  function hold(uri) {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    gates.set(uri, {promise, release});
  }
  function sample() {
    if (!sampling) return;
    const current = label();
    results.frames.push({workspace: manager.activeWorkspace, icon: icon(),
      connected: !!current?.isConnected,
      visible: !!current?.checkVisibility({visibilityProperty: true, opacityProperty: true}),
      rendered: !!current?.querySelector('.zia-space-svg svg') || current?.hasAttribute('zia-has-icon')});
    frame = win.requestAnimationFrame(sample);
  }
  async function add(name, workspaceIcon) {
    const workspace = {...original, uuid: Services.uuid.generateUUID().toString(), name, icon: workspaceIcon};
    created.push(workspace.uuid);
    manager.saveWorkspace(workspace);
    await waitFor(() => manager.workspaceElement(workspace.uuid), 'new workspace');
    return workspace;
  }
  try {
    if (compact) { toolbox.setAttribute('zen-user-show', 'true'); await delay(400); }
    win.fetch = async function(uri, ...args) {
      const url = String(uri);
      if ([firstIcon, secondIcon, lateIcon].includes(url)) {
        results.fetches[url] = (results.fetches[url] || 0) + 1;
        if (gates.has(url)) await gates.get(url).promise;
      }
      try {
        return await originalFetch.call(win, uri, ...args);
      } catch (error) {
        results.fetchError = String(error);
        throw error;
      }
    };
    manager.saveWorkspace({...original, name: 'Sun test', icon: firstIcon});
    await waitFor(() => icon() === firstIcon && label()?.querySelector('svg'), 'initial icon');
    const retainedLabel = label();
    hold(secondIcon);
    const second = await add('Moon test', secondIcon);
    await waitFor(() => results.fetches[secondIcon] === 1, 'inactive icon preloading');
    sampling = true; sample();
    await manager.changeWorkspaceWithID(second.uuid);
    await delay(150);
    check(label() === retainedLabel, 'Switch recreated the label');
    check(icon() === firstIcon, 'Pending icon removed the previous icon');
    gates.get(secondIcon).release();
    await waitFor(() => icon() === secondIcon, 'new icon replacement');
    check(label().querySelector('.zia-space-name').textContent === 'Moon test', 'Name and icon did not update together');
    for (const [uuid, expected] of [[original.uuid, firstIcon], [second.uuid, secondIcon], [original.uuid, firstIcon]]) {
      await manager.changeWorkspaceWithID(uuid);
      await Promise.resolve();
      check(icon() === expected, 'Cached icon was not switched immediately');
    }
    hold(lateIcon);
    const late = await add('Late test', lateIcon);
    await manager.changeWorkspaceWithID(late.uuid);
    await manager.changeWorkspaceWithID(original.uuid);
    gates.get(lateIcon).release();
    await delay(200);
    check(icon() === firstIcon, 'A stale SVG response replaced the current icon');
    sampling = false; win.cancelAnimationFrame(frame);
    check(results.frames.length > 0 && results.frames.every(item => item.connected && item.visible && item.rendered && item.icon),
      'Workspace icon disappeared during a rendered frame');
    check(Object.values(results.fetches).every(count => count === 1), 'Workspace icon was fetched more than once');
    const emoji = await add('Emoji test', '\u2600');
    await manager.changeWorkspaceWithID(emoji.uuid);
    await waitFor(() => icon() === '\u2600', 'text icon');
    const empty = await add('No icon test', '');
    await manager.changeWorkspaceWithID(empty.uuid);
    await waitFor(() => label()?.querySelector('.zia-space-name')?.textContent === 'No icon test', 'iconless workspace');
    check(!icon() && !label().hasAttribute('zia-has-svg') && !label().hasAttribute('zia-has-icon'), 'Iconless workspace retained an icon');
    check(win.__compatErrors.length === 0, 'Mod errors: ' + win.__compatErrors.join('; '));
    results.cachedSwitches = true;
    results.staleResponse = true;
    results.textAndEmptyIcons = true;
  } finally {
    sampling = false; win.cancelAnimationFrame(frame);
    for (const gate of gates.values()) gate.release();
    win.fetch = originalFetch;
    await manager.changeWorkspaceWithID(original.uuid);
    manager.saveWorkspace(original);
    for (const uuid of created) await manager.removeWorkspace(uuid);
    if (compact && !wasRevealed) toolbox.removeAttribute('zen-user-show');
  }
  done(results);
})().catch(error => done({...results, error: String(error), stack: error.stack}));
