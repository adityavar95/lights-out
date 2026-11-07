"""Race replay data.

- "gps" mode (2023+): real car positions and timing feeds from OpenF1, resampled to a fixed time grid.
- "laps" mode (1996+ races): Jolpica lap times; the frontend moves cars along the track at each lap's average pace.
"""
import json
import math
import os
import time
import uuid
from bisect import bisect_right
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock

import requests

from jolpica import jolpica_fetch, races

OPENF1 = "https://api.openf1.org/v1/"
STEP = 0.5  # seconds between position frames sent to the browser
CACHE = Path(__file__).resolve().parent.parent / ".cache" / "replay"


class ReplayUnavailable(Exception):
    pass


class OpenF1Locked(ReplayUnavailable):
    """OpenF1 refuses free access to every session, past ones included, while any session is live."""


_sent: deque = deque(maxlen=30)  # when the last 30 OpenF1 requests went out, across every thread
_sent_lock = Lock()


def _throttle():
    """Waits for a slot in OpenF1's free tier: 30 requests in any 60 s, at most 3 a second. The lock stays held while
    waiting, so callers queue in turn; a short burst still goes out at full speed."""
    with _sent_lock:
        now = time.monotonic()
        wait = max(_sent[-1] + 1 / 3 - now if _sent else 0, _sent[0] + 60 - now if len(_sent) == _sent.maxlen else 0)
        if wait > 0:
            time.sleep(wait)
        _sent.append(time.monotonic())


def openf1(path: str) -> list:
    for attempt in range(6):
        _throttle()
        r = requests.get(OPENF1 + path, timeout=120)
        if r.status_code == 429:  # free tier allows ~3 req/s and 30 req/min
            time.sleep(3 * (attempt + 1))
            continue
        if r.status_code == 404:  # OpenF1 answers 404 for "no results"
            return []
        if r.status_code in (401, 403):  # OpenF1's own text is a sales pitch with a payment link: ours, shown on the page
            raise OpenF1Locked("Car data comes once the session ends: OpenF1 locks it while a session is live.")
        r.raise_for_status()
        return r.json()
    raise ReplayUnavailable("OpenF1 rate limit hit, try again in a minute.")


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def save(path: Path, data):
    """Write a cache file atomically: a server killed mid-write would otherwise leave half a JSON file that every later
    request fails to parse until it is deleted by hand."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(json.dumps(data))
        for wait in (0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, None):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:  # Windows refuses while another thread has the target open or is replacing it
                if wait is None:
                    raise
                time.sleep(wait)
    finally:
        tmp.unlink(missing_ok=True)


LISTS = CACHE.parent / "openf1"
_lists: dict = {}  # (kind, year) -> season list, for the server's lifetime; an empty answer isn't kept, so it's asked again


def _season_list(kind: str, year: int) -> list:
    """A season's meetings or sessions (OpenF1 lists the whole season ahead). The last good copy is kept on disk, so
    cached replays still open while OpenF1 is locked during a live session."""
    if (kind, year) in _lists:
        return _lists[kind, year]
    saved = LISTS / f"{kind}_{year}.json"
    try:
        rows = openf1(f"{kind}?year={year}")
        if rows:
            save(saved, rows)
        elif saved.exists():
            rows = json.loads(saved.read_text())
    except OpenF1Locked:
        if not saved.exists():
            raise
        rows = json.loads(saved.read_text())
    if rows:
        _lists[kind, year] = rows
    return rows


def _meetings(year: int) -> list:
    return _season_list("meetings", year)


def _sessions(year: int) -> list:
    return _season_list("sessions", year)


def session_rows(races: list, meetings: list, sessions: list) -> list:
    """OpenF1 session rows grouped with their Jolpica race round."""
    by_meeting = {}
    for meeting in meetings:
        start, end = meeting.get("date_start"), meeting.get("date_end")
        if start and end:
            by_meeting[str(meeting["meeting_key"])] = meeting

    rows = []
    for race in races:
        meeting = next((m for m in by_meeting.values()
                        if m["date_start"][:10] <= race["date"] <= m["date_end"][:10]), None)
        if meeting is None:
            continue
        for session in sessions:
            if str(session.get("meeting_key")) == str(meeting["meeting_key"]):
                rows.append({"Round": str(race["round"]), "Session Name": session["session_name"],
                             "StartDate": session.get("date_start"), "EndDate": session.get("date_end")})
    return rows


def season_session_rows(year: int) -> list:
    """Session picker data from OpenF1, associated to rounds by the race date."""
    return session_rows(races(year), _meetings(year), _sessions(year))


def find_session(year: int, race_date: str, session_name: str) -> dict | None:
    """The OpenF1 session for the meeting whose dates include the Jolpica race date."""
    meeting = next((m for m in _meetings(year) if m.get("date_start")
                    and m["date_start"][:10] <= race_date <= (m.get("date_end") or race_date)[:10]), None)
    if meeting is None:
        return None
    return next((s for s in _sessions(year) if s["meeting_key"] == meeting["meeting_key"]
                 and s["session_name"].lower() == session_name.lower()), None)


def scheduled_session(now: datetime) -> str | None:
    """'Meeting · Session' of the session inside its scheduled times + 30 min (they overrun), else None: tells whether
    to expect a live session without opening the live feed."""
    for s in _sessions(now.year):
        if s.get("date_start") and s.get("date_end") and ts(s["date_start"]) <= now <= ts(s["date_end"]) + timedelta(minutes=30):
            meeting = next((m for m in _meetings(now.year) if m["meeting_key"] == s["meeting_key"]), {})
            return f"{meeting.get('meeting_name', 'Live session')} · {s['session_name']}"
    return None


def _resample(samples: list, start: datetime, n: int) -> dict:
    """Linear interpolation of x/y onto the STEP grid; None where the car has no data for >5 s."""
    t = [(ts(s["date"]) - start).total_seconds() for s in samples]
    xs, ys = [], []
    for i in range(n):
        g = i * STEP
        j = bisect_right(t, g)
        if j == 0 or j == len(t) or t[j] - t[j - 1] > 5:
            xs.append(None)
            ys.append(None)
            continue
        f = (g - t[j - 1]) / (t[j] - t[j - 1])
        a, b = samples[j - 1], samples[j]
        xs.append(round(a["x"] + f * (b["x"] - a["x"])))
        ys.append(round(a["y"] + f * (b["y"] - a["y"])))
    return {"x": xs, "y": ys}


def _hold(samples: list, start: datetime, n: int, fields: tuple) -> dict:
    """Latest value at or before each STEP grid point; None before the first sample or after a >5 s gap."""
    t = [(ts(s["date"]) - start).total_seconds() for s in samples]
    out = {f: [] for f in fields}
    for i in range(n):
        j = bisect_right(t, i * STEP) - 1
        ok = j >= 0 and i * STEP - t[j] <= 5
        for f in fields:
            out[f].append(samples[j][f] if ok else None)
    return out


def _finished(session: dict) -> bool:
    # OpenF1 keeps filling in a session for a while after it ends, so only cache older ones
    return ts(session["date_end"]) < datetime.now(timezone.utc) - timedelta(hours=2)


REPLAY_LOCKS: dict[int, Lock] = {}  # a second request for a session being built waits for its cache, not ~30 more calls
RECENT_TTL = 300  # s: how long a session too recent for the disk cache keeps its build (OpenF1 is still filling it in)
_recent: dict = {}  # session_key -> (built at, replay)


def gps_replay(session: dict) -> dict:
    with REPLAY_LOCKS.setdefault(session["session_key"], Lock()):
        return _gps_replay(session)


def _gps_replay(session: dict) -> dict:
    sk = session["session_key"]
    cached = CACHE / f"{sk}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    hit = _recent.get(sk)
    if hit and time.time() - hit[0] < RECENT_TTL:
        return hit[1]

    drivers = openf1(f"drivers?session_key={sk}")
    laps = [l for l in openf1(f"laps?session_key={sk}") if l.get("date_start")]
    if not drivers or not laps:
        raise ReplayUnavailable("OpenF1 has no timing data for this session yet.")

    is_race = session["session_type"] == "Race"  # Race and Sprint
    lap1 = [ts(l["date_start"]) for l in laps if l["lap_number"] == 1]
    start = min(lap1) - timedelta(seconds=90) if is_race and lap1 else ts(session["date_start"])
    end = max(ts(l["date_start"]) for l in laps) + timedelta(seconds=180)
    n = int((end - start).total_seconds() / STEP) + 1
    window = f"&date>={start.isoformat()[:19]}&date<={end.isoformat()[:19]}"
    rel = lambda d: round((ts(d) - start).total_seconds(), 1)

    def locations(num):
        return num, openf1(f"location?session_key={sk}&driver_number={num}{window}")

    with ThreadPoolExecutor(max_workers=3) as pool:
        frames = {str(num): _resample(samples, start, n)
                  for num, samples in pool.map(locations, [d["driver_number"] for d in drivers]) if samples}
    if not frames:
        raise ReplayUnavailable("OpenF1 has no car position data for this session yet.")

    data = {
        "mode": "gps",
        "session": session["session_name"],
        "start": start.isoformat(),
        "step": STEP,
        "duration": (end - start).total_seconds(),
        "total_laps": max(l["lap_number"] for l in laps),
        "drivers": [{"id": str(d["driver_number"]), "num": d["driver_number"], "code": d["name_acronym"],
                     "name": d["full_name"], "team": d["team_name"],
                     "color": f"#{d['team_colour']}" if d.get("team_colour") else None,
                     "headshot": d.get("headshot_url")} for d in drivers],
        "frames": frames,
        "positions": [[rel(p["date"]), str(p["driver_number"]), p["position"]]
                      for p in openf1(f"position?session_key={sk}")],
        "laps": [[rel(l["date_start"]), str(l["driver_number"]), l["lap_number"], l.get("lap_duration"),
                  l.get("duration_sector_1"), l.get("duration_sector_2"), l.get("duration_sector_3")] for l in laps],
        "intervals": [[rel(i["date"]), str(i["driver_number"]), i["gap_to_leader"]]
                      for i in (openf1(f"intervals?session_key={sk}") if is_race else [])],
        "race_control": [[rel(m["date"]), m.get("category"), m.get("flag"), m["message"]]
                         for m in openf1(f"race_control?session_key={sk}")],
        "stints": [[str(s["driver_number"]), s.get("lap_start"), s.get("lap_end"), s.get("compound"), s.get("tyre_age_at_start")]
                   for s in openf1(f"stints?session_key={sk}")],
        "pits": [[rel(p["date"]), str(p["driver_number"]), p.get("lap_number"), p.get("pit_duration")]
                 for p in openf1(f"pit?session_key={sk}")],
        "weather": [[rel(w["date"]), w["air_temperature"], w["track_temperature"], w["rainfall"], w["wind_speed"]]
                    for w in openf1(f"weather?session_key={sk}")],
    }
    for feed in ("positions", "laps", "intervals", "race_control", "pits", "weather"):
        data[feed].sort(key=lambda e: e[0])  # the browser binary-searches these by time
    if _finished(session):
        save(cached, data)
    else:
        for k, (built, _) in list(_recent.items()):  # these are several MB each
            if time.time() - built >= RECENT_TTL:
                _recent.pop(k, None)
        _recent[sk] = (time.time(), data)
    return data


ELEVATION = CACHE.parent / "elevation"
ELEVATION_LOCKS: dict[str, Lock] = {}  # /api/track and /api/elevation ask in parallel: the second waits for the cache


def elevation(circuit_id: str, races) -> dict | None:
    """A circuit's height profile: x, y, z of the fastest race lap's car positions (decimetres, the F1 timing coordinates
    the MultiViewer outlines use, so heights can be matched to outline points by position). races: (year, race date)
    pairs at this circuit, newest first; the first OpenF1 race (2023+) with laps is used. Cached per circuit."""
    with ELEVATION_LOCKS.setdefault(circuit_id, Lock()):
        return _elevation(circuit_id, races)


def _elevation(circuit_id: str, races) -> dict | None:
    cached = ELEVATION / f"{circuit_id}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    for year, race_date in races:
        if year < 2023:
            break
        session = find_session(year, race_date, "Race")
        laps = session and [l for l in openf1(f"laps?session_key={session['session_key']}")
                            if l.get("lap_duration") and l.get("date_start")]
        if not laps:
            continue
        best = min(laps, key=lambda l: l["lap_duration"])
        t0 = ts(best["date_start"])
        window = f"&date>={t0.isoformat()[:19]}&date<={(t0 + timedelta(seconds=best['lap_duration'])).isoformat()[:19]}"
        pos = openf1(f"location?session_key={session['session_key']}&driver_number={best['driver_number']}{window}")
        if len(pos) < 50:
            continue
        data = {"x": [p["x"] for p in pos], "y": [p["y"] for p in pos], "z": [p["z"] for p in pos], "year": year}
        save(cached, data)
        return data
    return None


PITLANE = CACHE.parent / "pitlane"
PITLANE_LOCKS: dict[str, Lock] = {}


def pitlane(circuit_id: str, races) -> dict | None:
    """A circuit's real pit lane: x, y of one car's positions (decimetres, F1 timing coordinates) round a pit stop in
    the newest OpenF1 race there (2023+); the browser cuts the part off the track out of it (strategy.js pitTrace).
    OpenF1's pit `date` falls near the car leaving the lane rather than entering it, so the window is a lane time plus
    20 s either side of it. The stop with the median lane time is used: no drive-through or a long repair.
    races: (year, race date) pairs, newest first. Two OpenF1 requests per circuit, cached."""
    with PITLANE_LOCKS.setdefault(circuit_id, Lock()):
        cached = PITLANE / f"{circuit_id}.json"
        if cached.exists():
            return json.loads(cached.read_text())
        for year, race_date in races:
            if year < 2023:
                break
            session = find_session(year, race_date, "Race")
            stops = session and sorted((p for p in openf1(f"pit?session_key={session['session_key']}")
                                        if p.get("lane_duration") and p.get("date")), key=lambda p: p["lane_duration"])
            # the median stop, or the next ones if its GPS is missing or the car never moved (parked in its garage)
            for stop in (stops or [])[len(stops or []) // 2:][:5]:
                t0, span = ts(stop["date"]), timedelta(seconds=stop["lane_duration"] + 20)
                window = f"&date>={(t0 - span).isoformat()[:19]}&date<={(t0 + span).isoformat()[:19]}"
                pos = openf1(f"location?session_key={session['session_key']}&driver_number={stop['driver_number']}{window}")
                steps = [math.hypot(b["x"] - a["x"], b["y"] - a["y"]) for a, b in zip(pos, pos[1:])]
                # decimetres: a real stop covers well over 600 m in the window, and no car moves 150 m between samples
                # (some traces freeze the car at a point hundreds of metres away while it is in the lane)
                if len(pos) < 30 or sum(steps) < 6000 or max(steps) > 1500:
                    continue
                data = {"x": [p["x"] for p in pos], "y": [p["y"] for p in pos], "year": year}
                save(cached, data)
                return data
        return None


CAR_FIELDS = ("speed", "rpm", "n_gear", "throttle", "brake", "drs")


def _replay_grid(sk: int, start: datetime, duration: float) -> bool:
    """Whether this window is the cached GPS replay's own."""
    try:
        r = json.loads((CACHE / f"{sk}.json").read_text())
    except (OSError, ValueError):
        return False
    return ts(r["start"]) == start and r["duration"] == duration


def telemetry(session: dict, driver_number: int, start: datetime, duration: float, tag: str = "") -> dict:
    """One car's speed/rpm/gear/throttle/brake/DRS on its GPS replay's time grid. start / duration come from the
    browser's replay, so a session too recent to be cached isn't rebuilt (~30 OpenF1 requests) per driver.
    The cache ignores start, so a caller with another time grid passes its own tag (the F1 TV overlay: "_tv")."""
    sk = session["session_key"]
    cached = CACHE / f"{sk}_car{driver_number}{tag}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    end = start + timedelta(seconds=duration)
    samples = openf1(f"car_data?session_key={sk}&driver_number={driver_number}"
                     f"&date>={start.isoformat()[:19]}&date<={end.isoformat()[:19]}")
    if not samples:
        raise ReplayUnavailable("OpenF1 has no car telemetry for this driver.")
    samples.sort(key=lambda s: s["date"])
    data = {"step": STEP, **_hold(samples, start, int(duration / STEP) + 1, CAR_FIELDS)}
    # the cache serves everyone, so a window the browser sent must be the replay's, or a short one would truncate it
    if _finished(session) and (tag or _replay_grid(sk, start, duration)):
        save(cached, data)
    return data


EVENTS = CACHE.parent / "events"


def session_events(session: dict) -> dict:
    """What the F1 TV viewer's seek bars mark: race control, who led and the start, in 4 requests where a GPS replay
    takes ~30. Times in seconds from `start`, the same window as session_telemetry."""
    sk = session["session_key"]
    cached = EVENTS / f"{sk}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    start = ts(session["date_start"]) - timedelta(minutes=10)
    rel = lambda d: round((ts(d) - start).total_seconds(), 1)
    first = [rel(l["date_start"]) for l in openf1(f"laps?session_key={sk}&lap_number=1") if l.get("date_start")]
    data = {
        "start": start.isoformat(),
        "duration": (ts(session["date_end"]) - start).total_seconds() + 40 * 60,
        "drivers": [{"id": str(d["driver_number"]), "code": d["name_acronym"]} for d in openf1(f"drivers?session_key={sk}")],
        "race_control": sorted(([rel(m["date"]), m.get("category"), m.get("flag"), m["message"]]
                                for m in openf1(f"race_control?session_key={sk}")), key=lambda e: e[0]),
        "positions": sorted(([rel(p["date"]), str(p["driver_number"]), 1] for p in openf1(f"position?session_key={sk}&position=1")),
                            key=lambda e: e[0]),
        "first_lap": min(first) if first and session.get("session_type") == "Race" else None,
    }
    if _finished(session):
        EVENTS.mkdir(parents=True, exist_ok=True)
        save(cached, data)
    return data


def session_telemetry(session: dict, driver_number: int) -> dict:
    """The whole session's telemetry for one car (the F1 TV overlay): 10 min before the scheduled start to 40 min
    after the scheduled end, with the grid's start time, since a broadcast's video runs on past both."""
    start = ts(session["date_start"]) - timedelta(minutes=10)
    duration = (ts(session["date_end"]) - start).total_seconds() + 40 * 60
    return {"start": start.isoformat(), **telemetry(session, driver_number, start, duration, "_tv")}


def lap_seconds(s: str) -> float:
    """'1:57.099' -> 117.099 (also handles 'ss.sss' and 'h:mm:ss.sss')."""
    return sum(float(p) * 60 ** i for i, p in enumerate(reversed(s.split(":"))))


def laps_replay(year: int, rnd: int) -> dict:
    laps = jolpica_fetch(year, "laps", rnd)
    if not laps:
        raise ReplayUnavailable("No lap-by-lap timing for this race (Jolpica has it from 1996 onwards).")
    results = jolpica_fetch(year, "results", rnd)
    cum, positions = {}, {}
    for lap in sorted(laps, key=lambda l: int(l["number"])):
        c = cum.setdefault(lap["driverId"], [])
        c.append(round((c[-1] if c else 0) + lap_seconds(lap["time"]), 3))
        positions.setdefault(lap["driverId"], []).append(int(lap["position"]))
    pits = {}
    for p in jolpica_fetch(year, "pitstops", rnd):
        pits.setdefault(p["driverId"], []).append(int(p["lap"]))
    return {
        "mode": "laps",
        "session": "Race",
        "step": None,
        "duration": max(c[-1] for c in cum.values()),
        "total_laps": max(len(c) for c in cum.values()),
        "drivers": [{"id": r["Driver"]["driverId"], "num": r.get("number"),
                     "code": r["Driver"].get("code") or r["Driver"]["familyName"][:3].upper(),
                     "name": f"{r['Driver']['givenName']} {r['Driver']['familyName']}",
                     "team": r["Constructor"]["name"], "teamId": r["Constructor"]["constructorId"],
                     "grid": int(r["grid"]), "status": r["status"], "finish": r["positionText"]}
                    for r in results if r["Driver"]["driverId"] in cum],
        "cum": cum,
        "lap_positions": positions,
        "pits": pits,
    }


def replay(year: int, race: dict, session_name: str) -> dict:
    gps_error = None
    if year >= 2023:
        try:
            session = find_session(year, race["date"], session_name)
            if session:
                return gps_replay(session)
            gps_error = f"OpenF1 has no '{session_name}' session for this event."
        except ReplayUnavailable as e:
            gps_error = str(e)
    if session_name.lower() == "race":
        return laps_replay(year, int(race["round"]))
    raise ReplayUnavailable(gps_error or "Position replays of practice, qualifying and sprint sessions need 2023 or later (OpenF1 data). Lap-timing replays cover races only.")
