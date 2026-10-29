"""Jolpica (Ergast successor) access through livef1's bundled client, flattened to one dict per row."""
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from basef1 import BaseF1Client, SQLiteCache
from livef1.adapters.jolpicaf1_adapter import jolpica_client  # its cache is in memory and lasts 5 minutes

# Answers about finished races don't change, so they are kept on disk: a race's lap times are ~15 Jolpica pages (~9 s).
SETTLED = BaseF1Client(cache=SQLiteCache(Path(__file__).resolve().parent.parent / ".cache" / "jolpica.sqlite",
                                         ttl_seconds=365 * 86400, clock=time.time))

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


def _pages(q, method: str, rows_of) -> list:
    rows, offset = [], 0
    while True:  # Jolpica caps pages at 100 rows (a race has ~1000 lap timings)
        res = getattr(q, method)(limit=100, offset=offset)
        rows += rows_of(res.data.to_dict())
        offset += 100
        if offset >= int(res.pagination.total):
            return rows


def driver_career(driver_id: str) -> dict:
    """Every race result of one driver (each with its race's season, round, name and date) and their final standing in
    each of those seasons. Jolpica only answers standings per season, so those are the seasons' own standings tables
    (disk-cached once a season is over, and shared with the Drivers tab's season view)."""
    active = any(d["driverId"] == driver_id for d in jolpica_fetch(date.today().year, "drivers"))
    results = _pages((jolpica_client if active else SETTLED).query().driver(driver_id), "get_results",  # retired: it won't change
                     lambda d: walk(d.get("Races", []), ["Results"]))
    seasons = sorted({int(r["season"]) for r in results})
    with ThreadPoolExecutor(4) as pool:  # Jolpica allows ~4 requests a second
        tables = list(pool.map(lambda y: jolpica_fetch(y, "driverstandings"), seasons))
    standings = [{**row, "season": str(y)} for y, rows in zip(seasons, tables) for row in rows if row["Driver"]["driverId"] == driver_id]
    return {"results": results, "standings": standings}


@lru_cache(maxsize=None)
def races(year: int) -> tuple:
    """A season's races. The circuit selector scans several seasons per card, and Jolpica allows ~500 requests an hour.
    shortcut: kept for the server's lifetime, so a mid-season calendar change shows after a restart."""
    return tuple(jolpica_fetch(year, "races"))
