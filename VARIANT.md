# Variant scope

- Base: Zia 2.91.3, commit `ec48a6f`.
- Current variant: 2.91.4.
- Player: Zia Media Player 1.0.8, commit `8364994b7f6daeb983f0cc42881ff648717141c6`.

Only selected-tab glow fixes, workspace-icon caching, off-by-default real-time
tint and the workspace media player are protected fork features.

Other source, features, preferences and visual behavior follows upstream.
Earlier alignment, compact/startup, native-folder/dragging substitutions and
standalone split-drop replacements have been retired.

The updater checks out latest upstream, applies patches/adds custom modules,
rebuilds and checks unchanged upstream files byte-for-byte. Conflicts stop for
review; GitHub prepares draft PRs. Isolated Zen checks verify retained features.
See docs/fork-updates.md for commands and maintenance.
