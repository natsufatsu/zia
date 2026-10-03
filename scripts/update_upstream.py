"""Prepare an upstream merge in a separate worktree; never publish to main."""
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


def prepare(root=ROOT, target_ref=None, worktree=None, branch=None, zen=None,
            live=False, skip_tool_tests=False, report_path=None, resume=False):
    if not resume and git(root, "status", "--porcelain").stdout.strip():
        raise RuntimeError("Commit or stash local changes first. The updater requires a clean checkout.")
    config = json.loads((root / "fork.json").read_text(encoding="utf-8"))
    baseline = config["upstream"]["commit"]
    if not resume:
        git(root, "merge-base", "--is-ancestor", baseline, "HEAD")
    if resume:
        target = git(root, "rev-parse", "--verify", "MERGE_HEAD").stdout.strip()
    elif target_ref:
        if target_ref.startswith("-"):
            raise ValueError("Target ref cannot start with '-'")
        target = git(root, "rev-parse", "--verify", f"{target_ref}^{{commit}}").stdout.strip()
    else:
        remote = config["upstream"]
        git(root, "fetch", "--no-tags", remote["url"], f"refs/heads/{remote['branch']}")
        target = git(root, "rev-parse", "FETCH_HEAD").stdout.strip()
    if git(root, "merge-base", "--is-ancestor", target, "HEAD", check=False).returncode == 0:
        result = {"status": "up-to-date", "upstream": target}
        report(result, report_path)
        return result
    if git(root, "merge-base", "--is-ancestor", baseline, target, check=False).returncode:
        raise RuntimeError("Upstream history no longer descends from the recorded base; review it manually.")
    upstream_manifest = json.loads(blob(root, target, "theme.json"))
    ours_manifest = json.loads((root / "theme.json").read_text(encoding="utf-8"))
    previous_manifest = json.loads(blob(root, baseline, "theme.json"))
    version = next_version(ours_manifest["version"], upstream_manifest["version"])
    branch = git(root, "branch", "--show-current").stdout.strip() if resume else branch or f"updates/upstream-{target[:8]}"
    git(root, "check-ref-format", "--branch", branch)
    if resume:
        worktree = root
    elif worktree is None:
        worktree = Path(tempfile.mkdtemp(prefix="zia-update-")) / "checkout"
    worktree = Path(worktree).resolve()
    if not resume and worktree.exists():
        raise RuntimeError(f"Worktree path already exists: {worktree}")
    if not resume:
        git(root, "worktree", "add", "-b", branch, str(worktree), "HEAD")
    comparison_base = git(root, "merge-base", "HEAD", target).stdout.strip() if resume and baseline == target else baseline
    result = {"status": "needs-review", "branch": branch, "worktree": str(worktree),
              "upstream": target, "version": version, "liveChecked": False,
              "upstreamChanges": git(root, "diff", "--name-only", comparison_base, target).stdout.splitlines()}
    if not resume:
        merge = git(worktree, "merge", "--no-commit", "--no-ff", target, check=False)
        if merge.returncode and git(worktree, "rev-parse", "--verify", "MERGE_HEAD", check=False).returncode:
            result["checkFailure"] = merge.stderr.strip() or merge.stdout.strip()
            report(result, report_path)
            return result
    # Entire replacements and fork documentation intentionally remain ours.
    # Shared source files and preferences always require normal three-way merging.
    owned = set(config["ownedFiles"])
    before_files = set(git(root, "ls-tree", "-r", "--name-only", "HEAD").stdout.splitlines())
    for name in owned if not resume else []:
        if name in before_files:
            git(worktree, "restore", "--source=HEAD", "--staged", "--worktree", "--", name)
    for name in config["excludedFiles"]:
        if (worktree / name).exists():
            git(worktree, "rm", "-f", "--", name)
    conflicts = set(git(worktree, "diff", "--name-only", "--diff-filter=U").stdout.splitlines())
    for name in conflicts & GENERATED:
        git(worktree, "restore", "--source=HEAD", "--staged", "--worktree", "--", name)
    unresolved = sorted(conflicts - GENERATED - owned - set(config["excludedFiles"]))
    if unresolved:
        result["conflicts"] = unresolved
        result["instructions"] = "Resolve and stage source conflicts, then run python scripts/update_upstream.py --resume WORKTREE --live."
        report(result, report_path)
        return result
    # After a check failure, the merge is still pending but metadata is already
    # prepared. Resume checks without adding another version/changelog entry.
    metadata_prepared = resume and baseline == target
    if metadata_prepared:
        version = ours_manifest["version"]
        result["version"] = version
    # Preserve fork package identity; incorporate untouched upstream metadata.
    for key, value in upstream_manifest.items():
        if key not in {"version", "updatedAt"} and ours_manifest.get(key) == previous_manifest.get(key):
            ours_manifest[key] = value
    ours_manifest["version"] = version
    ours_manifest["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write(worktree / "theme.json", json.dumps(ours_manifest, indent=2) + "\n")
    config["upstream"]["commit"] = target
    config["upstream"]["version"] = upstream_manifest["version"]
    write(worktree / "fork.json", json.dumps(config, indent=2) + "\n")
    readme = (worktree / "README.md").read_text(encoding="utf-8")
    readme = re.sub(r"(A fork of \[Zia\]\([^\n]+\) )\d+\.\d+\.\d+", r"\g<1>" + upstream_manifest["version"], readme, count=1)
    readme = re.sub(r"Current version: \*\*\d+\.\d+\.\d+\*\*", f"Current version: **{version}**", readme, count=1)
    write(worktree / "README.md", readme)
    scope = (worktree / "VARIANT.md").read_text(encoding="utf-8")
    scope = re.sub(r"(- Base: Zia )\d+\.\d+\.\d+, commit `[^`]+`", r"\g<1>" + upstream_manifest["version"] + f", commit `{target[:7]}`", scope, count=1)
    scope = re.sub(r"- Current variant: \d+\.\d+\.\d+\.", f"- Current variant: {version}.", scope, count=1)
    write(worktree / "VARIANT.md", scope)
    changelog = (worktree / "CHANGELOG.md").read_text(encoding="utf-8")
    index = re.search(r"^## \[", changelog, re.M)
    if index is None:
        raise RuntimeError("Changelog format changed; complete the candidate manually")
    compare = config['upstream']['url'].removesuffix('.git') + f"/compare/{baseline}...{target}"
    entry = (f"## [{version}] — {datetime.date.today().isoformat()}\n\n### Updated\n\n"
             f"- Import compatible upstream changes through {upstream_manifest['version']}.\n"
             f"  [Upstream changes]({compare}).\n"
             "- Retain the fork's sidebar appearance, player, native folders/dragging,\n"
             "  previous fixes and off-by-default real-time tint.\n\n")
    if not metadata_prepared:
        write(worktree / "CHANGELOG.md", changelog[:index.start()] + entry + changelog[index.start():])
    try:
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
        git(worktree, "commit", "-m", f"Import upstream {upstream_manifest['version']} as fork {version}")
    except (subprocess.CalledProcessError, RuntimeError) as error:
        result["checkFailure"] = str(error)
        result["instructions"] = "Fix the candidate, then run python scripts/update_upstream.py --resume WORKTREE --live."
        report(result, report_path)
        return result
    result["status"] = "prepared"
    result["liveChecked"] = bool(live or zen)
    result["commit"] = git(worktree, "rev-parse", "HEAD").stdout.strip()
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
    parser.add_argument("--resume", type=Path, help="Resume an existing candidate after resolving/staging conflicts or fixing checks")
    args = parser.parse_args()
    result = prepare(root=args.resume.resolve() if args.resume else ROOT, target_ref=args.target,
                     worktree=args.worktree, branch=args.branch, live=args.live,
                     zen=args.zen, report_path=args.report, resume=bool(args.resume))
    return 2 if result["status"] == "needs-review" else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as error:
        print(f"Update stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
