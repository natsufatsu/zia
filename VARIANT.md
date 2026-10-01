# Variant scope

- Base: Zia 2.80.4, commit `3345528607617b17be853f756c57fbe394ab11f7`.
- Player layout/settings: Zia Media Player 1.0.8, commit `8364994b7f6daeb983f0cc42881ff648717141c6`.
- Previous variant: 2.80.5, commit `7fbfed07f0d531fa9f0e22e23923b273fa5d1252`.
- Current variant: 2.80.6.

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

Removed the custom sidebar drag implementation, drag-image overrides, custom
split-drop cards and split-essential feature. Native drop indicators and the
native split-drop preference are no longer overridden. Native page splitting
and Zia's pane toolbars are retained. Existing split-essential session tags are
released after session restore, without deleting or moving any tab or essential.
Only haptics explicitly marked as muted by the old drag code are restored.

Removed playing/muted-tab glow boxes and shine pseudo-elements. Native animated
music notes above essential favicons are hidden. The audio overlay is unframed;
its controls and sidebar sound bars remain.

Unrelated actors, PiP/PDF resources, icons, welcome files and feature sources
are preserved. Sine still identifies this package as `zia`, so it replaces
upstream Zia. Standalone Zia URL Bar, Split Tabs and Media Player should be off.
Quick Save Image can remain enabled.

## Validation

The development workspace uses `tools/check_full_zia_variant.py` to verify
unchanged upstream files, media CSS/helpers, remaining preferences and package
wiring. `scripts/build.sh --check` validates generated JS/CSS against `src/`.

`python tools/check_urlbar_live.py --full-zia` checks an isolated headless Windows
profile with Zen 1.22.3b. Native groups/folders collapse and reopen; their box
styling matches Zen with this stylesheet removed. Animation, drag-image and
folder methods match those captured before the mod loads. Native folder menus
and split-drop preferences are preserved. Playing essential tabs have no glow
box. Audio playback, artwork, default/custom opacity, 124px expanded card height,
centered bottom controls, split toolbars, pane focus and Quick Save Image pass
without mod errors. Physical drag/drop gestures, PiP, PDFs and other platforms
were not separately exercised.

Upstream updates require deliberately merging and checking these changes.
