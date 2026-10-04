"""Run portable preservation checks, optionally with isolated Zen profiles."""
from pathlib import Path
import argparse
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(command):
    print("Running:", " ".join(map(str, command)), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Also run isolated Zen checks")
    parser.add_argument("--zen", help="Zen executable (or set ZEN_BINARY)")
    parser.add_argument("--quick-save", help="Optional Quick Save Image checkout")
    parser.add_argument("--skip-tool-tests", action="store_true", help="For updater test fixtures only")
    args = parser.parse_args()
    node = shutil.which("node")
    if not node:
        parser.error("Node.js is required for syntax and behavior checks")
    run([sys.executable, "scripts/build.py", "--check"])
    run([sys.executable, "scripts/check_fork.py"])
    run([node, "--check", "zia.uc.js"])
    for test in sorted((ROOT / "tests").glob("*.cjs")):
        run([node, str(test)])
    if not args.skip_tool_tests:
        run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"])
    if args.live:
        extra = (["--zen", args.zen] if args.zen else []) + (["--quick-save", args.quick_save] if args.quick_save else [])
        run([sys.executable, "scripts/check_live.py", "--workspace-icon-check",
             "--realtime-tint-check", "--tab-glow-check", "--alignment-check", *extra])
        run([sys.executable, "scripts/check_live.py", "--inspect", "--compact-startup",
             "--workspace-icon-check", *extra])
    else:
        print("Static checks passed. Before publishing, run python scripts/check.py --live --zen PATH.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode)
