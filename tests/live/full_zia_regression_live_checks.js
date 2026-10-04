const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const gb = win.gBrowser, results = {};
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
const check = (ok, message) => { if (!ok) throw new Error(message); };
async function hover(tab) {
  win.InspectorUtils.addPseudoClassLock(tab, ':hover');
  try {
    tab.dispatchEvent(new win.MouseEvent('mouseover', {bubbles: true}));
    await delay(750);
    const card = doc.getElementById('zia-tab-card');
    check(card && !card.hidden && win.getComputedStyle(card).display !== 'none', 'Tab hover card did not open');
    check(card.querySelector('.zia-tab-card-title').textContent === tab.label, 'Hover card uses another tab');
    return {visible: true, essentialHidden: card.querySelector('[zia-action="essential"]').hidden};
  } finally {
    win.InspectorUtils.removePseudoClassLock(tab, ':hover');
    tab.dispatchEvent(new win.MouseEvent('mouseout', {bubbles: true}));
  }
}
(async () => {
  const start = gb.selectedTab;
  results.normalHover = await hover(start);
  check(!results.normalHover.essentialHidden, 'Ordinary tab lost its Essentials action');
  const other = gb.addTrustedTab('about:blank', {inBackground: true});
  win.gZenViewSplitter.splitTabs([start, other], 'vsep', 0);
  await delay(300);
  results.splitHover = await hover(start);
  check(results.splitHover.essentialHidden, 'A split pane offers the removed split-essential feature');
  win.gZenViewSplitter.unsplitCurrentView();
  await delay(300);
  gb.selectedTab = start;
  gb.removeTab(other);

  const reload = doc.getElementById('reload-button');
  check(typeof reload.ziaReloadCut === 'function', 'Reload hover animation did not initialize');
  reload.dispatchEvent(new win.MouseEvent('mouseenter'));
  await delay(450);
  check(Math.abs(parseFloat(reload.style.getPropertyValue('--zia-reload-cut')) - 20) < 0.01, 'Reload did not animate to its hover angle');
  reload.dispatchEvent(new win.MouseEvent('mouseleave'));
  await delay(450);
  check(Math.abs(parseFloat(reload.style.getPropertyValue('--zia-reload-cut'))) < 0.01, 'Reload hover angle did not reset');
  results.reloadHover = true;

  // Exercise the actor's marker without depending on an external live stream.
  const card = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  card.className = 'zen-media-card';
  const progress = doc.createElementNS(card.namespaceURI, 'div');
  progress.className = 'zen-media-progress-hbox';
  const slider = doc.createElementNS(card.namespaceURI, 'input');
  slider.type = 'range'; slider.className = 'zen-media-progress-bar'; progress.append(slider);
  const ring = doc.createElementNS(card.namespaceURI, 'div'); ring.className = 'zia-ring-fill';
  card.append(progress, ring); doc.getElementById('zen-media-controls-toolbar').append(card);
  try {
    card.setAttribute('zia-live', 'true');
    check(win.getComputedStyle(progress, '::before').content === '"LIVE"', 'YouTube live card lost its LIVE label');
    check(win.getComputedStyle(slider).display === 'none' && win.getComputedStyle(ring).opacity === '0', 'YouTube live card still shows seek controls');
    card.removeAttribute('zia-live');
    check(win.getComputedStyle(slider).display !== 'none' && win.getComputedStyle(ring).opacity !== '0', 'Recorded media lost seeking');
    card.setAttribute('media-position-hidden', 'true');
    check(win.getComputedStyle(progress, '::before').content === '"LIVE"', 'Native live media lost its label');
    card.setAttribute('media-sharing', 'true');
    check(win.getComputedStyle(progress).display === 'none', 'Screen sharing exposes a live progress row');
    results.liveMediaStyles = true;
  } finally { card.remove(); }

  // Measure the actual one-pixel text adjustment without moving favicons or
  // changing tab geometry. This guards the extracted fork override stylesheet.
  const tab = gb.tabs.find(tab => !tab.hasAttribute('zen-essential') && tab.querySelector('.tab-label-container')?.getBoundingClientRect().width > 0);
  check(tab, 'No visible normal tab for the sidebar alignment check');
  const tabText = tab.querySelector('.tab-label-container'), tabIcon = tab.querySelector('.tab-icon-stack');
  const originalStyle = tabText.getAttribute('style');
  const before = {text: tabText.getBoundingClientRect(), icon: tabIcon.getBoundingClientRect(), row: tab.getBoundingClientRect()};
  check(win.getComputedStyle(tabText).translate === '0px -1px', 'Expanded sidebar text lost its one-pixel alignment');
  tabText.style.setProperty('translate', 'none', 'important');
  try {
    const after = {text: tabText.getBoundingClientRect(), icon: tabIcon.getBoundingClientRect(), row: tab.getBoundingClientRect()};
    check(Math.abs(after.text.top - before.text.top - 1) < 0.1, 'Text alignment moves by more than one pixel: ' + JSON.stringify({before: before.text.toJSON(), after: after.text.toJSON()}));
    check(after.icon.top === before.icon.top && after.row.height === before.row.height, 'Text alignment moved the favicon or changed row height');
    results.sidebarTextAlignment = true;
  } finally {
    if (originalStyle === null) tabText.removeAttribute('style'); else tabText.setAttribute('style', originalStyle);
  }
  const label = doc.getElementById('zia-space-label'), text = label.querySelector('.zia-space-name');
  const attrs = [...label.attributes].map(a => [a.name, a.value]), originalText = text.textContent;
  const oldSvg = label.querySelector('.zia-space-svg'); oldSvg?.remove();
  const center = el => {const box = el.getBoundingClientRect(); return box.top + box.height / 2;};
  let mark;
  try {
    text.textContent = 'Sol';
    label.removeAttribute('zia-has-icon'); label.removeAttribute('zia-icon'); label.setAttribute('zia-has-svg', 'true');
    mark = doc.createElementNS(label.namespaceURI, 'span'); mark.className = 'zia-space-svg';
    const svg = new win.DOMParser().parseFromString(await (await win.fetch('resource://zia-tabler/outline/sun.svg')).text(), 'image/svg+xml').documentElement;
    // The real workspace renderer substitutes the chrome context paint too.
    svg.setAttribute('stroke', 'currentColor');
    mark.append(doc.importNode(svg, true)); label.prepend(mark);
    for (const size of ['13px', '15px']) {
      text.style.fontSize = size;
      check(Math.abs(center(mark) - center(text)) < 0.1, 'Workspace SVG and name have different vertical centers');
    }
    text.style.removeProperty('font-size');
    results.workspaceSvgAlignment = {iconCenter: center(mark), textCenter: center(text)};
    const opticalOffset = win.matchMedia('(-moz-platform: windows)').matches ? '0px 1px' : 'none';
    check(win.getComputedStyle(mark.firstElementChild).translate === opticalOffset, 'Workspace SVG optical alignment changed');
    mark.remove();
    label.removeAttribute('zia-has-svg'); label.setAttribute('zia-has-icon', 'true'); label.setAttribute('zia-icon', '\u2600');
    const iconStyle = win.getComputedStyle(label, '::before');
    check(iconStyle.height === '16px' && iconStyle.lineHeight === '16px' && iconStyle.translate === opticalOffset, 'Text workspace icon uses the wrong line box or optical alignment');
    results.workspaceTextIconAlignment = true;
  } finally {
    mark?.remove(); text.style.removeProperty('font-size'); text.textContent = originalText;
    for (const attr of [...label.attributes]) label.removeAttribute(attr.name);
    for (const [name, value] of attrs) label.setAttribute(name, value);
    if (oldSvg) label.prepend(oldSvg);
  }
  check(win.__compatErrors.length === 0, 'Mod errors: ' + win.__compatErrors.join('\n'));
  done(results);
})().catch(error => done({...results, error: String(error), stack: error.stack}));
