"""Exercise real Git merges in disposable repositories, without networking."""
from pathlib import Path
import importlib.util
import json
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("updater", SOURCE / "scripts/update_upstream.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="zia-update-test-")
        self.addCleanup(self.temp.cleanup)
        self.container = Path(self.temp.name)
        self.root = self.container / "repo"
        self.root.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Update test")
        self.git("config", "user.email", "update-test@example.invalid")
        self.put("theme.json", json.dumps({"id": "zia", "version": "1.0.0", "author": "upstream"}))
        self.put("README.md", "A fork of [Zia](https://example.invalid/zia) 1.0.0 with custom styling.\nCurrent version: **1.0.1**.\n")
        self.put("VARIANT.md", "- Base: Zia 1.0.0, commit `base`.\n- Current variant: 1.0.1.\n")
        self.put("CHANGELOG.md", "# Changelog\n\n## [1.0.1]\n\nCustom changes.\n")
        self.put("shared.js", "const a = 1;\nconst b = 1;\n")
        self.put("player.js", "upstream player\n")
        self.put("chrome.css", "upstream generated css\n")
        self.put("zia.uc.js", "upstream generated js\n")
        self.put("upstream.txt", "original\n")
        self.commit("upstream baseline")
        self.base = self.git("rev-parse", "HEAD")
        self.git("branch", "upstream-fixture")
        self.put("theme.json", json.dumps({"id": "zia", "version": "1.0.1", "author": "fork"}))
        self.put("player.js", "custom player\n")
        self.put("shared.js", "const a = 2;\nconst b = 1;\n")
        self.put("chrome.css", "fork generated css\n")
        self.put("zia.uc.js", "fork generated js\n")
        self.put("scripts/build.py", "from pathlib import Path\nPath('chrome.css').write_text('rebuilt css\\n')\nPath('zia.uc.js').write_text('rebuilt js\\n')\n")
        self.put("scripts/check.py", "from pathlib import Path\nimport sys\nassert Path('player.js').read_text() == 'custom player\\n'\nsys.exit(1 if Path('fail-check').exists() else 0)\n")
        self.put("fork.json", json.dumps({"upstream": {"commit": self.base, "version": "1.0.0", "url": "https://example.invalid/zia.git"},
            "ownedFiles": ["theme.json", "README.md", "VARIANT.md", "CHANGELOG.md", "player.js"],
            "excludedFiles": ["removed-folder.js"]}))
        self.commit("fork customizations")
        self.original = self.git("rev-parse", "HEAD")

    def git(self, *args, root=None):
        result = subprocess.run(["git", *args], cwd=root or self.root, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def put(self, name, value):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value, encoding="utf-8", newline="\n")

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-m", message)

    def upstream(self, conflict=False, fail=False):
        self.git("switch", "upstream-fixture")
        self.put("theme.json", json.dumps({"id": "zia", "version": "1.1.0", "author": "upstream"}))
        self.put("chrome.css", "new upstream generated css\n")
        self.put("zia.uc.js", "new upstream generated js\n")
        self.put("player.js", "new upstream player\n")
        self.put("removed-folder.js", "folder code\n")
        self.put("upstream.txt", "updated\n")
        if conflict:
            self.put("shared.js", "const a = 3;\nconst b = 1;\n")
        if fail:
            self.put("fail-check", "fail\n")
        self.commit("new upstream release")
        target = self.git("rev-parse", "HEAD")
        self.git("switch", "main")
        return target

    def prepare(self, target):
        return updater.prepare(root=self.root, target_ref=target,
            worktree=self.container / "candidate", branch="updates/test")

    def unchanged_original(self):
        self.assertEqual(self.git("rev-parse", "HEAD"), self.original)
        self.assertEqual(self.git("branch", "--show-current"), "main")
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_no_update_does_not_create_branch_or_worktree(self):
        result = self.prepare(self.base)
        self.assertEqual(result["status"], "up-to-date")
        self.assertFalse((self.container / "candidate").exists())
        self.unchanged_original()

    def test_merge_preserves_replacements_and_rebuilds_generated_files(self):
        target = self.upstream()
        result = self.prepare(target)
        self.assertEqual(result["status"], "prepared")
        candidate = Path(result["worktree"])
        self.assertEqual((candidate / "player.js").read_text(), "custom player\n")
        self.assertEqual((candidate / "chrome.css").read_text(), "rebuilt css\n")
        self.assertEqual((candidate / "zia.uc.js").read_text(), "rebuilt js\n")
        self.assertFalse((candidate / "removed-folder.js").exists())
        manifest = json.loads((candidate / "theme.json").read_text())
        self.assertEqual((manifest["version"], manifest["author"]), ("1.1.1", "fork"))
        self.assertEqual(json.loads((candidate / "fork.json").read_text())["upstream"]["commit"], target)
        self.git("merge-base", "--is-ancestor", target, "HEAD", root=candidate)
        self.assertFalse(result["liveChecked"])
        self.unchanged_original()

    def test_source_conflict_stops_and_can_resume_after_resolution(self):
        target = self.upstream(conflict=True)
        result = self.prepare(target)
        self.assertEqual(result["status"], "needs-review")
        self.assertEqual(result["conflicts"], ["shared.js"])
        candidate = Path(result["worktree"])
        self.assertEqual(json.loads((candidate / "fork.json").read_text())["upstream"]["commit"], self.base)
        (candidate / "shared.js").write_text("const a = 2;\nconst b = 3;\n", encoding="utf-8", newline="\n")
        self.git("add", "shared.js", root=candidate)
        resumed = updater.prepare(root=candidate, resume=True)
        self.assertEqual(resumed["status"], "prepared")
        self.assertEqual(resumed["version"], "1.1.1")
        self.unchanged_original()

    def test_failed_checks_leave_pending_candidate_and_resume_without_double_bump(self):
        target = self.upstream(fail=True)
        result = self.prepare(target)
        self.assertEqual(result["status"], "needs-review")
        self.assertIn("checkFailure", result)
        candidate = Path(result["worktree"])
        self.assertEqual(self.git("rev-parse", "HEAD", root=candidate), self.original)
        (candidate / "fail-check").unlink()
        resumed = updater.prepare(root=candidate, resume=True)
        self.assertEqual(resumed["status"], "prepared")
        self.assertEqual(resumed["version"], "1.1.1")
        self.assertEqual((candidate / "CHANGELOG.md").read_text().count("## [1.1.1]"), 1)
        self.assertIn("upstream.txt", resumed["upstreamChanges"])
        self.unchanged_original()

    def test_dirty_checkout_is_rejected(self):
        self.put("local-work.txt", "do not touch\n")
        with self.assertRaisesRegex(RuntimeError, "clean checkout"):
            self.prepare(self.base)
        self.assertEqual((self.root / "local-work.txt").read_text(), "do not touch\n")
        self.assertFalse((self.container / "candidate").exists())

    def test_existing_destination_is_rejected_without_modifying_it(self):
        target = self.upstream()
        candidate = self.container / "candidate"
        candidate.mkdir()
        (candidate / "keep.txt").write_text("keep")
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            self.prepare(target)
        self.assertEqual((candidate / "keep.txt").read_text(), "keep")
        self.unchanged_original()

    def test_versions_advance_over_both_fork_and_upstream(self):
        self.assertEqual(updater.next_version("2.86.3", "2.86.2"), "2.86.4")
        self.assertEqual(updater.next_version("2.86.3", "2.90.0"), "2.90.1")
        with self.assertRaises(ValueError):
            updater.next_version("dev", "2.90.0")


if __name__ == "__main__":
    unittest.main()
