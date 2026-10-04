# Updating this fork

Use Python 3.10+, Node.js and Git. All required source fixtures and tests live
in this repository; no other mods or sibling checkouts are required. Clone
with history rather than downloading a ZIP, because preservation checks read
the upstream commit recorded in `fork.json`.

## Prepare an update

From a clean checkout:

```sh
python scripts/update_upstream.py --live --zen "C:/Program Files/Zen Browser/zen.exe"
```

The command fetches upstream and prepares a branch in a separate temporary
Git worktree. It preserves fork-owned modules/documentation, keeps explicitly
excluded files absent, merges shared source and preferences normally, rebuilds
the installed files, updates the version/base metadata and runs checks. It
prints the branch, worktree and result. It never changes the current checkout
or pushes/merges into `main`.

On a machine without Zen, omit `--live`. The candidate still gets static,
syntax, behavior and preservation checks, but needs the live check below before
publication. `--target REF` uses an already fetched commit without networking.
`--branch NAME` and `--worktree NEW_DIRECTORY` select the candidate's location.
`--report FILE` saves the result as JSON.

If there are shared-source conflicts, the candidate stays in its worktree
with the merge pending. Resolve and stage those files, then resume:

```sh
python scripts/update_upstream.py --resume "PATH_TO_CANDIDATE" --live --zen "PATH_TO_ZEN"
```

The same command resumes after a failed check without incrementing the version
twice. A changed upstream structure, preference or retained component can
require deliberate adjustment of `fork.json` or the checks. Inspect the actual
change before updating a protected hash; do not regenerate all hashes merely
to make an update pass.

After the candidate passes, review its diff and release notes. Then merge that
branch into `main` with a normal merge or fast-forward and push. Preserve merge
ancestry: avoid squashing/rebasing upstream import merges. Sine installs `main`,
so preparing a candidate does not update your browser.

## Run checks independently

```sh
python scripts/build.py
python scripts/check.py
python scripts/check.py --live --zen "PATH_TO_ZEN"
```

The first check verifies generated files, retained component fixtures, native
folders/dragging, excluded startup hooks, default preferences and protected
styles/modules. It also runs the Node behavior tests and disposable Git merge
tests for the updater. CI runs this command on pushes and pull requests.

Live checks launch two isolated headless Zen profiles and serve local test
pages/audio. They exercise glows, tab/workspace alignment, icon continuity,
folder previews, compact sidebar clipping, media layout/playback, split drops,
new upstream options and real-time tint. They never open your normal profile.
Artifacts stay in the ignored `.build/live/` directory. Set `ZEN_BINARY` instead
of passing `--zen` if preferred. `--quick-save PATH_TO_CHECKOUT` optionally
checks coexistence with Quick Save Image; it is not required.

## Automatic candidate preparation

The **Prepare upstream update** GitHub workflow checks weekly and can also be
run manually from the Actions tab. A clean import opens a **draft** PR after
static checks. A conflict or failed check produces a report instead. The
workflow never merges into `main`, and its draft PR explicitly requires live
Zen validation. It does not pretend GitHub ran browser/visual checks.

GitHub Actions must be enabled for this fork. If GitHub refuses draft PR
creation, enable **Allow GitHub Actions to create and approve pull requests**
under the repository's Settings → Actions → General. No personal access token
is required. Existing remote update branches are never force-pushed.

## Where custom changes belong

- `src/css/99-fork-overrides.css`: final appearance adjustments, including
  sidebar text alignment, hidden compact workspace labels and media decoration
  suppression. CSS that removes upstream folder styling still needs small
  patches in shared files; adding overrides cannot reliably undo all of it.
- `src/js/07a-fork-media-workspace.js`: workspace colours and opacity helpers.
- `src/js/01a-realtime-tint.js`: opt-in smoothed tint, off by default.
- `src/js/09-split-drop-cards.js` and `src/css/09-music-player.css`: complete
  retained replacements. The updater keeps these fork versions.
- Workspace caching, compact clipping, selected glows and shared native-folder
  fixes retain their small integration patches and browser regression checks.
- `fork.json`: upstream base, changed/shared files, fork additions, excluded
  features, whole-file ownership, component provenance and protected hashes.
- `tests/fixtures/`: pinned, licensed player/split references, excluded from
  installed archives. Upgrade these only when upgrading those components.

Add new custom files to `forkFiles`; record intentional shared-source changes
in `modifiedFiles`. Whole-file ownership is for complete replacements only:
marking a shared module owned would prevent future upstream fixes in that
module from being imported. Keep `forkFiles` and `ownedFiles` explicit.

When adding appearance changes, run the live checks before recording any new
protected hashes. Keep the final stylesheet last in the build. If upstream
changes the DOM or Zen changes an API, the relevant checks should stop the
update for review rather than silently accepting a different appearance.
