"""GPS replays from F1's own timing archive (livetiming.formula1.com/static), for a caller with an F1 TV token.

Since Oct 2026 the archive answers 401 without one; with it, it serves 2018-2026 sessions (docs/handover/improve-4.md),
the same ~4 Hz car positions OpenF1 relays, in ~8 requests instead of OpenF1's ~30 and back past 2023. The build gives
replay.py's "gps" payload, so the browser can't tell the two apart. Any failure (401/403 without entitlement or an
archive gap, 404, F1 unreachable) raises, and replay.replay falls back to OpenF1 or lap times.

Streams are UTF-8 with a BOM, one `HH:MM:SS.fff<json>` line per update, the time counted from the archive's own start
(t0, found from Position's UTC timestamps). The .z streams carry a base64 raw-deflate JSON string.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json

import requests

import live
from replay import STEP, _resample, lap_seconds, ts

BASE = "https://livetiming.formula1.com/static/"
NEEDED = ("Position.z.jsonStream", "TimingData.jsonStream", "DriverList.jsonStream")
EXTRA = ("SessionStatus.jsonStream", "TimingAppData.jsonStream", "PitLaneTimeCollection.jsonStream",
         "WeatherData.jsonStream", "RaceControlMessages.json")


class Missing(Exception):
    """The archive has no such session for this token."""


def fetch(path: str, token: str) -> str:
    # The token goes in the header only: it must never reach a URL, a log or an exception message (CLAUDE.md)
    r = requests.get(BASE + path, headers={"Authorization": f"Bearer {token}", "User-Agent": "Mozilla/5.0"}, timeout=60)
    if r.status_code in (401, 403, 404):
        raise Missing(f"F1's archive answered {r.status_code} for {path}")
    r.raise_for_status()
    return r.content.decode("utf-8-sig")


def utc(s: str) -> datetime:
    """The archive's times: some end in Z, RaceControlMessages' carry no zone, both are UTC."""
    d = ts(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def local_utc(local: str, offset: str) -> datetime:
    """Index.json's StartDate/EndDate are local times with a GmtOffset like "03:00:00" or "-05:00:00"."""
    sign = -1 if offset.startswith("-") else 1
    h, m, *_ = offset.lstrip("-+").split(":")
    return utc(local) - sign * timedelta(hours=int(h), minutes=int(m))


def find(index: dict, race_date: str, session_name: str) -> dict | None:
    """The session of the meeting whose folder is dated within a day of the Jolpica race date (Las Vegas' Saturday
    night race sits on either side of midnight UTC)."""
    best = None
    for m in index.get("Meetings", []):
        for s in m.get("Sessions", []):
            if s.get("Name", "").lower() != session_name.lower() or not s.get("Path"):
                continue
            folder = s["Path"].split("/")[1][:10]  # "2021/2021-03-28_Bahrain_Grand_Prix/2021-03-28_Race/"
            try:
                days = abs((datetime.fromisoformat(folder) - datetime.fromisoformat(race_date)).days)
            except ValueError:
                continue
            if days <= 1 and (best is None or days < best[0]):
                best = (days, s)
    return best and best[1]


def stream(text: str | None):
    """(seconds since the archive's start, decoded payload) for each line of a .jsonStream."""
    for line in (text or "").splitlines():
        if len(line) <= 12 or line[2] != ":":
            continue
        h, m, s = line[:12].split(":")
        obj = json.loads(line[12:])
        yield int(h) * 3600 + int(m) * 60 + float(s), live.inflate(obj) if isinstance(obj, str) else obj


def _secs(v) -> float | None:
    try:
        return lap_seconds(v) if v else None
    except ValueError:
        return None


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _gap(v):
    """GapToLeader as OpenF1 gives it: seconds, "+N LAP(S)" for lapped cars; None for the leader's "LAP 12" or ""."""
    if not v or v.startswith("LAP"):
        return None
    if v.rstrip().endswith("L"):
        n = v.rstrip("L ").lstrip("+")
        return f"+{n} LAP{'S' if n != '1' else ''}"
    return _num(v.lstrip("+"))


def _items(v):
    """A feed list arrives as a list, or as {"0": ..., "1": ...} when its first sight was an update."""
    if isinstance(v, dict):
        return [v[k] for k in sorted((k for k in v if k.isdigit()), key=int)]
    return v or []


def build(files: dict, entry: dict, teams: dict | None = None) -> dict:
    """The "gps" replay payload from a session's archive files (name -> text, None when absent). entry: the session
    from the season's Index.json. teams: car number -> team name, for seasons whose DriverList has none (pre-2023)."""
    drivers = {}
    for _, d in stream(files["DriverList.jsonStream"]):
        live.merge(drivers, {k: v for k, v in d.items() if isinstance(v, dict)})
    drivers = {k: v for k, v in drivers.items() if v.get("Tla")}

    samples = {num: [] for num in drivers}
    t0 = None
    for n, (el, p) in enumerate(stream(files["Position.z.jsonStream"])):
        batches = p.get("Position") or []
        if n < 200 and batches:  # a line arrives a little after its last sample: the smallest lag is the closest t0
            c = utc(batches[-1]["Timestamp"]) - timedelta(seconds=el)
            t0 = c if t0 is None or c > t0 else t0
        for b in batches:
            for num, e in (b.get("Entries") or {}).items():
                if num in samples and "X" in e and "Y" in e:
                    samples[num].append({"date": b["Timestamp"], "x": e["X"], "y": e["Y"]})
    if t0 is None or not drivers:
        raise Missing("F1's archive has no car positions for this session")
    at = lambda el: t0 + timedelta(seconds=el)

    is_race = entry.get("Type") == "Race"  # Race and Sprint
    lights = next((at(el) for el, s in stream(files.get("SessionStatus.jsonStream")) if s.get("Status") == "Started"), None)

    positions, intervals, done, cur, laps = [], [], {}, {}, {}
    for el, td in stream(files["TimingData.jsonStream"]):
        t = at(el)
        for num, d in (td.get("Lines") or {}).items():
            if num not in drivers or not isinstance(d, dict):
                continue
            if d.get("Position"):
                positions.append([t, num, int(d["Position"])])
            if is_race and "GapToLeader" in d and (g := _gap(d["GapToLeader"])) is not None:
                intervals.append([t, num, g])
            sectors = d.get("Sectors")  # first, as a lap's last sector comes in the message that completes it
            for i, s in (enumerate(sectors) if isinstance(sectors, list) else
                         ((int(k), v) for k, v in (sectors or {}).items() if k.isdigit())):
                if isinstance(s, dict) and s.get("Value") and i < 3:
                    cur.setdefault(num, [None] * 3)[i] = _secs(s["Value"])
            k = d.get("NumberOfLaps")
            if isinstance(k, int) and k > done.get(num, 0):
                done[num] = k
                laps[num, k] = {"end": t, "dur": None, "sec": cur.pop(num, [None] * 3)}
            last = d.get("LastLapTime")
            if isinstance(last, dict) and last.get("Value") and done.get(num):
                laps[num, done[num]]["dur"] = _secs(last["Value"])  # it can come a message after the lap count

    rows = []
    for (num, k), lap in laps.items():
        prev = laps.get((num, k - 1))
        begin = prev["end"] if prev else lights if k == 1 and is_race and lights else \
            lap["end"] - timedelta(seconds=lap["dur"]) if lap["dur"] else None
        if begin:
            rows.append([begin, num, k, lap["dur"], *lap["sec"]])
    if not rows:
        raise Missing("F1's archive has no lap timing for this session")

    lap1 = [r[0] for r in rows if r[2] == 1]
    start = min(lap1) - timedelta(seconds=90) if is_race and lap1 else local_utc(entry["StartDate"], entry["GmtOffset"])
    end = max(r[0] for r in rows) + timedelta(seconds=180)
    n = int((end - start).total_seconds() / STEP) + 1
    rel = lambda d: round((d - start).total_seconds(), 1)

    frames = {num: _resample(s, start, n) for num, s in samples.items() if s}
    if not frames:
        raise Missing("F1's archive has no car positions for this session")

    stints = []
    apps = {}
    for _, a in stream(files.get("TimingAppData.jsonStream")):
        live.merge(apps, a.get("Lines") or {})
    for num, line in apps.items():
        lap = 0
        for s in _items(line.get("Stints") if isinstance(line, dict) else None):
            age, total = int(s.get("StartLaps") or 0), int(s.get("TotalLaps") or 0)
            stints.append([num, lap + 1, lap + max(total - age, 1), s.get("Compound"), age])
            lap += max(total - age, 1)

    pits = [[rel(at(el)), num, int(p["Lap"]) if str(p.get("Lap", "")).isdigit() else None, _num(p.get("Duration"))]
            for el, pc in stream(files.get("PitLaneTimeCollection.jsonStream"))
            for num, p in (pc.get("PitTimes") or {}).items() if num in drivers and isinstance(p, dict)]
    weather = [[rel(at(el)), _num(w.get("AirTemp")), _num(w.get("TrackTemp")), int(_num(w.get("Rainfall")) or 0),
                _num(w.get("WindSpeed"))] for el, w in stream(files.get("WeatherData.jsonStream"))]
    rc = json.loads(files["RaceControlMessages.json"]) if files.get("RaceControlMessages.json") else {}
    race_control = [[rel(utc(m["Utc"])), m.get("Category"), m.get("Flag"), m.get("Message")]
                    for m in _items(rc.get("Messages")) if m.get("Utc") and m.get("Message")]

    teams = teams or {}
    data = {
        "mode": "gps",
        "session": entry["Name"],
        "start": start.isoformat(),
        "step": STEP,
        "duration": (end - start).total_seconds(),
        "total_laps": max(r[2] for r in rows),
        "drivers": [{"id": num, "num": int(num), "code": d["Tla"], "name": d.get("FullName") or d.get("BroadcastName"),
                     "team": d.get("TeamName") or teams.get(num),
                     "color": f"#{d['TeamColour']}" if d.get("TeamColour") else None,
                     "headshot": d.get("HeadshotUrl")}
                    for num, d in sorted(drivers.items(), key=lambda kv: kv[1].get("Line") or 99) if num in frames],
        "frames": frames,
        "positions": [[rel(t), num, p] for t, num, p in positions],
        "laps": [[rel(r[0]), *r[1:]] for r in rows],
        "intervals": [[rel(t), num, g] for t, num, g in intervals],
        "race_control": race_control,
        "stints": stints,
        "pits": pits,
        "weather": weather,
    }
    for feed in ("positions", "laps", "intervals", "race_control", "pits", "weather"):
        data[feed].sort(key=lambda e: e[0])  # the browser binary-searches these by time
    return data


def replay(year: int, race_date: str, session_name: str, token: str, teams: dict | None = None) -> tuple[dict, datetime]:
    """(payload, the session's scheduled end in UTC) from the archive. Raises Missing, or requests' errors."""
    entry = find(json.loads(fetch(f"{year}/Index.json", token)), race_date, session_name)
    if not entry:
        raise Missing(f"F1's archive lists no {session_name} for this event")

    def get(name):
        try:
            return name, fetch(entry["Path"] + name, token)
        except Missing:
            if name in NEEDED:
                raise
            return name, None

    with ThreadPoolExecutor(max_workers=4) as pool:  # Position and CarData-sized files take 2-13 s each
        files = dict(pool.map(get, NEEDED + EXTRA))
    return build(files, entry, teams), local_utc(entry["EndDate"], entry["GmtOffset"])
