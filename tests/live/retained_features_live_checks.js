const done = arguments[arguments.length - 1], origin = arguments[0];
const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
const gb = win.gBrowser, root = doc.documentElement;
const results = {};
const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
async function waitFor(fn, name) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await delay(50);
  }
  throw new Error('Timed out: ' + name);
}
function check(value, message) { if (!value) throw new Error(message); }
(async () => {
  if (win.zenQuickSaveImage) {
    await waitFor(() => !!win.gContextMenu?.onImage, 'image context menu');
    const item = doc.getElementById('zen-quick-save-image-command');
    const {Downloads} = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
    const downloads = await Downloads.getList(Downloads.PUBLIC);
    item.dispatchEvent(new win.Event('command', {bubbles: true}));
    await waitFor(async () => (await downloads.getAll()).some(dl => dl.succeeded), 'actual download');
    results.quickSave = true;
    doc.getElementById('contentAreaContextMenu').hidePopup();
  } else { results.quickSave = "not requested"; }
  const light = gb.selectedTab;
  const dark = gb.addTrustedTab(origin + '/dark', {inBackground: true});
  await waitFor(() => dark.linkedBrowser.contentTitle.includes('/dark'), 'dark tab');
  gb.selectedTab = dark;

  await waitFor(() => doc.querySelector('.zen-media-card')?.style.getPropertyValue('--zia-media-space-bg'), 'workspace player card');
  const toolbar = doc.getElementById('zen-media-controls-toolbar');
  const card = doc.querySelector('.zen-media-card');
  await waitFor(() => card.__ziaCard, 'original media artwork binding');
  check(!win.__zia_media_playerLoaded, 'A second standalone media script was loaded');
  results.player = {workspace: card.style.getPropertyValue('--zia-media-space-bg'),
    collapsed: root.style.getPropertyValue('--zia-media-opacity-collapsed'),
    expanded: root.style.getPropertyValue('--zia-media-opacity-expanded')};
  check(results.player.collapsed === '40%' && results.player.expanded === '90%', 'Wrong player defaults');
  check(doc.querySelector('.zia-tab-sound'), 'Original sidebar sound bars missing');
  results.sidebarSoundBars = true;

  // Use Zen's real commands and inspect the SVG selected by the actual
  // mute button. Render its animation separately to measure the end shape.
  const playPause = card.querySelector('.zen-media-playpause-button');
  const mute = card.querySelector('.zen-media-mute-button');
  const command = button => button.dispatchEvent(new win.Event('command', {bubbles: true}));
  function soundImage() {
    const style = win.getComputedStyle(mute).listStyleImage;
    const uri = /^url\(["'](.*)["']\)$/.exec(style)?.[1];
    check(uri?.startsWith('data:image/svg+xml,'), 'Player did not use its generated waveform: ' + style + '; card image: ' + card.style.getPropertyValue('--zia-sound-still'));
    return {uri, source: decodeURIComponent(uri.slice(uri.indexOf(',') + 1).split('#')[0])};
  }
  async function collapsedHeights(source) {
    const host = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    host.style.cssText = 'position:fixed;right:0;top:0;width:16px;height:16px;pointer-events:none';
    const svg = new win.DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
    svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
    const copy = doc.importNode(svg, true);
    host.attachShadow({mode: 'open'}).append(copy); root.append(host);
    try {
      await delay(400);
      const rects = [...copy.querySelectorAll('rect')];
      const heights = rects.map(rect => parseFloat(win.getComputedStyle(rect).height));
      check(rects.length === 4 && heights.every(height => Math.abs(height - 2) < 0.01), 'Paused waveform did not collapse into four dots');
      check(rects.every(rect => Math.abs(parseFloat(win.getComputedStyle(rect).y) - 7) < 0.01), 'Paused dots did not settle at the center');
      return heights;
    } finally { host.remove(); }
  }
  results.pausedWaveform = {cycles: 0};
  results.pausedWaveform.fallbackHeights = await collapsedHeights(await (await win.fetch('chrome://sine/content/zia/icons/workspace-player/sound-still.svg')).text());
  await waitFor(() => card.style.getPropertyValue('--zia-sound-wave'), 'generated waveform after artwork color loading');
  let previousPausedUri;
  for (let i = 0; i < 2; i++) {
    await waitFor(() => card.classList.contains('playing'), 'media playback before pause');
    command(playPause);
    await waitFor(() => !card.classList.contains('playing'), 'actual media pause');
    await delay(50);
    const paused = soundImage();
    check(paused.source.includes('@keyframes shrink'), 'Paused player retained stationary tall bars');
    check(paused.source.includes('prefers-reduced-motion:reduce'), 'Paused waveform lost reduced-motion handling');
    check(paused.uri !== previousPausedUri, 'Repeated pause did not restart the collapse animation');
    previousPausedUri = paused.uri;
    results.pausedWaveform.heights = await collapsedHeights(paused.source);
    command(playPause);
    await waitFor(() => card.classList.contains('playing'), 'actual media resume');
    await delay(50);
    check(soundImage().source.includes('@keyframes z'), 'Resumed player did not restore the moving waveform');
    results.pausedWaveform.cycles++;
  }
  command(mute);
  await waitFor(() => card.hasAttribute('muted'), 'actual media mute');
  await delay(50);
  check(soundImage().source.includes('@keyframes shrink'), 'Muted playback lost the collapsed waveform');
  command(playPause);
  await waitFor(() => !card.classList.contains('playing'), 'paused muted media');
  command(mute);
  await waitFor(() => !card.hasAttribute('muted'), 'unmuting paused media');
  await delay(50);
  check(soundImage().source.includes('@keyframes shrink'), 'Unmuting paused media restores tall bars');
  command(playPause);
  await waitFor(() => card.classList.contains('playing'), 'resume after muted pause');
  results.pausedWaveform.muteTransitions = true;
  const ghost = light.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.setAttribute('zen-essential', 'true');
  ghost.setAttribute('soundplaying', 'true');
  ghost.setAttribute('visuallyselected', 'true');
  (win.gZenWorkspaces.getCurrentEssentialsContainer() || doc.getElementById('zen-essentials')).append(ghost);
  await delay(100);
  const background = ghost.querySelector('.tab-background');
  const favicon = ghost.querySelector('.tab-icon-stack');
  check(win.getComputedStyle(background).boxShadow === 'none', 'Playing essential still has a media glow');
  check(win.getComputedStyle(background, '::after').display === 'none' &&
    win.getComputedStyle(background, '::before').display === 'none', 'Playing tab still has a shine box');
  check(win.getComputedStyle(favicon, '::after').display === 'none', 'Essential music indicator remains');
  ghost.remove();
  results.noPlayingEssentialGlowBox = true;

  // Use the tab with real looping audio as well as the synthetic CSS matrix.
  const normalShadow = win.getComputedStyle(dark.querySelector('.tab-background')).boxShadow;
  gb.selectedTab = light;
  await waitFor(() => light.hasAttribute('soundplaying') && light.hasAttribute('visuallyselected'), 'selected audio tab');
  await delay(300);
  const audioBackground = light.querySelector('.tab-background');
  check(normalShadow !== 'none' && win.getComputedStyle(audioBackground).boxShadow === normalShadow,
    'Actual playing tab lost its selected glow');
  check(win.getComputedStyle(audioBackground, '::after').display === 'block', 'Actual playing tab lost its border shine');
  light.toggleMuteAudio();
  await waitFor(() => light.hasAttribute('muted'), 'muted audio tab');
  check(win.getComputedStyle(audioBackground).boxShadow === normalShadow, 'Muting audio removed the selected glow');
  light.toggleMuteAudio();
  await waitFor(() => !light.hasAttribute('muted'), 'unmuted audio tab');
  gb.selectedTab = dark;
  results.selectedAudioGlow = true;

  const wasLight = root.hasAttribute('zia-light');
  const savedLight = root.getAttribute('zia-light');
  try {
    root.setAttribute('zia-light', '');
    await delay(150);
    check(win.getComputedStyle(card.querySelector('.zen-media-title')).color === 'rgb(255, 255, 255)',
      'Light sidebar replaced white title ink on the dark custom player');
    check(win.getComputedStyle(card.querySelector('.zen-media-artist')).color === 'rgba(255, 255, 255, 0.85)',
      'Light sidebar replaced custom player artist ink');
    check(win.getComputedStyle(playPause).color === 'rgba(255, 255, 255, 0.92)',
      'Light sidebar replaced custom player control ink');
    results.lightPlayerPalette = true;
  } finally {
    if (wasLight) root.setAttribute('zia-light', savedLight);
    else root.removeAttribute('zia-light');
  }

  const colorBefore = win.getComputedStyle(card).backgroundColor;
  Services.prefs.setStringPref('zia.media-player.opacity.collapsed', '25');
  Services.prefs.setStringPref('zia.media-player.opacity.expanded', '75');
  await delay(400);
  check(root.style.getPropertyValue('--zia-media-opacity-collapsed') === '25%' &&
    root.style.getPropertyValue('--zia-media-opacity-expanded') === '75%', 'Opacity settings not applied');
  check(win.getComputedStyle(card).backgroundColor !== colorBefore, 'Player background did not respond');
  results.liveOpacity = true;

  // Force the same :hover state as pointer expansion, using Gecko's testing
  // helper, so the final computed control positions can be asserted.
  const InspectorUtils = win.InspectorUtils;
  InspectorUtils.addPseudoClassLock(toolbar, ':hover');
  await delay(500);
  const buttons = [...card.querySelectorAll('.zen-media-pip-button, .zen-media-previoustrack-button, .zen-media-playpause-button, .zen-media-nexttrack-button, .zen-media-close-button')];
  const play = card.querySelector('.zen-media-playpause-button');
  const cr = card.getBoundingClientRect(), pr = play.getBoundingClientRect();
  results.layout = {height: cr.height, centerError: Math.abs((pr.left + pr.width / 2) - (cr.left + cr.width / 2)),
    controls: buttons.map(button => ({class: button.className, row: win.getComputedStyle(button).gridRow,
      opacity: win.getComputedStyle(button).opacity}))};
  check(Math.abs(cr.height - 124) <= 1, 'Expanded player height differs from standalone');
  check(results.layout.centerError <= 1, 'Play/pause is not centered across the full card');
  check(buttons.every(button => win.getComputedStyle(button).gridRow.startsWith('3')), 'Controls are not on the bottom row');
  InspectorUtils.removePseudoClassLock(toolbar, ':hover');

  await win.gZenViewSplitter.splitTabs([light, dark], 'vsep', 0);
  await waitFor(() => root.getAttribute('zia-split') === 'true' && doc.querySelectorAll('.zia-pane-bar').length === 2, 'full Zia pane toolbars');
  results.fullSplitToolbars = true;
  check(doc.getElementById('zia-workspace-slot'), 'Original workspace label missing');
  gb.selectedTab = dark;
  await delay(300);
  check(doc.querySelectorAll('.zia-pane-bar').length === 2, 'Pane switching removed toolbars');
  check(card.style.getPropertyValue('--zia-media-space-bg') === results.player.workspace, 'Selected pane changed media workspace color');
  results.mediaUnaffectedByPaneFocus = true;

  await delay(500);
  const enabledStyle = win.getComputedStyle(card).backgroundColor;
  Services.prefs.setBoolPref('zia.features.media-player', false);
  await delay(300);
  const disabledStyle = win.getComputedStyle(card).backgroundColor;
  check(disabledStyle !== enabledStyle, 'Original media feature toggle is broken');
  Services.prefs.setBoolPref('zia.features.media-player', true);
  await waitFor(() => win.getComputedStyle(card).backgroundColor === enabledStyle, 'player toggle restores background');
  results.featureToggle = true;
  results.errors = win.__compatErrors;
  check(results.errors.length === 0, 'Mod errors in full variant');
  done(results);
})().catch(error => done({...results, error: String(error), stack: error.stack}));
