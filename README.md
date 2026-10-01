# Zia - custom media player edition

A fork of [Zia](https://github.com/z1n-k/zia) 2.80.4 with the layout,
workspace colors and opacity controls from
[Zia Media Player](https://github.com/natsufatsu/zia-media-player) 1.0.8.
Current version: **2.80.11**.

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

Playing or muted tabs keep their favicon and mute controls without the glow
box, outline or animated notes above essential favicons. Sidebar sound bars
remain available.

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
- Actual audio playback, player artwork, live opacity and expanded layout.
- Two split-pane toolbars and stable player workspace color across pane focus.
- Ordinary/split tab hover cards, reload hover/reset and live-media styles.
- Workspace SVG/text-icon alignment and current/background split-drag targeting.
- Quick Save Image downloads a real image; no mod errors in these checks.

Run `node tests/split-drag-updates.cjs` for drag scheduling, release coordinates,
preview restoration, cancellation and mouse-press targeting checks. `node tests/startup-work.cjs`
checks startup scheduling, event bursts and selected-row decoration. The source build check is
`scripts/build.sh --check` (run through Bash).
Physical drag latency, PiP, PDFs and other platforms were not separately exercised; their unrelated
feature code and assets are preserved from upstream.

## Credits

Original Zia by [z1n-k](https://github.com/z1n-k/zia).
Player variant by [natsufatsu](https://github.com/natsufatsu/zia-media-player).
The original license and icon licenses are retained. Refer to upstream for
general feature documentation; its group and drag customization descriptions
do not apply to this fork. Upstream updates are merged deliberately.
