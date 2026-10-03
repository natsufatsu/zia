# Zia - custom media player edition

A fork of [Zia](https://github.com/z1n-k/zia) 2.86.1 with the layout,
workspace colors and opacity controls from
[Zia Media Player](https://github.com/natsufatsu/zia-media-player) 1.0.8.
Current version: **2.86.2**.

This edition uses **native Zen tab groups, folders and sidebar tab dragging**.
Zia's group boxes, colors, collapse animations, folder hover cards, naming,
extra group menus and custom sidebar dragging are removed.

Page drops use **Zia Split Tabs 1.0.7**: animated left/right targets, Zen's
rectangular icon-and-title preview, and movement updated once per animation
frame. Drop a background tab at either edge to split it beside the current page.
Dragging the current tab adds a new-tab pane. Moving back over the sidebar
restores the original preview; releasing in the center cancels the split.

The native split-drop default is disabled for this browser session to avoid
competing targets. If you explicitly set `zen.splitView.enable-tab-drop` to true
in about:config, set it to false. Native sidebar tab dragging remains intact.

The experimental split-essential tiles are removed;
existing essentials and native split tabs are preserved.

Selected tabs keep their glow and border shine while playing audio or muted,
including the first tab in a workspace. Media-only glow boxes, outlines and
animated notes above essential favicons stay hidden. Sidebar sound bars remain
available.

The URL bar, site-colored toolbar, page frame, split-pane toolbars, media
metadata/artwork, PiP, PDF viewer and other unrelated Zia features remain.
See [VARIANT.md](VARIANT.md) for the scope and validation.

Version 2.80.8 reduces startup work while retaining the same styles. Zia yields
to the other Sine scripts before initializing and sets up optional panels,
icon menus and hover cards in short idle slices. Tab decoration updates share
one animation frame and one final check after transitions settle; they stop
at the first visible row and no longer scan every tab every second.

Version 2.80.9 keeps the workspace indicator inside the sidebar in compact
mode. It stays hidden while the sidebar is closed and reappears when you reveal
the sidebar, including after a toolbar layout update. Startup optimizations
from 2.80.8 are retained.

Version 2.80.10 restores the original tab-number badge styles. Numbers appear
while Cmd/Ctrl is held and disappear on release; the optional always-show
setting still works. Number selection, highlighting and badge placement on
essentials and collapsed sidebar tabs are retained.

Version 2.80.11 restores ordinary and split-tab hover cards, reload hover
animation and the LIVE display for YouTube streams. Split dragging tracks the
mouse press instead of recent selection timing: dragging an already-selected
tab consistently adds a pane, while pressing a background tab to drag it
keeps the previous page as its split partner. Workspace icons and names use
the same centered line height, including on Windows.

Version 2.80.12 makes the player's waveform shrink into four dots when paused,
matching the standalone player. Resuming restores the moving bars; muted media
keeps the dots. Artwork colors and reduced-motion handling are retained.

Version 2.80.13 moves tab text up by 1px in the expanded sidebar for better
alignment with the favicons.

Version 2.80.14 skips first-row tab decoration scans while the compact sidebar
is hidden. Revealing the sidebar refreshes the decoration, including after
changing tabs while it was hidden.

Version 2.80.15 animates the toolbar clip with Zen's sidebar timing instead of
measuring the sidebar and rewriting the clip every frame. The toolbar still
stays hidden behind the sidebar as it moves, including on the right side.

Version 2.80.16 restores the selected-tab glow on playing and muted tabs and
the first workspace row, including splits. The first-row suppression watcher
and its layout scans are removed. Both white and favicon-colored glows work.
Native folder previews slide into the available screen space at the top or
bottom edge, keeping them beside their folder instead of flipping downward.

Version 2.80.17 switches workspace icons without a blank flash. Workspace SVGs
are preloaded and cached, and the label is reused across workspace switches.
If a new icon is still loading, the previous label stays visible until the
new icon and name can appear together. Late loads cannot overwrite a newer
workspace selection. Text icons and workspaces without icons remain supported.

Version 2.80.18 adds an optional experimental real-time toolbar tint under
Page settings. It uses the existing top-edge colour sampler every 100 ms,
with a time-based smoothing filter to reduce flashes while following changing
backgrounds. The normal tinting mode remains the default. Captures never
overlap, pause in hidden/minimized windows, and do not update saved site
colours. The setting takes effect immediately and needs the site-coloured
toolbar enabled.

Version 2.86.2 imports compatible upstream changes through 2.86.1: consistent
24px toolbar colour sampling, site-tinted toolbar ink, Zen 1.23 fixes, improved
Glance thumbnail exits, outlined tab-number keys, light sidebar support,
PDF menu styling and delayed copy-link recovery. New settings include workspace
name placement/hiding, two essentials per row, hiding the selected-tab glow,
edge-to-edge pages, new-tab address-bar focus and swipe history cards.

The custom workspace media player, native folders and sidebar dragging,
workspace SVG cache, selected audio/first-row glow fixes, sliding folder
previews, compact sidebar optimizations and optional real-time tint remain.
Upstream glass folders, custom folder naming/styling/dragging and split
essential tiles are excluded. The welcome tour only presents supported updates.
Compact toolbar clipping now follows Zen 1.23's sidebar slide animation,
including implicit hover, without restoring per-frame polling.

## Install or update

1. Enable unofficial JavaScript mods in Sine.
2. Remove original `z1n-k/zia` if installed, then install **`natsufatsu/zia`**.
3. Disable standalone Zia URL Bar, Zia Split Tabs and Zia Media Player:
   this package contains those features. Quick Save Image can remain enabled.
4. Restart Zen. If this fork is already installed, update it in Sine and restart.

In **Settings > Sine Mods > Zia (custom media player)**, adjust collapsed and
expanded player opacity. Defaults are 40% and 90%; changes apply immediately.
Preferences from the standalone player are reused. Removed group/drag options
are no longer shown and old values cannot enable the removed code.

## Validation

Checked in an isolated Windows profile with Zen 1.22.3b:

- Native group and folder collapse/expand, with group boxes matching Zen's CSS.
- Native animation, drag-image and folder methods remain unmodified.
- Native folder menus and sidebar drag methods are preserved.
- Scripted page drops create correctly ordered left/right splits; center drops
  cancel, previews clean up, and dragging the current tab adds a pane.
- No glow box or animated media badge on playing essential tabs.
- Selected-tab glow and border shine on first-row, playing, muted and split tabs,
  with both white and favicon-colored glows.
- Native folder preview placement near the top and bottom of either sidebar,
  with short and scrolling folder lists; native search and dismissal still work.
- Workspace icons remain visible while switching, including delayed SVG loads,
  cached swaps and switches made before a previous icon finishes loading.
- Actual audio playback, player artwork, live opacity and expanded layout.
- Two split-pane toolbars and stable player workspace color across pane focus.
- Ordinary/split tab hover cards, reload hover/reset and live-media styles.
- Workspace SVG/text-icon alignment and current/background split-drag targeting.
- Quick Save Image downloads a real image; no mod errors in these checks.

Run `node tests/split-drag-updates.cjs` for drag scheduling, release coordinates,
preview restoration, cancellation and mouse-press targeting checks. `node tests/startup-work.cjs`
checks startup scheduling and idle-work cancellation. The source build check is
`scripts/build.sh --check` (run through Bash).
The development workspace's `python tools/check_urlbar_live.py --full-zia --inspect
--compact-startup --compact-clipping-check` checks clipping against the sidebar
edge while opening, closing, reversing direction and resizing.
`python tools/check_urlbar_live.py --full-zia --inspect --tab-glow-check` checks
the selected glow and border shine across first/second rows, audio states and
both focused split panes, with favicon tinting on and off. It runs
`tests/tab-glow-live.js` in a privileged browser context through Marionette.
`python tools/check_urlbar_live.py --full-zia --inspect --folder-preview-check`
runs `tests/folder-preview-live.js` for folder popup positioning and search.
`python tools/check_urlbar_live.py --full-zia --inspect --workspace-icon-check`
runs `tests/workspace-icon-live.js` with native workspace switching, delayed
SVG loads and frame-by-frame visibility checks. Add `--compact-startup` for
the compact sidebar.
Physical drag latency, PiP, PDFs and other platforms were not separately exercised; their unrelated
feature code and assets are preserved from upstream.

## Credits

Original Zia by [z1n-k](https://github.com/z1n-k/zia).
Player variant by [natsufatsu](https://github.com/natsufatsu/zia-media-player).
The original license and icon licenses are retained. Refer to upstream for
general feature documentation; its group and drag customization descriptions
do not apply to this fork. Upstream updates are merged deliberately.
