---
title: Desktop app is pywebview (src/desktop.py); F1 TV sign-in reads the login-session cookie from an app window
author: ADITYA
date: 2026-10-31
branch: master
cost: { minutes: 13, tokens: 92909 }
id: l-44be44e7
scope: repo
status: active
src: agent
touches:
  - src/desktop.py
  - src/static/multiviewer.js
  - CLAUDE.md
---

## Decided
- `src/desktop.py` wraps the unchanged server + page in a pywebview 6.2 window (WebView2 on Windows; pythonnet 3.2.1 has 3.14 wheels). It starts uvicorn on 0.0.0.0:8086 in a thread unless a server already answers there, so the browser and LAN keep working beside it.
- In-app F1 TV sign-in: `Api.f1tv_login` (window.pywebview.api) opens account.formula1.com in a second window and polls `evaluate_js` for the `login-session` cookie every 1 s (the account site is a single-page app: signing in fires no `loaded` event), then closes the window and returns the token. `multiviewer.js` `connectPanel` swaps the bookmarklet steps for a "Sign in to F1 TV" button when `window.pywebview` is there (now or on `pywebviewready`), stores the token in sessionStorage `f1tv` like the bookmarklet's `#f1tv=` return does, and calls onChange.
- pywebview's private mode (the default) keeps nothing between runs, matching the browser tab's this-tab-only token.
## Tried and ruled out
- Electron (MultiViewer's choice): reliable Widevine only with castLabs ECS + VMP signing, a Node shell and ~150 MB. Tauri: the same WebView2, plus Rust, so no gain.
## Watch out
- WebView2 decodes HEVC Main10 2160p and offers a Widevine CDM, but Microsoft doesn't officially support Widevine there (WebView2Feedback #4828): live (DRM) streams in the desktop app are untested; replays are clear DASH.
- Mobile later: http://<lan-ip> isn't a secure context (no service worker or install, no EME), so a phone needs HTTPS (mkcert/Tailscale); iOS has no Widevine. A Capacitor app could sign in the same way with an in-app browser's executeScript.
- Google sign-in is blocked inside WebView2; F1's email/password login is what works.
