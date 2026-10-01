# Variant scope

- Base: Zia 2.80.4, commit `3345528607617b17be853f756c57fbe394ab11f7`.
- Player appearance/settings: Zia Media Player 1.0.8, commit `8364994b7f6daeb983f0cc42881ff648717141c6`.
- Variant version: 2.80.5.

Only the music-player CSS, workspace-color/opacity helpers and their startup
calls are changed in the feature sources. Existing media metadata/artwork,
sidebar sound bars, selected-tab glow and PiP behavior remain from upstream.
Every other feature source and existing preference entry is preserved.

The player's stylesheet is copied from the standalone mod, with asset paths
adapted to full Zia and guarded by the existing `zia.features.media-player`
setting. All of upstream's actors, PiP/PDF resources, icons and welcome files are
included. Sine still identifies this package as `zia`, so install it as a
replacement for upstream rather than enabling both together.

`scripts/build.sh --check` verifies the generated runtime files match `src/`.
The development workspace also has `tools/check_full_zia_variant.py` for
checking that non-player files and settings match the pinned upstream snapshot.

## Validation

Checked in an isolated headless Windows profile with Zen 1.22.3b:

- Actual audio playback and upstream artwork binding.
- Workspace player background and live 40%/90% default and 25%/75% custom opacity.
- Expanded height of 124px, centered play/pause, and controls on the bottom row.
- Original sidebar sound bars and two full Zia split-pane toolbars.
- Stable player workspace color when focusing another pane.
- Original music-player checkbox switches the player styling off and on.
- Quick Save Image saves a real image through Zen's download system.
- No mod errors during these checks.

The development command is `python tools/check_urlbar_live.py --full-zia`.
PiP, PDFs, folder interaction and other platforms were not separately exercised;
their feature sources and assets match upstream byte-for-byte.

Upstream updates require deliberately merging and checking the player changes;
this fork does not automatically pull future Zia changes.
