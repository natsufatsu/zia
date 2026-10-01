# Zia - custom media player edition

A fork of [Zia](https://github.com/z1n-k/zia) 2.80.4 with the layout,
workspace colors and opacity controls from
[Zia Media Player](https://github.com/natsufatsu/zia-media-player) 1.0.8.
Current version: **2.80.6**.

This edition uses **native Zen tab groups, folders and tab dragging**.
Zia's group boxes, colors, collapse animations, folder hover cards, naming,
extra group menus and custom dragging are removed. Zen handles dragging and
dropping tabs into splits. The experimental split-essential tiles are removed;
existing essentials and native split tabs are preserved.

Playing or muted tabs keep their favicon and mute controls without the glow
box, outline or animated notes above essential favicons. Sidebar sound bars
remain available.

The URL bar, site-colored toolbar, page frame, split-pane toolbars, media
metadata/artwork, PiP, PDF viewer and other unrelated Zia features remain.
See [VARIANT.md](VARIANT.md) for the scope and validation.

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
- Native folder icon menu and split-drop preference are preserved.
- No glow box or animated media badge on playing essential tabs.
- Actual audio playback, player artwork, live opacity and expanded layout.
- Two split-pane toolbars and stable player workspace color across pane focus.
- Quick Save Image downloads a real image; no mod errors in these checks.

The source build check is `scripts/build.sh --check` (run through Bash).
PiP, PDFs and other platforms were not separately exercised; their unrelated
feature code and assets are preserved from upstream.

## Credits

Original Zia by [z1n-k](https://github.com/z1n-k/zia).
Player variant by [natsufatsu](https://github.com/natsufatsu/zia-media-player).
The original license and icon licenses are retained. Refer to upstream for
general feature documentation; its group and drag customization descriptions
do not apply to this fork. Upstream updates are merged deliberately.
