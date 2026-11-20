"""OpenF1 feeds behind the Results tab's pit-stop league table and overtake ledger. Asked for only when a section is opened."""
import json
from threading import Lock

from replay import CACHE, ReplayUnavailable, _finished, laps_replay, openf1, replay_head, save, ts

LEDGERS = CACHE.parent / "ledgers"
_locks: dict = {}  # two sections asking for one feed: the second waits for the file, not for another request


def _feed(session: dict, kind: str) -> list:
    """One OpenF1 table of a session: 1 request, then on disk once the session is finished. An empty answer isn't kept:
    OpenF1 may still be filling it in."""
    path = LEDGERS / f"{session['session_key']}_{kind}.json"
    with _locks.setdefault(path, Lock()):
        if path.exists():
            return json.loads(path.read_text())
        rows = openf1(f"{kind}?session_key={session['session_key']}")
        if rows and _finished(session):
            save(path, rows)
        return rows


def stationary(_year: int, _round: int, session: dict) -> list:
    """[driver number, lap, stationary s, pit-lane s] of a race, every row, so the page can say how many have stationary
    time. 1 OpenF1 request (shared with the ledger). The cached replay can't serve this: it keeps no stop_duration."""
    return [[str(p["driver_number"]), p.get("lap_number"), p.get("stop_duration"), p.get("pit_duration")] for p in _feed(session, "pit")]


def stints(_year: int, _round: int, session: dict) -> list:
    """[driver number, first lap, last lap, compound, tyre age at its start] of a race's stints, as the GPS replay keeps
    them, in 1 OpenF1 request: the pace table's compounds, without the ~30 a replay costs to build."""
    return [[str(s["driver_number"]), s.get("lap_start"), s.get("lap_end"), s.get("compound"), s.get("tyre_age_at_start")]
            for s in _feed(session, "stints")]


def _lights_out(race_control: list, session: dict, first_overtake: str) -> str:
    """When the race started: race control's first SESSION STARTED of this session (the feed also holds earlier days').
    Within a second of lap 1's start in OpenF1's laps (measured: Mexico 2026)."""
    # shortcut: the first overtake stands in if the message is missing, seconds late; upgrade if such a race turns up
    return next((m["date"] for m in race_control if m["message"] == "SESSION STARTED" and m["date"] >= session["date_start"]), first_overtake)


def _jolpica_laps(year: int, rnd: int, start) -> list:
    """[seconds after start, driver number, lap] from Jolpica's lap times, which the lap-timing replay already fetches and caches."""
    data = laps_replay(year, rnd)
    rows = []
    for d in data["drivers"]:
        cum = data["cum"][d["id"]]
        rows += [[round(start + t, 1), str(d["num"]), lap + 1] for lap, t in enumerate([0, *cum])][:len(cum)]
    return rows


def overtakes(year: int, rnd: int, session: dict) -> dict:
    """The race's overtakes with what classifies them (ledgers.js), all as seconds on one clock. Costs 1 OpenF1 request
    when the race's GPS replay is on disk, whose feeds are reused without building it. Otherwise 3: overtakes, pit and
    race_control. Lap numbers then come from Jolpica rather than a 4th request."""
    rows = _feed(session, "overtakes")
    if not rows:
        raise ReplayUnavailable("OpenF1 has no overtake rows for this race.")
    d = replay_head(CACHE / f"{session['session_key']}.json")
    if d:
        origin, laps = ts(d["start"]), [e[:3] for e in d["laps"]]
        pits, race_control = [e[:3] for e in d["pits"]], d["race_control"]
    else:
        origin = ts(session["date_start"])
        rel = lambda s: round((ts(s) - origin).total_seconds(), 1)
        rc = sorted(_feed(session, "race_control"), key=lambda m: m["date"])
        pits = sorted(([rel(p["date"]), str(p["driver_number"]), p.get("lap_number")] for p in _feed(session, "pit")), key=lambda e: e[0])
        race_control = [[rel(m["date"]), m.get("category"), m.get("flag"), m["message"]] for m in rc]
        laps = _jolpica_laps(year, rnd, rel(_lights_out(rc, session, min(r["date"] for r in rows))))
    return {
        "overtakes": sorted(([round((ts(r["date"]) - origin).total_seconds(), 1), str(r["overtaking_driver_number"]),
                              str(r["overtaken_driver_number"]), r.get("position")] for r in rows), key=lambda e: e[0]),
        "laps": laps, "pits": pits, "race_control": race_control,
    }
