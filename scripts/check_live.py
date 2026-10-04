"""Run this fork in an isolated headless Zen profile, via Marionette.

Uses only the standard library; never opens or modifies the normal Zen profile.
No sibling repositories are required. --quick-save optionally tests that peer.
"""
from pathlib import Path
import argparse
import base64
import http.server
import io
import json
import math
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import threading
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / ".build" / "live"


class Marionette:
    def __init__(self, connection):
        self.connection = connection
        self.number = 0
        self.receive()

    def receive(self):
        prefix = b""
        while not prefix.endswith(b":"):
            data = self.connection.recv(1)
            if not data:
                raise RuntimeError("Marionette disconnected")
            prefix += data
        size = int(prefix[:-1])
        body = b""
        while len(body) < size:
            data = self.connection.recv(size - len(body))
            if not data:
                raise RuntimeError("Marionette disconnected")
            body += data
        return json.loads(body)

    def command(self, name, parameters=None):
        self.number += 1
        body = json.dumps([0, self.number, name, parameters or {}]).encode()
        self.connection.sendall(str(len(body)).encode() + b":" + body)
        result = self.receive()
        if result[2]:
            raise RuntimeError(json.dumps(result[2]))
        return result[3]

    def script(self, script, args=None, asynchronous=False):
        response = self.command("WebDriver:ExecuteAsyncScript" if asynchronous else "WebDriver:ExecuteScript", {
            "script": script, "args": args or [], "newSandbox": True,
            "sandbox": "system", "scriptTimeout": 20000,
        })
        return response.get("value", response) if isinstance(response, dict) else response


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zen", default=os.environ.get("ZEN_BINARY") or shutil.which("zen-browser") or shutil.which("zen") or "C:/Program Files/Zen Browser/zen.exe")
    parser.add_argument("--quick-save", type=Path, help="Optional Quick Save Image checkout")
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--peer-first", dest="urlbar_last", action="store_true", help="Load optional Quick Save before Zia")
    parser.add_argument("--compact-startup", action="store_true", help="Start with the sidebar hidden in compact mode")
    parser.add_argument("--tab-glow-check", action="store_true", help="Check selected first-row, audio and split-tab glows")
    parser.add_argument("--realtime-tint-check", action="store_true", help="Check live tint sampling and smoothing")
    parser.add_argument("--workspace-icon-check", action="store_true", help="Check workspace icon swaps without blank frames")
    args = parser.parse_args()
    args.full_zia = True
    if not Path(args.zen).is_file() and not shutil.which(args.zen):
        parser.error("Zen executable not found; pass --zen PATH or set ZEN_BINARY")
    BUILD.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix="live-", dir=BUILD))
    profile = run_dir / "profile"
    profile.mkdir()
    downloads = run_dir / "downloads"
    downloads.mkdir()
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    prefs = {
        "marionette.port": port, "marionette.enabled": True,
        "zen.welcome-screen.seen": True, "zen.view.use-single-toolbar": False,
        "browser.shell.checkDefaultBrowser": False,
        "browser.startup.page": 0, "browser.startup.homepage": "about:blank",
        "startup.homepage_welcome_url": "", "startup.homepage_welcome_url.additional": "",
        "browser.aboutwelcome.enabled": False, "browser.sessionstore.resume_from_crash": False,
        "browser.download.folderList": 2, "browser.download.dir": str(downloads),
        "browser.download.useDownloadDir": False,
        "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0,
        "app.update.auto": False, "browser.tabs.warnOnClose": False,
    }
    if args.full_zia:
        welcome_source = (ROOT / "src/js/28f-welcome.js").read_text(encoding="utf-8")
        prefs["zia.welcome.seen"] = welcome_source.split('const WELCOME_VERSION = "', 1)[1].split('"', 1)[0]
    if args.compact_startup:
        prefs.update({"zen.view.compact.enable-at-startup": True,
                      "zen.view.compact.hide-tabbar": True,
                      "zen.view.compact.hide-toolbar": False})
    (profile / "user.js").write_text("\n".join(
        f"user_pref({json.dumps(key)}, {json.dumps(value)});" for key, value in prefs.items()), encoding="utf-8")
    # Register only these test assets under the same chrome URI layout Sine uses.
    assets = profile / "chrome" / "sine"
    assets.mkdir(parents=True)
    manifest = assets / "chrome.manifest"
    manifest.write_text("content sine ./\n", encoding="utf-8")
    packages = [("zia", ROOT, "zia.uc.js")]
    if args.quick_save:
        if not (args.quick_save / "quick-save-image.uc.js").is_file():
            parser.error("--quick-save must point to a Quick Save Image checkout")
        packages.append(("zen-quick-save-image", args.quick_save, "quick-save-image.uc.js"))
    for mod_id, folder, script in packages:
        shutil.copytree(folder, assets / mod_id, ignore=shutil.ignore_patterns(
            ".git", ".build", "__pycache__", "node_modules", "scripts", "tests", ".github"))

    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==")
    audio = io.BytesIO()
    with wave.open(audio, "wb") as wav:
        wav.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        wav.writeframes(b"".join(struct.pack("<h", int(500 * math.sin(i * math.tau * 440 / 8000))) for i in range(8000 * 8)))

    class Page(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            route = self.path.split("?", 1)[0]
            if route == "/test.png":
                body, content_type = png, "image/png"
            elif route == "/test.wav":
                body, content_type = audio.getvalue(), "audio/wav"
            else:
                color = "#eeeeee" if route.startswith("/light") else "#111111"
                body = (f'<!doctype html><title>{route} compatibility page</title>'
                        f'<style>html,body{{margin:0;background:{color};min-height:300vh;}}</style>'
                        '<img src="/test.png" id="image" width="100" height="100">'
                        '<audio id="audio" src="/test.wav" controls loop></audio>').encode()
                content_type = "text/html"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    with (run_dir / "zen.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen([
            args.zen, "--headless", "--no-remote", "--profile", str(profile),
            "--marionette", "--remote-allow-system-access", "about:blank",
        ], stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        client = None
        try:
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                try:
                    connection = socket.create_connection(("127.0.0.1", port), timeout=1)
                    connection.settimeout(25)
                    client = Marionette(connection)
                    break
                except (OSError, TimeoutError):
                    if process.poll() is not None:
                        raise RuntimeError("Zen exited: " + (run_dir / "zen.log").read_text())
                    time.sleep(0.2)
            if client is None:
                raise RuntimeError("Zen did not start Marionette; see " + str(run_dir / "zen.log"))
            client.command("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {}, "firstMatch": [{}]}})
            client.command("Marionette:SetContext", {"value": "chrome"})
            bootstrap = """
              const win = Services.wm.getMostRecentWindow('navigator:browser');
              const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
              file.initWithPath(arguments[0]);
              Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(file);
              win.__compatErrors = [];
              win.__compatErrorListener = {observe(message) {
                if (/zia|quick.save/i.test(message.message || message.errorMessage || ''))
                  win.__compatErrors.push(message.message || message.errorMessage);
              }};
              Services.console.registerListener(win.__compatErrorListener);
              return {ready: win.gBrowserInit.delayedStartupFinished,
                version: Services.appinfo.version};
            """
            print("Zen:", json.dumps(client.script(bootstrap, [str(manifest)])), flush=True)
            if args.full_zia:
                defaults = json.loads((ROOT / "preferences.json").read_text(encoding="utf-8"))
                client.script("""
                  const defaults = Services.prefs.getDefaultBranch('');
                  for (const item of arguments[0]) {
                    if (!item.property || !('defaultValue' in item)) continue;
                    const value = item.defaultValue;
                    if (typeof value === 'boolean') defaults.setBoolPref(item.property, value);
                    else if (typeof value === 'number') defaults.setIntPref(item.property, value);
                    else if (typeof value === 'string') defaults.setStringPref(item.property, value);
                  }
                """, [defaults])
            load_order = packages[1:] + packages[:1] if args.urlbar_last else packages
            for mod_id, folder, script in load_order:
                outcome = client.script("""
                  const win = Services.wm.getMostRecentWindow('navigator:browser');
                  win.windowUtils.loadSheetUsingURIString(arguments[0] + '/chrome.css', win.windowUtils.USER_SHEET);
                  Services.scriptloader.loadSubScript(arguments[0] + '/' + arguments[1], win, 'UTF-8');
                  return win.__compatErrors;
                """, [f"chrome://sine/content/{mod_id}", script])
                print("Loaded", mod_id, outcome, flush=True)
            client.command("Marionette:SetContext", {"value": "content"})
            client.command("WebDriver:Navigate", {"url": origin + "/light"})
            client.command("Marionette:SetContext", {"value": "chrome"})
            time.sleep(1)
            inspection = client.script("""
              const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document;
              return {errors: win.__compatErrors,
                loaded: arguments[0] ? [win.__ziaLoaded, !arguments[1] || !!win.zenQuickSaveImage] :
                  [win.__zia_urlbarLoaded, !!win.zenQuickSaveImage, win.__zia_media_playerLoaded, win.__zia_split_tabsLoaded],
                siteColor: doc.documentElement.style.getPropertyValue('--zia-site-bg'),
                quickSave: !!doc.getElementById('zen-quick-save-image-command'),
                toolbar: !!doc.getElementById('zen-media-controls-toolbar'),
                split: typeof win.gZenViewSplitter.splitTabs,
                sidebarRect: doc.getElementById('navigator-toolbox').getBoundingClientRect().toJSON()};
            """, [args.full_zia, bool(args.quick_save)])
            print("Together:", json.dumps(inspection), flush=True)
            if inspection["errors"]:
                raise AssertionError(inspection["errors"])
            assert all(inspection["loaded"])
            if args.realtime_tint_check:
                tint_checks = client.script((ROOT / "tests/realtime-tint-live.js").read_text(encoding="utf-8"), asynchronous=True)
                (run_dir / "realtime-tint-results.json").write_text(json.dumps(tint_checks, indent=2), encoding="utf-8")
                print("Realtime tint checks:", json.dumps({**{key: value for key, value in tint_checks.items() if key != "samples"},
                                                          "samples": len(tint_checks.get("samples", []))}), flush=True)
                assert not tint_checks.get("error"), tint_checks
            if args.workspace_icon_check:
                icon_checks = client.script((ROOT / "tests/workspace-icon-live.js").read_text(encoding="utf-8"), asynchronous=True)
                (run_dir / "workspace-icon-results.json").write_text(json.dumps(icon_checks, indent=2), encoding="utf-8")
                print("Workspace icon checks:", json.dumps({**{key: value for key, value in icon_checks.items() if key != "frames"},
                                                           "frames": len(icon_checks.get("frames", []))}), flush=True)
                assert not icon_checks.get("error"), icon_checks
            if args.tab_glow_check:
                glow_checks = client.script((ROOT / "tests/tab-glow-live.js").read_text(encoding="utf-8"), asynchronous=True)
                (run_dir / "tab-glow-results.json").write_text(json.dumps(glow_checks, indent=2), encoding="utf-8")
                print("Tab glow checks:", json.dumps(glow_checks), flush=True)
                assert not glow_checks.get("error"), glow_checks
            if not args.inspect:
                client.command("Marionette:SetContext", {"value": "content"})
                print("Audio:", client.script("""
                  const done = arguments[arguments.length - 1];
                  navigator.mediaSession.metadata = new MediaMetadata({title: 'Compatibility audio', artist: 'Local test'});
                  document.getElementById('audio').play().then(() => done('playing'), error => done(String(error)));
                """, asynchronous=True), flush=True)
                image = client.command("WebDriver:FindElement", {"using": "css selector", "value": "#image"})
                if "value" in image:
                    image = image["value"]
                client.command("WebDriver:PerformActions", {"actions": [{
                    "type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"},
                    "actions": [{"type": "pointerMove", "origin": image, "x": 0, "y": 0},
                                {"type": "pointerDown", "button": 2}, {"type": "pointerUp", "button": 2}],
                }]})
                client.command("Marionette:SetContext", {"value": "chrome"})
                checks_file = "retained_features_live_checks.js"
                checks = client.script((ROOT / "tests/live" / checks_file).read_text(encoding="utf-8"),
                                       [origin], asynchronous=True)
                (run_dir / "results.json").write_text(json.dumps(checks, indent=2), encoding="utf-8")
                print("Checks:", json.dumps(checks), flush=True)
                assert not checks.get("error"), checks
                screenshot = client.command("WebDriver:TakeScreenshot", {"full": True})
                if isinstance(screenshot, dict):
                    screenshot = screenshot["value"]
                (run_dir / "split-view.png").write_bytes(base64.b64decode(screenshot))
            print("Artifacts:", run_dir, flush=True)
        finally:
            if client:
                try:
                    client.command("Marionette:Quit", {"flags": ["eForceQuit"]})
                except (OSError, RuntimeError):
                    pass
                client.connection.close()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)
            server.shutdown()


if __name__ == "__main__":
    run()
