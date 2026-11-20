"""Jolpica (Ergast successor) access through basef1, flattened to one dict per row."""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path

from basef1 import BaseF1Client, SQLiteCache
from basef1.exceptions import JolpicaHTTPError

# Answers about finished races don't change, so they are kept on disk: a race's lap times are ~15 Jolpica pages (~9 s).
SETTLED = BaseF1Client(cache=SQLiteCache(Path(__file__).resolve().parent.parent / ".cache" / "jolpica.sqlite",
                                         ttl_seconds=365 * 86400, clock=time.time))

jolpica_client = BaseF1Client()  # this season: its cache is in memory and lasts 5 minutes

# Jolpica resource -> (query method, path from response table down to one row)
JOLPICA = {
    "races": ("get_races", ["Races"]),
    "drivers": ("get_drivers", ["Drivers"]),
    "constructors": ("get_constructors", ["Constructors"]),
    "circuits": ("get_circuits", ["Circuits"]),
    "driverstandings": ("get_driver_standings", ["StandingsLists", "DriverStandings"]),
    "constructorstandings": ("get_constructor_standings", ["StandingsLists", "ConstructorStandings"]),
    "results": ("get_results", ["Races", "Results"]),
    "qualifying": ("get_qualifying", ["Races", "QualifyingResults"]),
    "sprint": ("get_sprint", ["Races", "SprintResults"]),
    "laps": ("get_laps", ["Races", "Laps", "Timings"]),
    "pitstops": ("get_pitstops", ["Races", "PitStops"]),
}


def walk(items: list, path: list) -> list:
    """Flatten nested Jolpica lists along `path`, copying each parent's scalar fields into its children."""
    if not path:
        return items
    return [
        {**{k: v for k, v in it.items() if not isinstance(v, list)}, **row}
        for it in items
        for row in walk(it.get(path[0], []), path[1:])
    ]


def jolpica_rows(data: dict, path: list) -> list:
    top = data.get(path[0], [])
    if len(path) == 1:
        return top
    # skip the top level (the race / standings list the user already picked) so its fields don't repeat on every row
    return [row for it in top for row in walk(it.get(path[1], []), path[2:])]


def _settled(year: int, round: int | None) -> bool:
    """A past season, or a race over 3 days ago.
    shortcut: a result changed later (a late penalty) stays as first fetched; delete .cache/jolpica.sqlite to refetch."""
    if year < date.today().year:
        return True
    race = round is not None and next((r for r in races(year) if r["round"] == str(round)), None)
    return bool(race) and race["date"] < str(date.today() - timedelta(days=3))


def jolpica_fetch(year: int, kind: str, round: int | None = None) -> list:
    method, path = JOLPICA[kind]
    q = (SETTLED if _settled(year, round) else jolpica_client).query().season(year)
    if round is not None:
        q = q.round(round)
    return _pages(q, method, lambda d: jolpica_rows(d, path))


def _page(q, method: str, offset: int):
    """One page, asked once more after a 429 or 5xx: Jolpica allows 4 a second and 500 an hour, and sends no limit
    headers, so one busy moment shouldn't fail a whole lap fetch."""
    try:
        return getattr(q, method)(limit=100, offset=offset)
    except JolpicaHTTPError as e:
        if e.status_code != 429 and e.status_code < 500:
            raise
        time.sleep(RETRY_WAIT)
        return getattr(q, method)(limit=100, offset=offset)


RETRY_WAIT = 2  # s


def _pages(q, method: str, rows_of) -> list:
    rows, offset = [], 0
    while True:  # Jolpica caps pages at 100 rows (a race has ~1000 lap timings)
        res = _page(q, method, offset)
        rows += rows_of(res.data.to_dict())
        offset += 100
        if offset >= int(res.pagination.total):
            return rows


def list_seasons() -> list:
    return [s.season for s in jolpica_client.get_seasons(limit=100).data.seasons]


def driver_career(driver_id: str) -> dict:
    """Every race result of one driver (each with its race's season, round, name and date) and their final standing in
    each of those seasons. Jolpica only answers standings per season, so those are the seasons' own standings tables
    (disk-cached once a season is over, and shared with the Drivers tab's season view)."""
    this = date.today().year  # last year's list too: this year's is empty until its first race weekend
    active = any(d["driverId"] == driver_id for y in (this, this - 1) for d in jolpica_fetch(y, "drivers"))
    results = _pages((jolpica_client if active else SETTLED).query().driver(driver_id), "get_results",  # retired: it won't change
                     lambda d: walk(d.get("Races", []), ["Results"]))
    seasons = sorted({int(r["season"]) for r in results})
    with ThreadPoolExecutor(4) as pool:  # Jolpica allows ~4 requests a second
        tables = list(pool.map(lambda y: jolpica_fetch(y, "driverstandings"), seasons))
    standings = [{**row, "season": str(y)} for y, rows in zip(seasons, tables) for row in rows if row["Driver"]["driverId"] == driver_id]
    return {"results": results, "standings": standings}


@lru_cache(maxsize=None)
def _races(year: int) -> tuple:
    return tuple(jolpica_fetch(year, "races"))


LAST = Path(__file__).resolve().parent.parent / ".cache" / "jolpica"  # server.last_or_fetch's answers
_down: dict = {}  # year -> (read at, races) from the saved list, while Jolpica isn't answering


def races(year: int) -> tuple:
    """A season's races. The circuit selector scans several seasons per card, and Jolpica allows ~500 requests an hour.
    shortcut: kept for the server's lifetime, so a mid-season calendar change shows after a restart.
    Jolpica down: the last list server.py saved, for 5 minutes at a time, so each request doesn't wait out a timeout first."""
    hit = _down.get(year)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    try:
        return _races(year)
    except Exception:
        saved = LAST / f"{year}_races_None.json"
        if not saved.exists():
            raise
        _down[year] = (time.time(), tuple(json.loads(saved.read_text())))
        return _down[year][1]


ICS_SESSIONS = [("FirstPractice", "Practice 1", 1), ("SecondPractice", "Practice 2", 1), ("ThirdPractice", "Practice 3", 1),
                ("SprintQualifying", "Sprint Qualifying", 1), ("SprintShootout", "Sprint Shootout", 1), ("Sprint", "Sprint", 1),
                ("Qualifying", "Qualifying", 1), (None, "Race", 2)]  # (Jolpica's key, name, hours on the calendar)


def calendar_ics(year: int) -> str:
    """The season's sessions as an iCalendar file (/api/calendar/{year}.ics), times in UTC so every calendar app shows
    its own zone. A session Jolpica gives no time for is left out, not guessed."""
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lights Out//EN", f"X-WR-CALNAME:{year} Grand Prix sessions"]
    for r in races(year):
        for key, name, hours in ICS_SESSIONS:
            s = r.get(key) if key else r
            if not s or not s.get("date") or not s.get("time"):
                continue
            start = datetime.fromisoformat(f"{s['date']}T{s['time']}".replace("Z", "+00:00"))
            where = r["Circuit"]
            out += ["BEGIN:VEVENT", f"UID:{year}-{r['round']}-{name.replace(' ', '')}@lightsout",
                    f"DTSTAMP:{start:%Y%m%dT%H%M%SZ}",  # fixed per event: the file is the same until the schedule changes
                    f"DTSTART:{start:%Y%m%dT%H%M%SZ}", f"DTEND:{start + timedelta(hours=hours):%Y%m%dT%H%M%SZ}",
                    f"SUMMARY:{name} · {r['raceName']}",
                    f"LOCATION:{where['circuitName']}\\, {where['Location']['locality']}\\, {where['Location']['country']}",
                    "END:VEVENT"]
    return "\r\n".join(out + ["END:VCALENDAR", ""])
