---
title: "F1 TV sign-in for a web app: bookmarklet reads F1's login-session cookie; no server-side password or token"
author: ADITYA
date: 2026-10-26
branch: master
cost: { minutes: 6, tokens: 112517 }
id: l-6955b309
scope: repo
status: active
src: agent
touches:
  - src/f1auth.py
  - src/live.py
  - src/static/multiviewer.js
---

## Decided
The F1 TV account is connected the MultiViewer way, adapted to a web page: the viewer's "Connect F1 TV" popover (`src/static/multiviewer.js`) gives a bookmarklet; the user signs in on account.formula1.com and clicks it there. It reads the `login-session` cookie (domain `.formula1.com`, set by account.formula1.com's main.min.js via `document.cookie`, value `encodeURIComponent(JSON.stringify({data:{subscriptionToken}}))`) and navigates back to `<app>/#f1tv=<token>`. `app.js` keeps it in sessionStorage (tab only, per the user: nothing stored locally/on the server); `util.js` `tvHeaders` sends `X-F1-Token`. `src/f1auth.py` only checks expiry. The old PingOne password login and `.cache/f1_token.json` / `f1_account.json` were removed at the user's request.
## Tried and ruled out
- OAuth redirect back to the app: the account site's PingOne client only redirects to formula1.com, so a code can't come back to localhost.
- Reading the cookie from our page: cross-site, impossible without an extension (MultiViewer is Electron and reads it from its own BrowserWindow).
## Watch out
- `live.py` has one shared feed connection: it uses the last poller's token (in memory), drops it when expired, and remembers one F1 rejected so pollers can't resend it every 5 s.
- sessionStorage survives the same-tab trip to formula1.com and back; `f1tv-back` restores the deep-link hash.
