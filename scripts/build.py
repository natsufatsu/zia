"""Build the installed files without shell dependencies (Python 3.10+)."""
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[1]


def build(root=ROOT, check=False):
    valid = True
    for kind, suffix, output in (("js", "js", "zia.uc.js"), ("css", "css", "chrome.css")):
        parts = sorted((root / "src" / kind).glob(f"*.{suffix}"))
        if not parts:
            raise RuntimeError(f"No {kind} source files found")
        content = b"".join(p.read_bytes() for p in parts)
        target = root / output
        if check:
            if not target.is_file() or target.read_bytes() != content:
                print(f"{output} differs from src/: run python scripts/build.py")
                valid = False
        else:
            target.write_bytes(content)
    return valid


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    raise SystemExit(0 if build(check=args.check) else 1)
