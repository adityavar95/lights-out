---
title: Syntax-check src/static modules with node --input-type=module --check < file; node --check file.js passed a broken one
author: ADITYA
date: 2026-10-29
branch: master
cost: { minutes: 25, tokens: 161566 }
id: l-2fed6189
scope: repo
status: active
src: agent
touches:
  - src/static/replay.js
---

## Decided
- Check a frontend module with `node --input-type=module --check < src/static/replay.js` (or load the page and read the console). `src/static` has no package.json, so Node treats the files as CommonJS scripts.
## Tried and ruled out
- `node --check src/static/replay.js`: exited 0 and printed nothing on a file whose template expression held a stray `'` ("every car's", unescaped inside `${... ? '' : '...'}`). The browser refused the module ("Missing } in template expression"), so app.js never ran and the page stayed empty.
## Watch out
- Writing JS through a Python heredoc: `\'` inside a Python string doesn't come out as `\'`. Use double quotes in the JS instead of escaping.
