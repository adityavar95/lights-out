---
title: The app is named Lights Out; keep F1 and Formula 1 out of its name and logo
author: ADITYA
date: 2026-10-30
branch: master
cost: { minutes: 21, tokens: 510449 }
id: l-90b961c9
scope: repo
status: active
src: agent
touches:
  - src/static/stream.js
  - src/static/index.html
  - src/server.py
  - README.md
---

## Decided
- The app is "Lights Out", with an "LO" mark in the red logo badge: `src/static/index.html` (page title, `.brand`), `src/server.py` (FastAPI title, module docstring), `README.md`. The user picked it over the old "F1 Data Browser": "F1" is Formula 1's trademark and the footer already says the app isn't associated with them. The name ties to the first-visit intro, which opens at lights out.
- Formula 1 is named only where it states a fact (the footer's "not associated with Formula 1", race data).
## Tried and ruled out
- Slipstream, Parc Fermé and Box Box were offered alongside it; the user chose Lights Out.
## Watch out
- Not checked: whether "Lights Out" is already a trademark or domain for a similar product. Check before it goes public.
