---
title: "#f1tv= is stored only when JWT-shaped (util.js isJwt); grow-only server caches stay unswept on purpose"
author: ADITYA
date: 2026-11-25
branch: multiviewer-layouts
cost: { minutes: 1, tokens: 1070 }
id: l-520d29e3
scope: repo
status: active
src: agent
touches:
  - src/static/app.js
---

## Decided
Audit phase 7 (user, 25 Nov 2026): `src/static/app.js` `takeToken` stores `#f1tv=` in sessionStorage only when `util.js` `isJwt` passes (three base64url parts joined by dots), so a crafted link can't plant an arbitrary value. The address is cleaned either way. The grow-only caches (`radio._errors/_rows/_texts`, `f1tv._cache`, `replay.REPLAY_LOCKS`) only get `shortcut:` comments, with no sweep: a season is a few thousand small entries.

## Tried and ruled out
Sweeping those caches: not worth the code until a server runs for weeks. More tests for the 3D/replay modules (audit 7.3): closed, because the pure helpers from phases 1, 3 and 4 are already tested.

## Watch out
If F1 changes the subscription token's format away from a JWT, bookmarklet sign-in quietly stops storing it. Check `isJwt` first.
