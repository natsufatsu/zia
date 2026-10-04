"""Preserve four custom features while keeping all other upstream source intact."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def check():
    if sys.flags.optimize:
        raise RuntimeError('Run checks without Python -O: assertions must be enabled')
    config = json.loads((ROOT / 'fork.json').read_text(encoding='utf-8'))
    assert config['schema'] == 2 and 'ownedFiles' not in config
    assert config['retainedFeatures'] == ['tab-glow-fixes', 'workspace-icon-cache', 'realtime-tint', 'workspace-media-player']
    assert not config['excludedFiles'] and not config['removedPreferences'], 'Unrelated upstream features must remain'
    assert config['removedHooks'] == ['watchEdgeGlow']
    assert set(config['documentationOverlays']) <= {'README.md', 'CHANGELOG.md'}
    base = config['upstream']['commit']
    upstream = set(git('ls-tree', '-r', '--name-only', base).decode().splitlines())
    changed, added = set(config['modifiedFiles']), set(config['forkFiles'])
    files = set(git('ls-files', '-co', '--exclude-standard').decode().splitlines())
    files = {name for name in files if (ROOT / name).is_file()}
    assert not added & upstream, 'Shared files require patches'
    assert files == upstream | added, f'Unclassified/missing files: {files ^ (upstream | added)}'
    def original(name): return git('show', f'{base}:{name}').decode('utf-8')
    def text(name): return (ROOT / name).read_text(encoding='utf-8')
    for name in upstream - changed:
        assert git('show', f'{base}:{name}') == (ROOT / name).read_bytes(), f'Unrelated upstream file changed: {name}'
    allowed_source = {'src/css/01-page-card-and-toolbar.css', 'src/css/05-tab-dragging.css',
                      'src/css/09-music-player.css', 'src/js/01-site-colour.js',
                      'src/js/04-space-label.js', 'src/js/08-music-and-sound-bars.js', 'src/js/29-start.js'}
    assert {name for name in changed if name.startswith('src/')} <= allowed_source, 'Unrelated source patch reintroduced'

    player = text('src/js/08-music-and-sound-bars.js')
    restored = player.removeprefix('\n').replace('        updateMediaWorkspace(card);\n', '')
    restored = restored.replace('element.style.setProperty("--zia-sound-still", fresh.dots);',
                                'element.style.setProperty("--zia-sound-still", fresh.still);')
    assert restored == original('src/js/08-music-and-sound-bars.js'), 'Unrelated player code changed'
    media = text('tests/fixtures/media-player/zia-media-player.uc.js')
    def between(value, start, end):
        index = value.index(start)
        return value[index:value.index(end, index)]
    helpers = between(media, "  // Use the media tab's own space", '  const mediaColorCache')
    helpers += between(media, '  function watchMediaOpacity()', '  function start()')
    assert text('src/js/07a-fork-media-workspace.js') + '\n' == helpers
    style = text('tests/fixtures/media-player/chrome.css').replace('chrome://sine/content/zia-media-player/icons/',
                                                               'chrome://sine/content/zia/icons/workspace-player/')
    style = style.replace('.zen-media-card[media-position-hidden]', '.zen-media-card:is([media-position-hidden], [zia-live])')
    assert text('src/css/09-music-player.css') == '@media -moz-pref("zia.features.media-player") {\n' + style + '\n}\n'
    assert '@keyframes shrink' in text('icons/workspace-player/sound-still.svg')
    for icon in ('sound-wave', 'sound-muted'):
        assert (ROOT / f'icons/workspace-player/{icon}.svg').read_bytes() == (ROOT / f'tests/fixtures/media-player/icons/{icon}.svg').read_bytes()

    startup = original('src/js/29-start.js').replace('    safely("watchEdgeGlow", watchEdgeGlow);\n', '')
    startup = startup.replace('    ifOn("media-player", "watchMediaGlow", watchMediaGlow);',
                              '    ifOn("media-player", "watchMediaOpacity", watchMediaOpacity);\n'
                              '    ifOn("media-player", "watchMediaGlow", watchMediaGlow);\n'
                              '    ifOn("media-player", "watchMediaWorkspace", watchMediaWorkspace);')
    startup = startup.replace('    safely("watchColorDrift", watchColorDrift);',
                              '    safely("watchRealtimeTint", watchRealtimeTint);\n    safely("watchColorDrift", watchColorDrift);')
    assert text('src/js/29-start.js') == startup, 'Unrelated upstream startup behavior changed'
    assert 'tabbrowser-tab[zia-no-glow]' not in text('src/css/05-tab-dragging.css')
    assert 'translate: 0 -1px' not in text('src/css/99-fork-overrides.css'), 'Unrequested alignment patch retained'
    for token in ('spaceIconCache = new Map()', 'warmSpaceIcons()', 'request === spaceLabelRequest', 'svg.cloneNode(true)'):
        assert token in text('src/js/04-space-label.js'), f'Workspace cache missing: {token}'

    old_prefs = json.loads(original('preferences.json'))
    prefs = json.loads(text('preferences.json'))
    additions = {'zia.media-player.opacity.collapsed', 'zia.media-player.opacity.expanded', 'zia.toolbar.realtime-tint'}
    assert [p for p in prefs if p.get('property') not in additions] == old_prefs, 'Unrelated upstream settings changed'
    properties = [p['property'] for p in prefs if 'property' in p]
    assert len(set(properties)) == len(properties), 'Duplicate setting'
    for key, value in config['protectedPreferences'].items():
        assert next(p for p in prefs if p.get('property') == key)['defaultValue'] == value, f'Default changed: {key}'
    for name, expected in config['protectedHashes'].items():
        assert hashlib.sha256(text(name).encode('utf-8')).hexdigest() == expected, f'Protected component changed: {name}'
    print(f'Passed: {len(upstream - changed)} upstream files intact; four retained features, player fixtures and settings preserved.')


if __name__ == '__main__':
    check()
