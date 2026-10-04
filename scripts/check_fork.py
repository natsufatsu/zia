"""Verify player replacement and scoped removal of group/drag overrides."""
from pathlib import Path
import json
import re
import hashlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

CONFIG = json.loads((ROOT / "fork.json").read_text(encoding="utf-8"))
CHANGED = set(CONFIG["modifiedFiles"])
ADDED = set(CONFIG["forkFiles"])

class GitFile:
    def __init__(self, ref, name):
        self.ref, self.name = ref, name
    def read_bytes(self):
        return subprocess.check_output(["git", "show", f"{self.ref}:{self.name}"], cwd=ROOT)
    def read_text(self, encoding="utf-8"):
        return self.read_bytes().decode(encoding)

class GitTree:
    def __init__(self, ref): self.ref = ref
    def __truediv__(self, name): return GitFile(self.ref, name)

BASE = GitTree(CONFIG["upstream"]["commit"])
MEDIA = ROOT / "tests/fixtures/media-player"
SPLIT = ROOT / "tests/fixtures/split-tabs"
VARIANT = ROOT

def files(folder):
    if isinstance(folder, GitTree):
        names = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", folder.ref], cwd=ROOT).decode().splitlines()
        return {name: folder / name for name in names}
    names = subprocess.check_output(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT).decode().splitlines()
    return {name: ROOT / name for name in set(names) if (ROOT / name).is_file()}


def text(path):
    return path.read_text(encoding="utf-8")


def between(source, start, end):
    begin = source.index(start)
    return source[begin:source.index(end, begin)]


def check():
    if sys.flags.optimize:
        raise RuntimeError("Run checks without Python -O: assertions must be enabled")
    assert CONFIG['schema'] == 2 and 'ownedFiles' not in CONFIG, "Use the upstream-first patch policy"
    assert set(CONFIG['documentationOverlays']) <= {'README.md', 'CHANGELOG.md'}, "Source files cannot be copied over upstream"
    base, variant = files(BASE), files(VARIANT)
    assert not ADDED & set(base), "Shared files must use patches, not forkFiles"
    OMITTED = set(CONFIG["excludedFiles"])
    expected_files = (set(base) - OMITTED) | ADDED
    assert set(variant) == expected_files, (f"Unclassified files: {sorted(set(variant) - expected_files)}; "
                                            f"missing files: {sorted(expected_files - set(variant))}")
    unchanged = set(base) - CHANGED - OMITTED
    for name in unchanged:
        assert base[name].read_bytes() == variant[name].read_bytes(), f"Unrelated file changed: {name}"

    media = text(MEDIA / "zia-media-player.uc.js")
    helpers = between(media, "  // Use the media tab's own space", "  const mediaColorCache")
    helpers += between(media, "  function watchMediaOpacity()", "  function start()")
    player_path = "src/js/08-music-and-sound-bars.js"
    player = text(VARIANT / "src/js/07a-fork-media-workspace.js") + text(variant[player_path])
    assert player.startswith(helpers), "Workspace and opacity helpers differ from target player"
    original_player = player[len(helpers):].replace("        updateMediaWorkspace(card);\n", "")
    assert original_player.count('element.style.setProperty("--zia-sound-still", fresh.dots);') == 1, "Paused media does not use the shrinking dots"
    original_player = original_player.replace('element.style.setProperty("--zia-sound-still", fresh.dots);',
                                              'element.style.setProperty("--zia-sound-still", fresh.still);')
    assert original_player == text(base[player_path]), "Existing artwork, sound bars or PiP logic changed"

    startup_path = "src/js/29-start.js"
    startup = text(variant[startup_path])
    for line in ('    ifOn("media-player", "watchMediaOpacity", watchMediaOpacity);\n',
                 '    ifOn("media-player", "watchMediaWorkspace", watchMediaWorkspace);\n'):
        assert startup.count(line) == 1
        startup = startup.replace(line, "")
    removed_hooks = set(CONFIG["removedHooks"])

    def hooks(value):
        value = value.replace('    afterStartup("addIconPicker", () => ifOn("icon-picker", "addIconPicker", addIconPicker));',
                              '    ifOn("icon-picker", "addIconPicker", addIconPicker);')
        return [h.replace('afterStartup(', 'safely(') for h in
                re.findall(r'^    (?:safely|ifOn|afterStartup)\([^\n]+;', value, re.M)]
    expected_hooks = [h for h in hooks(text(base[startup_path])) if not any(f'"{name}"' in h for name in removed_hooks)]
    new_hooks = [h for h in hooks(startup) if '"restoreNativeTabs"' not in h and '"watchRealtimeTint"' not in h]
    assert new_hooks == expected_hooks, "Startup feature or dependency order changed"
    deferred = re.findall(r'^    afterStartup\("([^\"]+)"', startup, re.M)
    assert deferred == ['setupIconPack', 'watchWelcome', 'watchGlanceThumbs', 'watchSidebarPanels',
                        'addIconPicker', 'watchOldIcons', 'addTabHoverCards', 'watchExtensionIcons']
    assert 'setInterval(update, 1000)' not in startup, "Sidebar polling reintroduced"
    runtime = text(VARIANT / "zia.uc.js")
    for name in removed_hooks:
        assert f'function {name}(' not in runtime, f"Removed override still present: {name}"
    for token in ("DataTransfer.prototype.", "Element.prototype.animate", "gZenFolders.openTabsPopup =", "folderFromNode("):
        assert token not in runtime, f"Native method override or dangling group helper: {token}"
    split_module = text(VARIANT / "src/js/09-split-drop-cards.js")
    standalone = text(SPLIT / "zia-split-tabs.uc.js")
    embedded = split_module[split_module.index('// Extracted from Zia'):split_module.rindex('\n  }')]
    def unchanged_split_parts(source):
        # 2.80.11 replaces only the selection timer with mouse-press tracking.
        source = source.replace('    lastSelect: null,\n    dragStartedAt: 0,\n', '').replace('    press: null,\n', '')
        begin = source.index('  const PRESS_SELECT_MS') if '  const PRESS_SELECT_MS' in source else source.index('  function splitTargetFor')
        source = source[:begin] + source[source.index('  function canSplitWith', begin):]
        begin = source.index('    window.addEventListener("dragend"') if 'splitDrop.lastSelect' in source else source.index('    window.addEventListener("mousedown"')
        source = source[:begin] + source[source.index('    window.addEventListener(\n      "drop"', begin):]
        return source.replace('        clearPress();\n', '')
    assert unchanged_split_parts(embedded) == unchanged_split_parts(standalone), "Unrelated split drop behavior differs from target mod"
    assert 'PRESS_SELECT_MS' not in embedded and 'lastSelect' not in embedded, "Split selection still uses a timing heuristic"
    assert 'splitDrop.press = tab ? { tab, selected: gBrowser.selectedTab } : null;' in embedded
    for helper in ('splitCardSource(', 'canBecomeSplitEssential(', 'addSplitToEssentials('):
        assert helper not in runtime, f"Dangling split-essential helper: {helper}"
    assert 'const cubicBezier = (x1, y1, x2, y2)' in runtime, "Reload hover lost its shared easing helper"
    assert runtime.count('setBoolPref("zen.splitView.enable-tab-drop", false)') == 1
    assert text(VARIANT / 'src/css/10-split-drop-cards.css').startswith(text(SPLIT / 'chrome.css') + '\n'), "Drop target styles differ from target mod"
    assert 'zenFolderActions' not in runtime, "Folder menus still overridden"
    for filename in ('05-tab-dragging.css', '06-folders-and-sidebar.css', '08-sidebar-details.css', '10-split-drop-cards.css', '17-tab-buttons.css'):
        css = text(VARIANT / 'src/css' / filename)
        assert 'zen-folder' not in css and 'tab-group:not(' not in css, filename
    assert '#zen-drag-indicator' not in text(VARIANT / 'chrome.css')
    assert '#zen-dragover-background' not in text(VARIANT / 'chrome.css')
    tab_styles = text(BASE / 'src/css/04-tabs-sound-bars-and-essentials.css')
    number_styles = tab_styles[tab_styles.index('/* Tab numbers (zia.uc.js)'):]
    assert text(VARIANT / 'src/css/04-tabs-sound-bars-and-essentials.css').endswith(number_styles), "Original tab-number visibility/styles lost"

    style = text(MEDIA / "chrome.css").replace("chrome://sine/content/zia-media-player/icons/",
                                            "chrome://sine/content/zia/icons/workspace-player/")
    style = style.replace('.zen-media-card[media-position-hidden]', '.zen-media-card:is([media-position-hidden], [zia-live])')
    assert text(VARIANT / "src/css/09-music-player.css") == '@media -moz-pref("zia.features.media-player") {\n' + style + '\n}\n'
    for name in ("sound-wave", "sound-muted"):
        assert (VARIANT / "icons/workspace-player" / f"{name}.svg").read_bytes() == (MEDIA / "icons" / f"{name}.svg").read_bytes()
    assert '@keyframes shrink' in text(VARIANT / 'icons/workspace-player/sound-still.svg'), "Paused fallback icon does not collapse"

    original_prefs = json.loads(text(BASE / "preferences.json"))
    new_prefs = json.loads(text(VARIANT / "preferences.json"))
    additions = [p for p in json.loads(text(MEDIA / "preferences.json")) if p.get("property")]
    removed_prefs = set(CONFIG["removedPreferences"])
    expected_prefs = [dict(p) for p in original_prefs if p.get('property') not in removed_prefs and p.get('label') != 'Folders']
    for pref in expected_prefs:
        if pref.get('property') == 'zia.features.tab-hover-cards':
            pref['label'] = 'Tab hover cards'
    assert [p for p in new_prefs if p not in additions and p.get("property") != "zia.toolbar.realtime-tint"] == expected_prefs, "Unrelated options changed"
    assert [p for p in new_prefs if p in additions] == additions
    assert [p for p in new_prefs if p.get('property') == 'zia.toolbar.realtime-tint'][0]['defaultValue'] is False
    assert len({p['property'] for p in new_prefs if 'property' in p}) == len([p for p in new_prefs if 'property' in p]), "Duplicate settings"
    for kind, extension, output in (("js", "js", "zia.uc.js"), ("css", "css", "chrome.css")):
        built = b"".join(p.read_bytes() for p in sorted((VARIANT / "src" / kind).glob(f"*.{extension}"), key=lambda p: p.name))
        assert built == (VARIANT / output).read_bytes(), f"Generated {output} differs from sources"
    manifest = json.loads(text(VARIANT / "theme.json"))
    original_manifest = json.loads(text(BASE / "theme.json"))
    for key in ("id", "style", "scripts", "preferences", "fork", "tags", "image"):
        assert manifest[key] == original_manifest[key], f"Original package wiring changed: {key}"
    assert re.fullmatch(r"\d+\.\d+\.\d+", manifest['version']), "Invalid fork version"
    assert tuple(map(int, manifest['version'].split('.'))) > tuple(map(int, CONFIG['upstream']['version'].split('.'))), "Fork release must be newer than its upstream base"
    for name, digest in CONFIG['protectedHashes'].items():
        normalized = (ROOT / name).read_bytes().replace(b'\r\n', b'\n')
        assert hashlib.sha256(normalized).hexdigest() == digest, f"Protected fork component changed: {name}; review before updating its recorded hash"
    for key, value in CONFIG['protectedPreferences'].items():
        assert next(p['defaultValue'] for p in new_prefs if p.get('property') == key) == value, f"Protected preference changed: {key}"
    assert sorted((ROOT / 'src/css').glob('*.css'))[-1].name == '99-fork-overrides.css', "Upstream added styles after fork overrides; review build order"
    overrides = text(ROOT / 'src/css/99-fork-overrides.css')
    assert 'translate: 0 -1px;' in overrides, "Sidebar text alignment lost"
    assert ':not([zia-panel-open="true"]) #zia-workspace-slot' in overrides, "Compact workspace visibility rule lost"
    assert '.tab-icon-stack::after' in overrides and 'content: none !important;' in overrides, "Media decoration suppression lost"
    assert 'zen-has-implicit-hover' in runtime and 'horizontalTranslate' in runtime and 'motion.ready.then' in runtime, "Zen 1.23 compact clipping support lost"
    assert 'flip", "slide"' in runtime, "Native folder preview sliding lost"
    print(f"Passed: {len(unchanged)} unrelated upstream files preserved byte-for-byte; native group/sidebar dragging retained; player and split behavior preserve target mods with documented fixes; no dangling split-essential helpers; generated files synchronized.")

if __name__ == "__main__":
    check()
