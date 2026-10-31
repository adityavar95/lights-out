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


def token_of(cookie: str) -> str | None:
    try:
        return json.loads(unquote(cookie))["data"]["subscriptionToken"] or None
    except (ValueError, KeyError, TypeError):
        return None


class Api:
    """Exposed to the pages (the launcher, the app's own window) as window.pywebview.api."""

    def open_app(self):
        """The app in a window of its own (framed, maximised); the launcher closes once this call has answered."""
        webview.create_window("Lights Out", URL, js_api=self, maximized=True, min_size=(960, 640), background_color="#08080c")
        threading.Timer(0.3, launcher.destroy).start()

    def open_browser(self):
        webbrowser.open(URL)

    def minimize(self):
        launcher.minimize()

    def quit(self):
        for win in list(webview.windows):
            win.destroy()

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
    # the launcher (static/launcher.html): frameless glass with its own title bar, served by the app's server
    launcher = webview.create_window("Lights Out", URL + "static/launcher.html", js_api=Api(), width=460, height=560,
                                     resizable=False, frameless=True, easy_drag=False, shadow=True, background_color="#08080c")
    webview.start()  # private mode (the default): no cookies or storage outlive the app, as in the browser tab
