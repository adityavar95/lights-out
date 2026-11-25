# Audit phase 7 handover (25 Nov 2026)

Phase 7 of `docs/audit-fix-plan.md` is done, and with it the whole plan. `scripts/test_all.py` is green (34 JS suites,
test_server.py, tsc).

## What the user chose
- 7.1 Caches that only grow: comments only. `shortcut:` comments sit on `radio._errors` (covering `_rows` and
  `_texts`), `f1tv._cache` and `replay.REPLAY_LOCKS`, naming the limit: a server that runs for weeks. No code changed.
- 7.2 `#f1tv=` takes any value: done. `util.js` `isJwt` (three base64url parts joined by dots). `app.js`
  `takeToken` stores the value and counts `f1tv_connected` only when it passes. It still rewrites the address either
  way, so a bad value never stays in the history.
- 7.3 Tests for the 3D and replay modules: closed. The pure helpers from Phases 1, 3 and 4 already have tests.

## Tests
`test_util.mjs`: `isJwt` accepts a JWT-shaped string and refuses `''`, one or two parts, four parts, an empty part,
`<` and `%`.

## Not checked
- The bookmarklet sign-in was not run in a browser. The bookmarklet appends the raw `subscriptionToken` (a JWT, which
  `f1auth.claims` splits on dots), so the check should pass it. If F1 ever changes the token format, sign-in through the
  bookmarklet stops storing it. Look at `isJwt` first.

## Next
Nothing left in the audit plan.
