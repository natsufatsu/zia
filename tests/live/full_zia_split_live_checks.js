const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const gb = win.gBrowser, splitter = win.gZenViewSplitter;
const results = {};
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
async function waitFor(fn, name) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (fn()) return;
    await delay(30);
  }
  throw new Error('Timed out: ' + name);
}
function check(value, message) { if (!value) throw new Error(message); }
function dragEvent(kind, x, y, transfer, target = doc.documentElement) {
  const event = new win.Event(kind, {bubbles: true, cancelable: true});
  for (const [key, value] of Object.entries({clientX: x, clientY: y, dataTransfer: transfer}))
    Object.defineProperty(event, key, {value});
  target.dispatchEvent(event);
}
(async () => {
  const base = gb.addTrustedTab('about:blank', {inBackground: true});
  const dragged = gb.addTrustedTab('about:blank', {inBackground: true});
  gb.selectedTab = base;
  await delay(400);
  const box = gb.tabbox.getBoundingClientRect(), y = box.top + box.height / 2;
  const leftX = box.left + box.width * 0.15, rightX = box.left + box.width * 0.85;
  const images = [];
  const transfer = {
    types: ['application/x-moz-tabbrowser-tab'],
    mozGetDataAt: () => dragged,
    updateDragImage: (...args) => images.push(args),
  };
  dragEvent('dragstart', 30, 150, transfer);
  dragEvent('dragover', leftX, y, transfer);
  await waitFor(() => doc.querySelector('#zia-split-drop[shown] .zia-split-zone[side="left"][active]'), 'left target');
  await waitFor(() => images.length > 0, 'native rectangle preview');
  check(images[0][0].id === 'zen-split-view-drag-image', 'Wrong drag preview');
  check(!doc.querySelector('#zia-split-drag-picture, #zia-drag-thumb'), 'Screenshot/sidebar drag overrides returned');
  const zone = doc.querySelector('.zia-split-zone[side="left"]');
  check(win.getComputedStyle(zone).backgroundColor === 'rgb(23, 44, 52)', 'Standalone active target color differs');
  results.nativeRectanglePreview = true;
  dragEvent('dragover', 30, y, transfer);
  await waitFor(() => !doc.getElementById('zen-split-view-drag-image'), 'preview removed over sidebar');
  await waitFor(() => !doc.querySelector('.zia-split-zone[active]'), 'page targets inactive over sidebar');
  dragEvent('dragover', rightX, y, transfer);
  await waitFor(() => doc.querySelector('.zia-split-zone[side="right"][active]'), 'right target');
  // Releasing in the center must cancel even when the last painted side was right.
  dragEvent('drop', box.left + box.width / 2, y, transfer, doc.getElementById('zia-split-drop'));
  await delay(200);
  check(!base.splitView && !dragged.splitView, 'Center release made an unwanted split');
  check(!doc.querySelector('#zia-split-drop[open], #zen-split-view-drag-image'), 'Canceled drag left stale UI');
  results.centerCancellation = true;

  for (const [side, x] of [['left', leftX], ['right', rightX]]) {
    gb.selectedTab = base;
    dragEvent('dragstart', 30, 150, transfer);
    dragEvent('dragover', x, y, transfer);
    await waitFor(() => doc.querySelector(`.zia-split-zone[side="${side}"][active]`), side + ' target');
    dragEvent('drop', x, y, transfer, doc.getElementById('zia-split-drop'));
    await waitFor(() => base.splitView && dragged.splitView && base.group === dragged.group, side + ' native split');
    await waitFor(() => doc.querySelectorAll('.zia-pane-bar').length === 2, 'pane toolbars');
    const group = splitter._data.find(entry => entry.tabs.includes(base));
    check(group.tabs[side === 'left' ? 0 : 1] === dragged, 'Dragged tab landed on wrong side');
    check(gb.selectedTab === dragged, 'Dropped tab was not selected');
    check(!doc.querySelector('#zia-split-drop[open], #zen-split-view-drag-image'), 'Drop left stale UI');
    results[side + 'Drop'] = true;
    splitter.unsplitCurrentView();
    await waitFor(() => !base.splitView && !dragged.splitView, 'unsplit');
  }

  gb.selectedTab = base;
  // A recent completed selection is still an already-current tab.
  base.dispatchEvent(new win.MouseEvent('mousedown', {button: 0, bubbles: true, composed: true}));
  const selfTransfer = {...transfer, mozGetDataAt: () => base};
  const count = gb.tabs.length;
  dragEvent('dragstart', 30, 150, selfTransfer);
  dragEvent('dragover', leftX, y, selfTransfer);
  await waitFor(() => doc.querySelector('.zia-split-zone[side="left"][active]'), 'current-tab target');
  dragEvent('drop', leftX, y, selfTransfer, doc.getElementById('zia-split-drop'));
  await waitFor(() => base.splitView && gb.tabs.length === count + 1, 'new-tab pane');
  check(gb.selectedTab !== base && gb.selectedTab.group === base.group, 'New pane was not selected');
  results.currentTabAddsPane = true;
  const newPane = gb.selectedTab;
  splitter.unsplitCurrentView();
  await waitFor(() => !base.splitView, 'current-tab unsplit');
  gb.selectedTab = base;
  gb.removeTab(newPane);

  // A background-tab press may select it before native dragstart. Retain
  // the prior tab even when the user holds that press longer than 1.5s.
  dragged.dispatchEvent(new win.MouseEvent('mousedown', {button: 0, bubbles: true, composed: true}));
  gb.selectedTab = dragged;
  await delay(1600);
  const beforeBackgroundDrop = gb.tabs.length;
  dragEvent('dragstart', 30, 150, transfer);
  dragEvent('dragover', rightX, y, transfer);
  await waitFor(() => doc.querySelector('.zia-split-zone[side="right"][active]'), 'background-tab target');
  dragEvent('drop', rightX, y, transfer, doc.getElementById('zia-split-drop'));
  await waitFor(() => base.splitView && dragged.splitView && base.group === dragged.group, 'held background-tab split');
  check(gb.tabs.length === beforeBackgroundDrop, 'Held background-tab drag unexpectedly creates a new pane');
  results.heldBackgroundTabPairsWithPrevious = true;
  check(win.__compatErrors.length === 0, 'Mod errors during split drops');
  results.errors = win.__compatErrors;
  done(results);
})().catch(error => done({...results, error: String(error), stack: error.stack}));
