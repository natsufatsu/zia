# Variant scope

- Base: Zia 2.80.4, commit `3345528607617b17be853f756c57fbe394ab11f7`.
- Player layout/settings: Zia Media Player 1.0.8, commit `8364994b7f6daeb983f0cc42881ff648717141c6`.
- Previous variant: 2.80.6, commit `1356bc711716ad6014fc137315342c74883828f0`.
- Split-drop implementation: Zia Split Tabs 1.0.7, commit `5738b6e44a76c29582024f2986c6547ace5d6879`.
- Current variant: 2.80.7.

## Player

The player's CSS matches the standalone mod, with resource paths adapted to
`zia/icons/workspace-player/` and the original feature toggle retained.
Workspace/opacity helpers use the standalone implementation. Original media
metadata, artwork, playback, sound bars and PiP integration remain.

## Native groups and dragging

Removed Zia's folder/group styling, collapse animations, color menus, naming,
empty-folder slots, extra icon menu and folder hover-card replacement. The tab
hover-card feature remains, and Zen's folder popup is no longer intercepted.
Shared CSS/JS modules retain their unrelated tab, workspace and URL bar code.

Removed the upstream custom sidebar drag implementation, drag-image method
overrides, screenshot-based split-drop cards and split-essential feature.
Native sidebar drop indicators remain. Native split functionality and Zia's
pane toolbars are retained. Existing split-essential session tags are
released after session restore, without deleting or moving any tab or essential.
Only haptics explicitly marked as muted by the old drag code are restored.

Removed playing/muted-tab glow boxes and shine pseudo-elements. Native animated
music notes above essential favicons are hidden. The audio overlay is unframed;
its controls and sidebar sound bars remain.

Unrelated actors, PiP/PDF resources, icons, welcome files and feature sources
are preserved. Sine still identifies this package as `zia`, so it replaces
upstream Zia. Standalone Zia URL Bar, Split Tabs and Media Player should be off.
Quick Save Image can remain enabled.

## Standalone split-drop behavior

The exact Zia Split Tabs 1.0.7 script is embedded in its own scope inside
`src/js/09-split-drop-cards.js` and started through Zia's normal safe startup.
Its drop-target CSS is prepended to `src/css/10-split-drop-cards.css`; existing
pane and sidebar split styling is retained. No standalone actors are needed:
this implementation uses Zen's native preview structure, without screenshots
or scroll tracking. It does not patch native drag-image methods or sidebar
reordering.

Left/right targets follow the newest pointer position once per animation frame.
Drops use release coordinates, center releases cancel, previews restore over
the sidebar, and dragging the current tab creates a new-tab pane. Native
split-on-drop defaults are disabled for the session to avoid competing targets;
an explicit user setting of `zen.splitView.enable-tab-drop=true` must be turned
off, as in the standalone mod. Disable the separate Zia Split Tabs mod when
using this package.

## Validation

The development workspace uses `tools/check_full_zia_variant.py` to verify
unchanged upstream files, media CSS/helpers, remaining preferences and package
wiring. `scripts/build.sh --check` validates generated JS/CSS against `src/`.

`python tools/check_urlbar_live.py --full-zia` checks an isolated headless Windows
profile with Zen 1.22.3b. Native groups/folders collapse and reopen; their box
styling matches Zen with this stylesheet removed. Animation, drag-image and
folder methods match those captured before the mod loads. Native folder menus
are preserved. Native page-drop targets are replaced by the standalone targets. Playing essential tabs have no glow
box. Audio playback, artwork, default/custom opacity, 124px expanded card height,
centered bottom controls, split toolbars, pane focus and Quick Save Image pass
without mod errors. Scripted drag events exercise the integrated handlers in
Zen: correct left/right split order, rectangle previews, sidebar preview cleanup,
center cancellation and current-tab new panes all pass. The Node test exercises
the actual embedded source for frame coalescing, redundant mutations, release
targeting and canceled frames. Physical drag latency, PiP, PDFs and other
platforms were not separately exercised.

Upstream updates require deliberately merging and checking these changes.
