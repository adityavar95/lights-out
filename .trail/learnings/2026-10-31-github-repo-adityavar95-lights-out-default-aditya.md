---
title: "GitHub repo adityavar95/lights-out: default branch is master; main was made as a PR base at 652516c"
author: ADITYA
date: 2026-10-31
branch: master
cost: { minutes: 9, tokens: 74874 }
id: l-525cf9cc
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - README.md
  - pyproject.toml
  - scripts/build_exe.py
  - src/desktop.py
  - src/static/multiviewer.js
  - tests/test_server.py
  - uv.lock
---

## Decided
The repo was created on 2026-10-31 (private) from this checkout with only `master`, which is GitHub's default branch. PR #1 (desktop app + exe) needed a base, so `main` was pushed at 652516c, the commit before that work; the PR goes master -> main.

## Watch out
Until the user picks one, master and main both exist: after merging PR #1, main equals master. If main becomes the trunk, switch the default branch in GitHub settings and branch off main for later PRs. Windows builds go out as release assets (LightsOut-windows-x64.zip, built with scripts/build_exe.py), never committed: dist/ and build/ are git-ignored.
