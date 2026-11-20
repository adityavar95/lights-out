# Handover after improvement phase 0 (20 Nov 2026)
Branch / commits: `improve-phase-0`, from `graphics-perf-phase-8`.

Done:
- `docs/improvement-plan.md` written (the planning session) with a Status checklist and the baseline table.
- `docs/handover/phase-8.md` rebuilt from commits `9200022`, `2dd6c52` and the cockpit-mirrors learning; Status
  line added in `docs/graphics-perf-review-plan.md:20`; `docs/handover/phase-7.md:64` no longer says unmerged.
- `AUDIT_AND_MASTER_PLAN.md` and `implementation.md` moved from the root into `docs/` (`git mv`). References
  name them by bare filename, so nothing needed rewriting.
- `scripts/test_all.py` runs every suite and prints `N failed: ...` at the end, exit 1 if any failed (checked on a
  fake tree with two failing suites).

Measured after: the baseline table in `docs/improvement-plan.md`.

Not done or not verified, and why:
- `CLAUDE.md` still names `CONTEXT.md` and `docs/adr/` (Agent skills > Domain docs). Left as is: the
  domain-modeling skill creates them lazily, so the reference isn't wrong, just ahead.
- No first-visit (empty cache) load time: only a reload was measured.

Watch out:
- Editing files through Python in a Bash heredoc halves backslashes (learning); use the Edit tool for `\n` strings.
- A cold GPS replay takes ~60 s; `warm_up` runs at start-up and competes for the same OpenF1 budget.

Next: phase 1, start with item 1 (`_throttle` in `src/replay.py:40-48`).
