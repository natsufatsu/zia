"""Prove upstream-first construction in disposable real Git repositories."""
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
        self.put("theme.json", json.dumps({"id": "zia", "version": "1.0.0", "author": "upstream"}, indent=2) + "\n")
        self.put("README.md", "Upstream readme\n")
        self.put("CHANGELOG.md", "# Changelog\n\n## [1.0.0]\n\nUpstream changes.\n")
        self.put("shared.js", self.shared())
        self.put("player.js", "upstream player\n")
        self.put("chrome.css", "upstream generated css\n")
        self.put("zia.uc.js", "upstream generated js\n")
        self.put("upstream.txt", "original\n")
        self.put("removed-folder.js", "folder code\n")
        self.put("obsolete-upstream.txt", "obsolete\n")
        self.commit("upstream baseline")
        self.base = self.git("rev-parse", "HEAD")
        self.git("branch", "upstream-fixture")
        self.put("theme.json", json.dumps({"id": "zia", "version": "1.0.1", "author": "fork"}, indent=2) + "\n")
        self.put("README.md", "A fork of [Zia](https://example.invalid/zia) 1.0.0 with custom styling.\nCurrent version: **1.0.1**.\n")
        self.put("VARIANT.md", f"- Base: Zia 1.0.0, commit `{self.base[:7]}`.\n- Current variant: 1.0.1.\n")
        self.put("CHANGELOG.md", "# Changelog\n\n## [1.0.1]\n\nCustom changes.\n")
        self.put("player.js", "custom player\n")
        self.put("shared.js", self.shared(a=2))
        self.put("chrome.css", "rebuilt css\n")
        self.put("zia.uc.js", "rebuilt js\n")
        (self.root / "removed-folder.js").unlink()
        self.put("custom-module.js", "fork-only module\n")
        self.put("scripts/build.py", "from pathlib import Path\nPath('chrome.css').write_text('rebuilt css\\n')\nPath('zia.uc.js').write_text('rebuilt js\\n')\n")
        self.put("scripts/check.py", "from pathlib import Path\nimport sys\nassert Path('player.js').read_text() == 'custom player\\n'\nassert 'const a = 2;' in Path('shared.js').read_text()\nsys.exit(1 if Path('fail-check').exists() else 0)\n")
        self.config = {"schema": 2, "upstream": {"commit": self.base, "version": "1.0.0", "url": "https://example.invalid/zia.git"},
                       "modifiedFiles": ["theme.json", "README.md", "CHANGELOG.md", "player.js", "shared.js", "chrome.css", "zia.uc.js"],
                       "forkFiles": ["fork.json", "VARIANT.md", "custom-module.js", "scripts/build.py", "scripts/check.py"],
                       "documentationOverlays": ["README.md", "CHANGELOG.md"], "excludedFiles": ["removed-folder.js"]}
        self.put("fork.json", json.dumps(self.config, indent=2) + "\n")
        self.commit("fork customizations")
        self.original = self.git("rev-parse", "HEAD")

    def shared(self, a=1, b=1):
        return f"const a = {a};\n" + "\n".join(f"// Stable context {n}" for n in range(20)) + f"\nconst b = {b};\n"

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

    def upstream(self, conflict=False, fail=False, player=False, collision=False, folder=False, b=3):
        self.git("switch", "upstream-fixture")
        self.put("theme.json", json.dumps({"id": "zia", "version": "1.1.0", "author": "upstream", "newKey": "keep me"}))
        self.put("chrome.css", "new upstream generated css\n")
        self.put("zia.uc.js", "new upstream generated js\n")
        self.put("upstream.txt", "updated\n")
        self.put("new-upstream.js", "new feature\n")
        (self.root / "obsolete-upstream.txt").unlink(missing_ok=True)
        self.put("shared.js", self.shared(a=3 if conflict else 1, b=b))
        for flag, name, value in ((player, "player.js", "new upstream player\n"),
                                  (collision, "custom-module.js", "upstream collision\n"),
                                  (folder, "removed-folder.js", "changed upstream folder\n"),
                                  (fail, "fail-check", "fail\n")):
            if flag:
                self.put(name, value)
        self.commit("new upstream release")
        target = self.git("rev-parse", "HEAD")
        self.git("switch", "main")
        return target

    def prepare(self, target, **kwargs):
        return updater.prepare(root=self.root, target_ref=target,
            worktree=self.container / "candidate", branch="updates/test", **kwargs)

    def unchanged_original(self):
        self.assertEqual(self.git("rev-parse", "HEAD"), self.original)
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_no_update_does_not_create_worktree(self):
        self.assertEqual(self.prepare(self.base)["status"], "up-to-date")
        self.assertFalse((self.container / "candidate").exists())
        self.unchanged_original()

    def test_rebuild_reconstructs_identical_tree_from_upstream_base(self):
        result = self.prepare(self.base, rebuild=True)
        self.assertEqual(result["status"], "prepared")
        candidate = Path(result["worktree"])
        self.assertEqual(result["startingCommit"], self.base)
        self.assertEqual(self.git("rev-parse", "HEAD^{tree}", root=candidate), self.git("rev-parse", "HEAD^{tree}"))
        self.unchanged_original()

    def test_upstream_tree_receives_patches_keeps_new_changes_and_deletions(self):
        target = self.upstream()
        result = self.prepare(target)
        self.assertEqual(result["status"], "prepared")
        self.assertEqual((result["strategy"], result["startingCommit"]), ("upstream-first", target))
        candidate = Path(result["worktree"])
        for name, value in (("shared.js", self.shared(a=2, b=3)), ("player.js", "custom player\n"),
                            ("custom-module.js", "fork-only module\n"), ("new-upstream.js", "new feature\n"),
                            ("upstream.txt", "updated\n"), ("zia.uc.js", "rebuilt js\n")):
            self.assertEqual((candidate / name).read_text(), value)
        self.assertFalse((candidate / "removed-folder.js").exists())
        self.assertFalse((candidate / "obsolete-upstream.txt").exists())
        manifest = json.loads((candidate / "theme.json").read_text())
        self.assertEqual((manifest["version"], manifest["author"], manifest["newKey"]), ("1.1.1", "fork", "keep me"))
        self.assertEqual(self.git("show", "-s", "--format=%P", "HEAD", root=candidate).split(), [self.original, target])
        self.assertEqual(self.git("status", "--porcelain", root=candidate), "")
        self.unchanged_original()

    def test_conflict_leaves_upstream_file_requires_explicit_staged_resolution(self):
        target = self.upstream(conflict=True)
        result = self.prepare(target)
        self.assertEqual(result["conflicts"], ["shared.js"])
        candidate = Path(result["worktree"])
        self.assertEqual(self.git("rev-parse", "HEAD", root=candidate), target)
        self.assertEqual((candidate / "shared.js").read_text(), self.shared(a=3, b=3))
        self.assertEqual(updater.prepare(root=candidate, resume=True)["status"], "needs-review")
        (candidate / "shared.js").write_text(self.shared(a=2, b=3), encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(RuntimeError, "Stage"):
            updater.prepare(root=candidate, resume=True, resolved=["shared.js"])
        self.git("add", "shared.js", root=candidate)
        resumed = updater.prepare(root=candidate, resume=True, resolved=["shared.js"])
        self.assertEqual((resumed["status"], resumed["version"]), ("prepared", "1.1.1"))
        self.unchanged_original()

    def test_replacement_collision_and_changed_exclusion_are_not_overwritten(self):
        target = self.upstream(player=True, collision=True, folder=True)
        result = self.prepare(target)
        self.assertEqual(result["conflicts"], ["custom-module.js", "player.js", "removed-folder.js"])
        candidate = Path(result["worktree"])
        self.assertEqual((candidate / "player.js").read_text(), "new upstream player\n")
        self.assertEqual((candidate / "custom-module.js").read_text(), "upstream collision\n")
        self.assertEqual((candidate / "removed-folder.js").read_text(), "changed upstream folder\n")
        self.unchanged_original()

    def test_failed_checks_resume_without_double_bump(self):
        target = self.upstream(fail=True)
        result = self.prepare(target)
        self.assertEqual(result["status"], "needs-review")
        self.assertIn("checkFailure", result)
        candidate = Path(result["worktree"])
        self.assertEqual(self.git("rev-parse", "HEAD", root=candidate), target)
        (candidate / "fail-check").unlink()
        resumed = updater.prepare(root=candidate, resume=True)
        self.assertEqual((resumed["status"], resumed["version"]), ("prepared", "1.1.1"))
        self.assertEqual((candidate / "CHANGELOG.md").read_text().count("## [1.1.1]"), 1)
        self.unchanged_original()

    def test_second_update_reapplies_custom_delta_against_new_base(self):
        first = self.prepare(self.upstream())
        target = self.upstream(b=4)
        result = updater.prepare(root=Path(first["worktree"]), target_ref=target,
            worktree=self.container / "second", branch="updates/second")
        self.assertEqual(result["status"], "prepared")
        self.assertEqual((Path(result["worktree"]) / "shared.js").read_text(), self.shared(a=2, b=4))

    def test_dirty_checkout_is_rejected(self):
        self.put("local-work.txt", "do not touch\n")
        with self.assertRaisesRegex(RuntimeError, "clean checkout"):
            self.prepare(self.base)
        self.assertEqual((self.root / "local-work.txt").read_text(), "do not touch\n")

    def test_existing_destination_is_rejected(self):
        target = self.upstream()
        candidate = self.container / "candidate"
        candidate.mkdir()
        (candidate / "keep.txt").write_text("keep")
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            self.prepare(target)
        self.assertEqual((candidate / "keep.txt").read_text(), "keep")
        self.unchanged_original()

    def test_source_cannot_be_documentation_overlay(self):
        self.config["documentationOverlays"].append("player.js")
        self.put("fork.json", json.dumps(self.config))
        self.commit("invalid policy")
        with self.assertRaisesRegex(RuntimeError, "Only fork README/changelog"):
            self.prepare(self.base)

    def test_versions_advance_over_both_fork_and_upstream(self):
        self.assertEqual(updater.next_version("2.86.3", "2.86.2"), "2.86.4")
        self.assertEqual(updater.next_version("2.86.3", "2.90.0"), "2.90.1")
        with self.assertRaises(ValueError):
            updater.next_version("dev", "2.90.0")

    def test_shared_file_cannot_bypass_patching_as_fork_addition(self):
        self.config["modifiedFiles"].remove("player.js")
        self.config["forkFiles"].append("player.js")
        self.put("fork.json", json.dumps(self.config))
        self.commit("invalid shared-file copy policy")
        with self.assertRaisesRegex(RuntimeError, "Shared files must use patches"):
            self.prepare(self.base)


if __name__ == "__main__":
    unittest.main()
