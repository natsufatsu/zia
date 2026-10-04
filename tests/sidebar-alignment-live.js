const done = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const gb = win.gBrowser, results = {};
const check = (ok, message) => { if (!ok) throw new Error(message); };
(async () => {
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
