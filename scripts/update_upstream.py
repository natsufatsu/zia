"""Start with upstream, apply the fork's patches, and check a separate candidate."""
from pathlib import Path
import argparse
import datetime
import json
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
GENERATED = {"chrome.css", "zia.uc.js"}
DOCUMENTATION = {"README.md", "CHANGELOG.md"}


def git(root, *args, check=True):
    result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, encoding="utf-8")
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result


def blob(root, ref, name):
    return git(root, "show", f"{ref}:{name}").stdout


def write(path, source):
    path.write_text(source, encoding="utf-8", newline="\n")


def next_version(ours, upstream):
    def parts(value):
        if not re.fullmatch(r"\d+\.\d+\.\d+", value):
            raise ValueError(f"Unsupported version: {value}")
        return tuple(map(int, value.split(".")))
    major, minor, patch = max(parts(ours), parts(upstream))
    return f"{major}.{minor}.{patch + 1}"


def report(result, report_path):
    if report_path:
        write(report_path, json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2), flush=True)


def state_path(root):
    return Path(git(root, "rev-parse", "--path-format=absolute", "--git-path", "zia-update/state.json").stdout.strip())


def save_state(root, state):
    path = state_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    write(path, json.dumps(state, indent=2) + "\n")


def names(root, ref):
    return set(git(root, "ls-tree", "-r", "--name-only", ref).stdout.splitlines())


def validate_policy(root, config, source):
    if config.get("schema") != 2 or "ownedFiles" in config:
        raise RuntimeError("The updater requires the upstream-first schema 2 policy.")
    baseline = config["upstream"]["commit"]
    modified, added, excluded = (set(config[key]) for key in ("modifiedFiles", "forkFiles", "excludedFiles"))
    overlays = set(config["documentationOverlays"])
    if not overlays <= DOCUMENTATION or not overlays <= modified:
        raise RuntimeError("Only fork README/changelog may replace shared files without a source patch.")
    if modified & added or excluded & (modified | added):
        raise RuntimeError("Fork file classifications overlap.")
    base_names, fork_names = names(root, baseline), names(root, source)
    if added & base_names:
        raise RuntimeError(f"Shared files must use patches, not forkFiles: {sorted(added & base_names)}")
    if fork_names != (base_names - excluded) | added:
        raise RuntimeError("Fork additions/removals differ from fork.json; classify them before updating.")
    changed = set(git(root, "diff", "--no-renames", "--name-only", baseline, source).stdout.splitlines())
    if changed - modified - added - excluded:
        raise RuntimeError(f"Unclassified fork edits: {sorted(changed - modified - added - excluded)}")
    return sorted((modified - GENERATED - overlays - {"theme.json"}) | excluded), sorted(added), sorted(overlays)


def apply_customizations(root, worktree, state, config):
    """Copy only new fork files/docs; shared runtime always goes through patches."""
    patches, additions, overlays = validate_policy(root, config, state["source"])
    target_names = names(root, state["target"])
    pending = {}
    for name in additions:
        if name in target_names:
            # An upstream file with a new fork module's name needs explicit review.
            pending[name] = "Upstream now supplies this path; the fork file was not copied over it."
        else:
            git(worktree, "restore", "--source=" + state["source"], "--staged", "--worktree", "--", name)
    for name in overlays:
        git(worktree, "restore", "--source=" + state["source"], "--staged", "--worktree", "--", name)
    patch_dir = state_path(worktree).parent / "patches"
    patch_dir.mkdir(exist_ok=True)
    patch_records = []
    for index, name in enumerate(patches):
        patch = subprocess.check_output(["git", "diff", "--no-ext-diff", "--no-textconv", "--no-renames",
                                         "--binary", "--full-index", state["baseline"], state["source"], "--", name], cwd=root)
        if not patch:
            continue
        path = patch_dir / f"{index:03d}.patch"
        path.write_bytes(patch)
        patch_records.append({"file": name, "patch": str(path)})
        applied = git(worktree, "apply", "--index", "--whitespace=nowarn", str(path), check=False)
        if applied.returncode:
            pending[name] = applied.stderr.strip() or applied.stdout.strip()
    state["patches"] = patch_records
    state["pending"] = pending
    save_state(worktree, state)


def prepare_metadata(worktree, state):
    config = json.loads((worktree / "fork.json").read_text(encoding="utf-8"))
    upstream = json.loads(blob(worktree, state["target"], "theme.json"))
    previous = json.loads(blob(worktree, state["baseline"], "theme.json"))
    ours = json.loads(blob(worktree, state["source"], "theme.json"))
    # Begin with the latest package metadata, then apply fork identity fields.
    manifest = dict(upstream)
    for key in set(ours) | set(previous):
        if key not in {"version", "updatedAt"} and ours.get(key) != previous.get(key):
            if key in ours:
                manifest[key] = ours[key]
            else:
                manifest.pop(key, None)
    manifest["version"] = state["version"]
    manifest["updatedAt"] = ours.get("updatedAt") if state["rebuild"] else datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if manifest["updatedAt"] is None:
        manifest.pop("updatedAt")
    write(worktree / "theme.json", json.dumps(manifest, indent=2) + "\n")
    config["upstream"]["commit"] = state["target"]
    config["upstream"]["version"] = upstream["version"]
    write(worktree / "fork.json", json.dumps(config, indent=2) + "\n")
    readme = (worktree / "README.md").read_text(encoding="utf-8")
    readme = re.sub(r"(A fork of \[Zia\]\([^\n]+\) )\d+\.\d+\.\d+", r"\g<1>" + upstream["version"], readme, count=1)
    readme = re.sub(r"Current version: \*\*\d+\.\d+\.\d+\*\*", f"Current version: **{state['version']}**", readme, count=1)
    write(worktree / "README.md", readme)
    scope = (worktree / "VARIANT.md").read_text(encoding="utf-8")
    scope = re.sub(r"(- Base: Zia )\d+\.\d+\.\d+, commit `[^`]+`", r"\g<1>" + upstream["version"] + f", commit `{state['target'][:7]}`", scope, count=1)
    scope = re.sub(r"- Current variant: \d+\.\d+\.\d+\.", f"- Current variant: {state['version']}.", scope, count=1)
    write(worktree / "VARIANT.md", scope)
    if not state["rebuild"]:
        changelog = (worktree / "CHANGELOG.md").read_text(encoding="utf-8")
        index = re.search(r"^## \[", changelog, re.M)
        if index is None:
            raise RuntimeError("Changelog format changed; complete the candidate manually")
        compare = config['upstream']['url'].removesuffix('.git') + f"/compare/{state['baseline']}...{state['target']}"
        entry = (f"## [{state['version']}] — {datetime.date.today().isoformat()}\n\n### Updated\n\n"
                 f"- Build from upstream {upstream['version']} and reapply the fork's custom patches/modules.\n"
                 f"  [Upstream changes]({compare}).\n"
                 "- Preserve the sidebar appearance, player, native folders/dragging,\n"
                 "  previous fixes and off-by-default real-time tint.\n\n")
        write(worktree / "CHANGELOG.md", changelog[:index.start()] + entry + changelog[index.start():])
    state["metadataPrepared"] = True
    save_state(worktree, state)


def prepare(root=ROOT, target_ref=None, worktree=None, branch=None, zen=None,
            live=False, skip_tool_tests=False, report_path=None, resume=False,
            resolved=(), rebuild=False):
    root = Path(root).resolve()
    if resume:
        path = state_path(root)
        if not path.exists():
            raise RuntimeError("No pending upstream-first candidate state found in this worktree.")
        state = json.loads(path.read_text(encoding="utf-8"))
        worktree = root
        if git(root, "rev-parse", "HEAD").stdout.strip() != state["target"]:
            raise RuntimeError("Candidate HEAD changed; review it before resuming.")
        if set(resolved) - set(state["pending"]):
            raise RuntimeError("--resolved must name a pending patch or file collision.")
        for name in resolved:
            if git(root, "diff", "--quiet", "--", name, check=False).returncode:
                raise RuntimeError(f"Stage the manually resolved file first: {name}")
            del state["pending"][name]
        save_state(root, state)
    else:
        if git(root, "status", "--porcelain").stdout.strip():
            raise RuntimeError("Commit or stash local changes first. The updater requires a clean checkout.")
        config = json.loads((root / "fork.json").read_text(encoding="utf-8"))
        source = git(root, "rev-parse", "HEAD").stdout.strip()
        baseline = config["upstream"]["commit"]
        git(root, "merge-base", "--is-ancestor", baseline, source)
        validate_policy(root, config, source)
        if target_ref:
            if target_ref.startswith("-"):
                raise ValueError("Target ref cannot start with '-'")
            target = git(root, "rev-parse", "--verify", f"{target_ref}^{{commit}}").stdout.strip()
        else:
            remote = config["upstream"]
            git(root, "fetch", "--no-tags", remote["url"], f"refs/heads/{remote['branch']}")
            target = git(root, "rev-parse", "FETCH_HEAD").stdout.strip()
        if git(root, "merge-base", "--is-ancestor", baseline, target, check=False).returncode:
            raise RuntimeError("Upstream history no longer descends from the recorded base; review it manually.")
        if target == baseline and not rebuild:
            result = {"status": "up-to-date", "upstream": target, "strategy": "upstream-first"}
            report(result, report_path)
            return result
        if rebuild and target != baseline:
            raise RuntimeError("--rebuild verifies the recorded base only; use a normal update for a newer target.")
        upstream = json.loads(blob(root, target, "theme.json"))
        ours = json.loads(blob(root, source, "theme.json"))
        branch = branch or f"updates/{'rebuild' if rebuild else 'upstream'}-{target[:8]}"
        git(root, "check-ref-format", "--branch", branch)
        worktree = Path(worktree or Path(tempfile.mkdtemp(prefix="zia-update-")) / "checkout").resolve()
        if worktree.exists():
            raise RuntimeError(f"Worktree path already exists: {worktree}")
        # This checkout is literally the complete latest upstream tree.
        git(root, "worktree", "add", "-b", branch, str(worktree), target)
        state = {"source": source, "baseline": baseline, "target": target, "branch": branch,
                 "rebuild": rebuild, "version": ours["version"] if rebuild else next_version(ours["version"], upstream["version"]),
                 "metadataPrepared": False, "pending": {}}
        save_state(worktree, state)
        apply_customizations(root, worktree, state, config)
    result = {"status": "needs-review", "strategy": "upstream-first", "branch": state["branch"],
              "worktree": str(worktree), "sourceFork": state["source"], "startingCommit": state["target"],
              "upstream": state["target"], "version": state["version"], "liveChecked": False,
              "patches": state.get("patches", []),
              "upstreamChanges": git(worktree, "diff", "--name-only", state["baseline"], state["target"]).stdout.splitlines()}
    if state["pending"]:
        result["conflicts"] = sorted(state["pending"])
        result["patchFailures"] = state["pending"]
        result["instructions"] = "Adapt each failed patch on this upstream checkout, stage the resolution, then resume with --resolved FILE for each resolved path."
        report(result, report_path)
        return result
    try:
        if not state["metadataPrepared"]:
            prepare_metadata(worktree, state)
        subprocess.run([sys.executable, "scripts/build.py"], cwd=worktree, check=True)
        command = [sys.executable, "scripts/check.py"]
        if skip_tool_tests:
            command.append("--skip-tool-tests")
        if live or zen:
            command.append("--live")
            if zen:
                command.extend(["--zen", zen])
        subprocess.run(command, cwd=worktree, check=True)
        git(worktree, "add", "-A")
        git(worktree, "diff", "--cached", "--check")
        tree = git(worktree, "write-tree").stdout.strip()
        # Record both histories for fast-forward publication, but commit only
        # the tree constructed above. No content merge or old-source restoration.
        commit = git(worktree, "commit-tree", tree, "-p", state["source"], "-p", state["target"],
                     "-m", f"Reapply fork customizations to upstream as {state['version']}").stdout.strip()
        git(worktree, "update-ref", f"refs/heads/{state['branch']}", commit, state["target"])
    except (subprocess.CalledProcessError, RuntimeError) as error:
        result["checkFailure"] = str(error)
        result["instructions"] = "Fix the candidate, then run python scripts/update_upstream.py --resume WORKTREE --live."
        report(result, report_path)
        return result
    result["status"] = "prepared"
    result["liveChecked"] = bool(live or zen)
    result["commit"] = commit
    state_path(worktree).unlink()
    result["instructions"] = "Review this branch and run scripts/check.py --live before merging into main." if not result["liveChecked"] else "Review this branch before merging into main."
    report(result, report_path)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", help="Use an already-fetched ref instead of fetching upstream")
    parser.add_argument("--worktree", type=Path, help="New directory for the update checkout")
    parser.add_argument("--branch", help="New update branch name")
    parser.add_argument("--live", action="store_true", help="Run isolated Zen checks too")
    parser.add_argument("--zen", help="Zen executable; also enables live checks")
    parser.add_argument("--report", type=Path, help="Write a JSON report outside the worktree")
    parser.add_argument("--resume", type=Path, help="Resume a candidate after adapting failed patches or fixing checks")
    parser.add_argument("--resolved", action="append", default=[], metavar="FILE", help="Acknowledge a staged manual patch/collision resolution; repeat per file")
    parser.add_argument("--rebuild", action="store_true", help="Reconstruct the current version from its recorded upstream base")
    args = parser.parse_args()
    result = prepare(root=args.resume.resolve() if args.resume else ROOT, target_ref=args.target,
                     worktree=args.worktree, branch=args.branch, live=args.live,
                     zen=args.zen, report_path=args.report, resume=bool(args.resume),
                     resolved=args.resolved, rebuild=args.rebuild)
    return 2 if result["status"] == "needs-review" else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as error:
        print(f"Update stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
