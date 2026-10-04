# Zia - custom media player edition

A fork of [Zia](https://github.com/z1n-k/zia) 2.91.3 with retained customizations and alignment fixes.
Current version: **2.91.5**.

- Glow fixes for the first workspace tab and playing/muted selected tabs, including splits.
- Workspace-icon preloading/caching and stable labels without blank flashes.
- Optional real-time URL-bar tint: the existing sampler every 100 ms, with 250 ms smoothing; off by default.
- Workspace media player from [Zia Media Player](https://github.com/natsufatsu/zia-media-player) 1.0.8: workspace colours, 40%/90% opacity, centered controls and a paused waveform that shrinks into dots.
- Sidebar text alignment, centered workspace SVG/text icons and Windows optical alignment.

Other source and visual behavior follows upstream 2.91.3, including folders,
glass icons, sidebar styling/dragging, folder previews, split drops and startup.
Earlier compact/startup, native-folder/dragging substitutions and
standalone split replacements have been retired.

## Install or update

1. Enable unofficial JavaScript mods in Sine.
2. Install **natsufatsu/zia**, replacing the original z1n-k/zia if installed.
3. Disable standalone Zia URL Bar, Zia Split Tabs and Zia Media Player.
4. Update the fork in Sine and restart Zen.

Player opacity settings reuse the standalone player's preferences. Experimental
real-time tint is under Page settings and requires the site-coloured toolbar.

## Future updates

Latest upstream source -> apply retained features and alignment fixes -> build/check -> draft PR.

See [Updating this fork](docs/fork-updates.md) for commands and patch maintenance,
[VARIANT.md](VARIANT.md) for scope and [CHANGELOG.md](CHANGELOG.md) for release history.
