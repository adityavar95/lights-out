"""Lights Out as a desktop app: the same server and page in a native window (pywebview, WebView2 on Windows),
or in the browser, picked at launch. F1 TV sign-in happens in a window of the app's own, like MultiViewer.
Built into LightsOut.exe by scripts/build_exe.py."""
import json
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import unquote

if sys.stdout is None:  # the windowed exe has no console, and uvicorn's log formatter calls isatty on it
    sys.stdout = sys.stderr = open(Path(sys.executable).with_name("lightsout.log"), "w", buffering=1, encoding="utf-8")

import uvicorn
import webview

from server import app, warm_up

PORT = int(os.environ.get("LIGHTSOUT_PORT", 8086))
URL = f"http://127.0.0.1:{PORT}/"
LOGIN = "https://account.formula1.com/#/en/login"
# the login-session cookie F1's account site sets for scripts (see the bookmarklet in static/multiviewer.js)
TOKEN = "(document.cookie.match(/login-session=([^;]+)/) || [])[1] || ''"
CHOOSE = """<!doctype html><meta charset="utf-8"><title>Lights Out</title>
<style>
body { margin: 0; height: 100vh; display: grid; place-content: center; gap: 14px; text-align: center;
  background: #08080c; color: #f2f3f7; font: 15px system-ui, sans-serif; }
h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: .04em; } h1 b { color: #e10600; }
button { font: inherit; padding: 12px 28px; border-radius: 8px; border: 1px solid #3a3b44; background: #1b1c22; color: inherit; cursor: pointer; }
button:hover { border-color: #8a8b96; } button.main { background: #e10600; border-color: #e10600; font-weight: 600; }
p { margin: 0; color: #9a9ba6; } [hidden] { display: none; }
</style>
<h1>LIGHTS <b>OUT</b></h1>
<div id="pick" style="display: grid; gap: 10px">
  <button class="main" autofocus onclick="pywebview.api.open_app().then(url => location.href = url)">Open in the app</button>
  <button onclick="pywebview.api.open_browser(); pick.hidden = true; away.hidden = false">Open in the browser</button>
</div>
<div id="away" hidden style="display: grid; gap: 10px">
  <p>Lights Out is running in your browser.<br>Close this window to stop it.</p>
  <button onclick="pywebview.api.open_browser()">Open another tab</button>
</div>"""


def token_of(cookie: str) -> str | None:
    try:
        return json.loads(unquote(cookie))["data"]["subscriptionToken"] or None
    except (ValueError, KeyError, TypeError):
        return None


class Api:
    """Exposed to the page as window.pywebview.api."""

    def open_app(self):
        main.maximize()
        return URL  # the page goes there itself once this call has answered: load_url here left pywebview no page to answer

    def open_browser(self):
        webbrowser.open(URL)

    def f1tv_login(self):
        """Opens F1's sign-in in its own window, waits for the subscription token, closes it. None if the user closes it first."""
        win = webview.create_window("Sign in to F1 TV", LOGIN, width=520, height=760)
        closed = threading.Event()
        win.events.closed += closed.set
        while not closed.wait(1):  # polled: the account site is a single-page app, signing in doesn't load a page
            try:
                t = token_of(win.evaluate_js(TOKEN) or "")
            except Exception:  # between pages, or not loaded yet
                continue
            if t:
                win.destroy()
                return t
        return None


def serving() -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


if __name__ == "__main__":
    if not serving():  # else src/server.py is already running: use it
        threading.Thread(target=warm_up, daemon=True).start()
        threading.Thread(target=uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=PORT)).run, daemon=True).start()
        while not serving():
            time.sleep(0.1)
    main = webview.create_window("Lights Out", html=CHOOSE, js_api=Api(), width=420, height=340, min_size=(400, 320))
    webview.start()  # private mode (the default): no cookies or storage outlive the app, as in the browser tab
