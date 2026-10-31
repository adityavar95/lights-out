---
title: Lights Out is MIT-licensed; README screenshots leave out F1 TV artwork
author: ADITYA
date: 2026-10-31
branch: master
cost: { minutes: 17, tokens: 190618 }
id: l-f69d2e56
scope: repo
status: active
src: agent
touches:
  - LICENSE
  - README.md
  - src/static/models/CREDITS.md
---

## Decided
- Licence is MIT (`LICENSE`, "Aditya Vardhan and the Lights Out contributors"), chosen by the user on 2026-10-31 so the README can call the project open source. The RB22 model stays CC BY 4.0 (`src/static/models/CREDITS.md`); data/imagery/video keep their sources' terms.
- README advertises it as free, community-driven and unofficial without mentioning money directly (user's brief): no paywall/premium tier/ads/accounts, plus the Formula One Licensing B.V. trademark disclaimer.
- Screenshots live in `docs/screenshots/` (1600x900 JPEGs, ~3 MB total), captured with headless Chrome over CDP (`--headless=new --use-angle=d3d11` renders WebGL on the real GPU) against the running server.

## Tried and ruled out
- GPL-3.0 / AGPL-3.0 (keep forks open) and no licence file were offered; the user picked MIT.
- Stream page screenshots: they show F1 TV's own thumbnails, logos and presenters, so they were left out of the public README; Stream is described in text.
- Monaco sim shots: satellite ground hadn't loaded (plain green), so not used.

## Watch out
- `docs/screenshots/drivers.jpg` contains Wikipedia driver photos (their photographers' rights); the README's License section says so. Replace it if that's a concern.
- The GitHub repo was private when the README was written; it must be made public for the open-source message to mean anything.
