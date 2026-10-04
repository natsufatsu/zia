# Variant scope

- Base: Zia 2.86.2, commit `49f4c93` (original base: 2.80.4, `3345528`).
- Player layout/settings: Zia Media Player 1.0.8, commit `8364994b7f6daeb983f0cc42881ff648717141c6`.
- Previous variant: 2.80.18, commit `1bf9062`.
- Split-drop implementation: Zia Split Tabs 1.0.7, commit `5738b6e44a76c29582024f2986c6547ace5d6879`.
- Current variant: 2.86.10.

## Folder copy icon (2.86.10)

Replace the Copy links text with the tab hover card's paperclip icon in a
32px square button, retaining an accessible label and tooltip. Reuse the
existing animated checkmark confirmation. The narrower button gives search
more room; all-folder URL copying and keyboard isolation remain unchanged.

## Compact folder preview controls (2.86.9)

Use a rectangular search field with the search icon inside it and an adjacent
Copy links button styled to the supplied reference. Explicitly reset Zen's
native input theme so it cannot add a second rounded border inside the field.
Copy every non-closing, non-placeholder folder tab URL in folder order,
one per line, independently of search filtering. Since 2.86.10 the button uses
an icon and checkmark confirmation instead of text.

Restore the original New Tab row markup and shared row styles. Keep it fixed
below the scrolling list, with the original tab gap and bottom inset; remove
the separate footer border and excess padding. Live checks verify row sizing,
spacing, copied URLs, keyboard isolation and fixed controls on both sidebars.

## Folder preview keyboard fix (2.86.8)

Zen installs document-wide keyboard handlers before opening its folder popup
and removes them when the popup closes. Canceling `popupshowing` left those
handlers active, intercepting website Tab, arrow and Enter keys after hovering
a folder. Skip the native open path before it installs handlers while custom
cards are enabled. Disabling cards delegates to the original popup method.

Remove preview Enter/Escape shortcuts and automatic Tab focus on preview
controls. Mouse selection, typed search, fixed New Tab, scrolling and hover
cards remain. Live checks repeat native open attempts and verify no leaked
handlers, then send real Tab, Enter and left/right keys to webpage controls.
Restart Zen after updating to clear handlers leaked by earlier versions.

## Search and fixed preview controls (2.86.7)

Folder cards have a fixed search header and New Tab footer. Only their tab
list scrolls, with a height that fits the window. Filtering matches titles
and URLs without moving the footer. A no-results message leaves New Tab
available. Search resets when reopening a card or switching folders.

The search input survives mute/close/unload refreshes, retaining its query
and focus. Typing keeps the preview and compact sidebar open; clicking outside
dismisses it. The original Enter/Escape shortcuts were removed in 2.86.8.
Browser checks cover these behaviors and
fixed controls before and after scrolling on either sidebar.

## Folder hover previews (2.86.6)

Based on the restored 2.86.4 tree. Import only the folder-card portions of
upstream `27-hover-cards.js` and `07-hover-cards.css` through `ec48a6f`, including
preview padding measured from a sidebar tab. Preserve the fork's ordinary-tab
source, native folder styling, native dragging and all other modules.

Hovering a collapsed folder opens its tab list, with tab selection, close/mute
controls and New Tab. Placement clamps to the window on either sidebar and
long lists scroll. Entering the preview holds a compact sidebar open. The
existing tab-hover-card setting now reads **Tab and folder hover cards**.
Disabling it dismisses the card and restores Zen's searchable popup.

The original `popupshowing` cancellation was replaced in 2.86.8 with an early
gate on `openTabsPopup` to avoid leaking native keyboard handlers. Other native
folder methods remain unchanged. Folder colors, naming, animated
icons, custom dragging and split-essential behavior remain excluded.
`tests/folder-hover-card-live.js` exercises placement, contents, scrolling,
selection, mute/close/New Tab, compact sidebar holding and feature disabling.
The original native preview checks run with the feature disabled.

## Update workflow (2.86.4)

`fork.json` records the imported upstream commit, shared patches, replacements,
excluded files/hooks/preferences, retained component provenance and protected
hashes/defaults. Portable checks read that Git commit and checked-in fixtures;
they no longer require development workspace paths or standalone checkouts.

`scripts/update_upstream.py` prepares an isolated worktree, retains declared
replacements, merges shared files, regenerates outputs and runs checks. Source
conflicts and failed checks stop in a resumable candidate. It never publishes
to main. CI runs preservation, Node behavior and updater merge tests; the
weekly/manual GitHub workflow opens draft PRs only after those pass. Live Zen
validation remains required before publication.

The text alignment, compact workspace hiding and media-only decorations are
now in `src/css/99-fork-overrides.css`. Player workspace/opacity helpers are in
`src/js/07a-fork-media-workspace.js`; the compiled JavaScript remains identical
to 2.86.3. Mixed upstream/fork modules keep their integration patches. See
`docs/fork-updates.md` for usage and how to maintain the ownership manifest.

## Upstream 2.86.2 import (2.86.3)

Imported the upstream page/toolbar, address bar, find bar, Glance preview,
PDF menu, outlined tab-number, welcome-tour and compatible sidebar updates.
Windows page corners use Zen's native inner radius, as in upstream 2.86.2.
The toolbar sampler now consistently reads a 24px band in both normal and
experimental mode, fixing conflicting readings on thin strips. Experimental
sampling/filter timing and its off-by-default setting are unchanged.

New optional settings cover workspace name hiding/placement, two essentials
per row, selected-tab glow suppression, edge-to-edge pages and new-tab
address-bar focus. Swipe history cards follow upstream's default-on setting.
The swipe tap reads Zen's haptic preference directly, as this fork removed
the custom drag haptics/muting helpers. Light sidebar rules retain native
folder styling and honour the optional no-glow setting.

Excluded the new glass folder CSS/JS and updates to removed folder naming,
empty-slot and custom drag logic. The custom player and split-drop module,
first-row/audio glows, native folder preview sliding and cached workspace
icons are retained. The workspace-location observer uses the fork's existing
coalesced updates, preserving cached synchronous icon changes. The welcome
tour omits glass folders and the removed split-essential action.

Compact toolbar clipping also follows Zen 1.23's `translate` transitions
and implicit-hover reveal state, retaining the previous `left`/`right`
support. It mirrors the native animation without per-frame geometry reads.
Live left/right reveal, hide, reversal and resize checks pass with at most
four inline mutations per phase.

`tests/upstream-2861-live.js` covers delayed copy-link insertion, workspace
placement/name settings, dark/light glow toggles, two-column essentials,
edge-to-edge pages, Windows page corners, swipe history cards and stable
thin-strip tinting. Run it in the development workspace with `python tools/check_urlbar_live.py
--full-zia --inspect --upstream-check --tab-number-check`. Existing real-time
tint, workspace icon, folder preview, selected glow, media and split checks
remain applicable. The import is validated with Zen 1.23b.

## Experimental real-time tint (2.80.18)

The new `zia.toolbar.realtime-tint` checkbox is off by default and requires
`zia.toolbar.site-color`. It retains the current top-edge/dominant-colour
sampler and adds serialized sampling at most every 100 ms. An exponential
filter with a 250 ms time constant smooths the tint on animation frames;
the toolbar's extra CSS background transition is disabled in this mode.
The normal load, scroll and three-second drift checks remain intact when
the mode is off. Experimental mode replaces their confirmation gates with
the smoothing filter, so low-share or moving readings can keep updating.

Filtered colours are cached per browser/document in memory, independently
of the legacy tab cache and persisted site colours. Tab switches restore
cached colours immediately; stale captures cannot update another tab or a
new document. Sampling and painting pause while the window is hidden or
minimized and stop on unload or when either setting is disabled. Error
pages retain their existing handling, and the open URL popup keeps its
existing frozen tint. Split-pane bars retain their existing tint logic.

`node tests/realtime-tint.cjs` checks rate limits, smoothing across frame
rates, low-share readings, legacy isolation, slow captures, loading,
visibility, tab/document races, pref changes and cleanup. The development
workspace's `python tools/check_urlbar_live.py --full-zia --inspect
--realtime-tint-check` uses an actual page with timed background changes,
checks intermediate values and rapid alternation, and verifies cached tab
restoration and returning to the default mode.

## Player

The player's CSS uses the standalone layout, with resource paths adapted to
`zia/icons/workspace-player/` and the original feature toggle retained. Its
live-media selectors also recognize the original YouTube `zia-live` marker.
Workspace/opacity helpers use the standalone implementation. Original media
metadata, artwork, playback, sound bars and PiP integration remain.
Paused cards use the shrinking-dot image from the standalone player instead
of the original stationary bars. Sidebar sound-bar rendering is unchanged.

## Native groups and dragging

Removed Zia's folder/group styling, collapse animations, color menus, naming,
empty-folder slots and extra icon menu. Tab and folder hover cards are retained
as of 2.86.6. Zen's folder popup remains available when those cards are disabled,
and its folder creation and icon methods remain unchanged. Its popup open
method delegates to the original implementation when custom cards are disabled.
Shared CSS/JS modules retain their unrelated tab, workspace and URL bar code.

Removed the upstream custom sidebar drag implementation, drag-image method
overrides, screenshot-based split-drop cards and split-essential feature.
Native sidebar drop indicators remain. Native split functionality and Zia's
pane toolbars are retained. Existing split-essential session tags are
released after session restore, without deleting or moving any tab or essential.
Only haptics explicitly marked as muted by the old drag code are restored.

Removed media-only glow boxes and shine pseudo-elements on essentials and
unselected playing/muted tabs. Selected regular tabs retain their selection
glow and border shine. Native animated music notes above essential favicons
are hidden. The audio overlay is unframed; its controls and sound bars remain.

The native folder preview uses `flip="slide"` instead of the arrow panel's
default `flip="both"`. Zen's negative vertical offset otherwise reverses near
the top of the screen, displacing the popup downward. Sliding keeps the preview
beside its folder while fitting it to the screen. No folder method is replaced.

Unrelated actors, PiP/PDF resources, icons, welcome files and feature sources
are preserved. Sine still identifies this package as `zia`, so it replaces
upstream Zia. Standalone Zia URL Bar, Split Tabs and Media Player should be off.
Quick Save Image can remain enabled.

## Standalone split-drop behavior

The Zia Split Tabs 1.0.7 script is embedded in its own scope inside
`src/js/09-split-drop-cards.js` and started through Zia's normal safe startup.
Its selection-timing heuristic is replaced by a snapshot of the selected tab
at the beginning of the mouse press. Completed clicks cannot affect the next
drag, and a background-tab press keeps its partner regardless of hold duration.
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

### Workspace icon continuity (2.80.17)

The workspace label is reused when native indicators move into the sidebar
slot. Parsed and sanitized SVGs are cached by URL; inactive workspace icons
are preloaded and concurrent requests share one fetch. Cached icons are applied
synchronously. A pending icon keeps the complete previous label visible until
the new icon and name are ready. A request counter rejects stale completions
after another workspace or icon is selected. Failed loads can be retried on
the next update. Workspace events coalesce in a microtask before repaint.
The original SVG recoloring, URL restrictions and sanitizer remain in place.

`python tools/check_urlbar_live.py --full-zia --inspect --workspace-icon-check`
runs `tests/workspace-icon-live.js` with native workspace switches. SVG loads
are delayed deliberately while animation frames are sampled: the label stays
connected and visible, each SVG is fetched once, cached switches show the
correct icon immediately, and a late response cannot change the current icon.
Text and iconless workspaces are also checked. Add `--compact-startup` to run
against the revealed compact sidebar. The existing `--workspace-check` tests
hidden/revealed indicator placement and compact-mode changes.

### Selected-tab glow (2.80.16)

The media override now preserves the selected regular tab's shadow and border
shine while playing or muted. The first-row suppression watcher and its CSS
are removed, so the first workspace row also glows, including split groups.
This removes the watcher's event listeners, observers and layout scans.

`python tools/check_urlbar_live.py --full-zia --inspect --tab-glow-check` runs
`tests/tab-glow-live.js` to check shadows and shine in isolated Zen: first/second rows across
normal, playing, muted and playing/muted states, plus each focused pane of a
first-row split, with favicon tinting on and off. The full live check also
checks selected glow during actual audio playback and muting, while selected
playing essentials remain free of media frames and animated notes.
`tests/startup-work.cjs` retains the idle startup and cancellation checks;
its obsolete first-row suppression assertions are removed.

### Native folder preview placement (2.80.16)

`python tools/check_urlbar_live.py --full-zia --inspect --folder-preview-check`
runs `tests/folder-preview-live.js`. Two- and eight-tab folders are checked near
the top, middle and bottom of both left and right sidebars. The popup stays
within the screen and beside its anchor; native search filters entries and
resets on dismissal. Since 2.86.8 the popup gate delegates to the original
`openTabsPopup` implementation when custom hover cards are disabled.
The test also restores `flip="both"` temporarily to reproduce the original
displacement: a folder at y=10 opens its preview at y=154 instead of y=0.
Add `--compact-startup` to check the revealed compact sidebar as well.

### Startup work (2.80.8)

The main startup routine yields one event-loop turn so Sine can load its other
scripts first. Core URL bar, site color, player, split handlers and actors still
initialize together. Optional panels, icon setup, welcome tour, glance thumbnails,
hover cards and extension icons initialize in idle slices with a 4ms budget and
a 250ms timeout for a busy browser. An individual initializer can exceed that
budget; the scheduler yields between initializers. Closing the window cancels
pending work. Synchronous and asynchronous initializer failures are logged.

In 2.80.8, selected-tab edge decoration reacted to tab/workspace/layout events instead
of polling every second. Event bursts share a single animation frame and a
debounced settled check. Only the first visible row is measured in Zen's
workspace containers. Unchanged decoration does not rewrite attributes.
Stylesheets, other feature modules, preferences and icon assets are unchanged.

At that version, `tests/startup-work.cjs` checked peer scheduling, bounded slices, unload
cancellation, coalesced event bursts and retained first-row/split behavior.
The development workspace's `tools/profile_zia_startup.py` compares isolated
Zen profiles with cold and warm icon caches. It measures sequential script
loading after Zen is ready, not total desktop startup time. The synthetic
60-tab/200-event case checks scaling; it does not reproduce a user's restored
session or the complete set of side mods.

On Windows with Zen 1.22.3b, the same 60-tab/200-event run produced 35,821
layout reads in 2.80.7 and 12 in 2.80.8. Warm sequential script execution,
with Sine's `ignoreCache: true`, measured 43.5ms before and 12.3ms after;
cold execution measured 92.4ms and 52.2ms. These are individual local runs
with profiling instrumentation, not a promised browser launch speedup.

### Compact sidebar indicator (2.80.9)

The compact-mode top row is placed under the titlebar only when the titlebar
is inside the sidebar. If a toolbar layout update moves that titlebar into
the address-bar row, the sidebar's top buttons remain inside the sidebar.
Filtered mutation notifications detect these layout changes without polling.
A scoped compact-mode rule also hides the workspace slot while the flyout
sidebar is closed. Revealing the sidebar restores the indicator; normal and
toolbar-only compact modes retain their workspace indicator.

`python tools/check_urlbar_live.py --full-zia --compact-startup --workspace-check`
checks initial compact startup, sidebar reveal/hide, normal mode, mode toggles,
toolbar-only mode and a simulated later titlebar reparenting in an isolated
Zen 1.22.3b profile. The reparenting case fails on 2.80.8 and passes on 2.80.9.
It represents a layout change, rather than a reproduction of every installed
side mod. The 2.80.8 startup module remains byte-for-byte unchanged.

### Tab-number visibility (2.80.10)

The earlier split-essential stylesheet cleanup truncated the tab-number rules
that followed it. Cmd/Ctrl created the number elements, and release correctly
cleared the held flag, but the elements remained visible without their default
hidden style. The original upstream tab-number CSS is restored verbatim,
including held/always-show visibility, target highlighting, essential/collapsed
badge placement and reduced-motion handling. Keyboard handlers, preferences,
the generated JS and startup/compact-mode fixes are unchanged.

`python tools/check_urlbar_live.py --full-zia --tab-number-check` injects chrome
key events into isolated Zen 1.22.3b and checks computed badge styles, repeated
press/release, selection on modifier release, other-shortcut cancellation and
the always-show preference. The release-visibility case fails on 2.80.9 and
passes on 2.80.10. The static preservation check also requires the exact original
CSS block so future split-essential cleanup cannot remove it again.

### Audit fixes (2.80.11)

Tab hover cards use their own tab directly after removal of split-essential
helpers. Split panes hide the unsupported Add to Essentials action; ordinary
tabs retain it. Reload hover keeps its easing helper in the address-bar module.
YouTube live cards hide their seeking controls and show LIVE, while recorded
media retains seeking. Workspace text, SVGs and text icons use centered 16px
line boxes. Windows glyphs receive a 1px optical correction, replacing the
previous 2px offset; the SVG wrapper remains centered beside the text.

`python tools/check_urlbar_live.py --full-zia --inspect --regression-check`
checks ordinary/split hover rendering and actions, reload hover/reset, live
and recorded media styles, sharing visibility, and workspace alignment at
two text sizes. Live styles are tested with the actor's marker on a test card,
without relying on an external stream. Full split checks include immediate
current-tab dragging and a background-tab press held longer than 1.5 seconds.
The inherited tab-number highlight/reorder edge case is unchanged.

### Paused waveform (2.80.12)

The player uses the existing animated dots for its paused state. Its native
playback-state observer refreshes the image on pause/resume, so each pause
starts the collapse again. Muted media retains dots, while ordinary playback
uses the moving waveform. Artwork colors and reduced-motion behavior remain.
The fallback paused icon also collapses while artwork colors are loading.

`python tools/check_urlbar_live.py --full-zia` sends actual Zen player commands
to locally playing audio, checks two pause/resume cycles and mute transitions,
and renders the selected paused SVG to verify four centered 2px dots after the
collapse animation. The preservation check allows only this one player-state
assignment to differ from the previously retained upstream logic.

### Feature preservation

In 2.80.15, compact toolbar clipping takes one batch of geometry measurements
per state or size change and uses browser animations with the native sidebar
transition's endpoints, duration, easing and start time. It no longer polls
the sidebar until eight unchanged frames have elapsed. Left/right opening,
closing and interrupted slides retain their clipping; expanding the address
bar and leaving compact mode clear it. Resize and layout observers refresh
the geometry and are disconnected on window unload.
The development workspace's `--compact-clipping-check` live check compares
the animated clip with the actual sidebar edge throughout those transitions
and checks that inline clipping is not rewritten continuously.

In 2.80.14, first-row decoration skips its queries and geometry reads when
compact mode hides the tab sidebar. It keeps the previous decoration while
hidden and refreshes on reveal, compact-mode exit or a change to the native
hide-tabbar preference. Toolbar-only compact mode continues updating normally.
The visibility observer and preference listener are removed on window unload.
At that version, `node tests/startup-work.cjs` checked hidden scans, reveal after selection changes,
toolbar-only mode, compact-mode exit and cleanup.

Tab text is translated upward by 1px in the expanded sidebar in 2.80.13.
The offset applies to non-essential tab labels, including selected, background,
pinned and split tabs. Favicons, controls, row heights and group names retain
their positions. A live layout comparison with the translation disabled checks
the 1px text movement and unchanged surrounding geometry.

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
