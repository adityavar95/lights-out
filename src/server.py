"""F1 data browser backend: livef1/Jolpica tables, track maps and race replay data."""
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

import livef1
import pandas as pd
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

import f1auth
import f1tv
from jolpica import JOLPICA, driver_career, jolpica_fetch, races
from replay import OpenF1Locked, ReplayUnavailable, elevation, find_session, pitlane, replay, season_session_rows, session_telemetry, telemetry
import live
from tracks import _geo_track, mv_track, track

livef1.set_log_level("ERROR")
app = FastAPI(title="F1 data browser")
MAX_ROWS = 5000  # shortcut: bigger tables are truncated in the data explorer


def raw_json(data) -> Response:
    """Sends data as JSON without FastAPI's jsonable_encoder, which takes ~1 s to walk a multi-MB replay."""
    return Response(json.dumps(data, separators=(",", ":")), media_type="application/json")


def table(df: pd.DataFrame) -> dict:
    out = json.loads(df.head(MAX_ROWS).to_json(orient="split", index=False, date_format="iso", default_handler=str))
    return {"columns": out["columns"], "data": out["data"], "total": len(df)}


@lru_cache(maxsize=None)
def season(year: int):
    try:
        return livef1.get_season(year)
    except Exception as e:  # e.g. livef1 1.2.11 fails on 2010 with KeyError 'turkey'
        raise HTTPException(502, f"livef1 could not load the {year} season: {e!r}")


@app.get("/")
def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/api/seasons")
def seasons():
    return livef1.list_seasons()


@app.get("/api/season/{year}")
def season_sessions(year: int):
    if year >= 2023:
        try:
            rows = season_session_rows(year)
            return table(pd.DataFrame(rows, columns=["Round", "Session Name", "StartDate", "EndDate"]))
        except OpenF1Locked:
            pass  # OpenF1 is locked while a session is live and has no saved copy yet: livef1's slower table instead
        except Exception as e:
            raise HTTPException(502, f"OpenF1 could not load the {year} session list: {e!r}")
    return table(season(year).season_table.reset_index())


@app.get("/api/season/{year}/f1schedule")
def f1_schedule(year: int):
    try:
        return table(season(year).get_schedule())
    except Exception as e:
        raise HTTPException(502, f"formula1.com schedule unavailable: {e}")


@app.get("/api/jolpica/{year}/{kind}")
def jolpica(year: int, kind: str, round: int | None = None):
    if kind not in JOLPICA:
        raise HTTPException(404, f"Unknown kind '{kind}'. Use one of: {', '.join(JOLPICA)}")
    try:
        rows = jolpica_fetch(year, kind, round)
    except Exception as e:
        raise HTTPException(502, f"Jolpica request failed: {e}")
    return table(pd.json_normalize(rows))


@app.get("/api/driver/{driver_id}")
def driver(driver_id: str):
    """A driver's career: every race result and their final standing in each season (the Drivers tab)."""
    if not re.fullmatch(r"[a-z0-9_]+", driver_id):
        raise HTTPException(404, "Unknown driver")
    try:
        return raw_json(driver_career(driver_id))
    except Exception as e:
        raise HTTPException(502, f"Jolpica request failed: {e}")


def race_info(year: int, round: int) -> dict:
    race = next((r for r in races(year) if r["round"] == str(round)), None)
    if race is None:
        raise HTTPException(404, f"No round {round} in {year}")
    return race


@app.get("/api/track/{year}/{round}")
def race_track(year: int, round: int):
    c = race_info(year, round)["Circuit"]

    def lap():  # the elevation's OpenF1 lap, from any race there (2023+): same layout for an older race too
        try:
            return _elevation_at(c["circuitId"], date.today().year)
        except Exception:
            return None  # OpenF1 unreachable or locked: the GeoJSON outline will do
    try:
        t = track(c["circuitId"], year, float(c["Location"]["lat"]), float(c["Location"]["long"]), lap)
    except Exception as e:
        raise HTTPException(502, f"Track map request failed: {e}")
    if t is None:
        raise HTTPException(404, f"No track map available for {c['circuitName']}")
    return t


@lru_cache(maxsize=64)
def _geo(lat: float, lng: float):
    return _geo_track(lat, lng)


@app.get("/api/geo/{year}/{round}")
def race_geo(year: int, round: int):
    """The circuit's real outline in local metres (x east, y north of its lat/long) from the GeoJSON set: satellite.js
    fits the F1-coordinate outline to it to place the satellite imagery."""
    c = race_info(year, round)["Circuit"]
    lat, lng = float(c["Location"]["lat"]), float(c["Location"]["long"])
    try:
        g = _geo(lat, lng)
    except Exception as e:
        raise HTTPException(502, f"Circuit GeoJSON request failed: {e}")
    if g is None:
        raise HTTPException(404, f"No real-world outline for {c['circuitName']}")
    return {"x": g["x"], "y": g["y"], "lat": lat, "lng": lng}


def _races_at(circuit_id: str, newest: int):
    """(year, round, date) of the races held at a circuit, newest first, from `newest` back to 2023."""
    return [(y, int(r["round"]), r["date"]) for y in range(newest, 2022, -1)
            for r in races(y) if r["Circuit"]["circuitId"] == circuit_id]


def _elevation_at(circuit_id: str, newest: int):
    return elevation(circuit_id, [(y, d) for y, _, d in _races_at(circuit_id, newest)])


@app.get("/api/elevation/{year}/{round}")
def race_elevation(year: int, round: int):
    c = race_info(year, round)["Circuit"]["circuitId"]
    try:
        data = _elevation_at(c, year)
    except Exception as e:
        raise HTTPException(502, f"Elevation request failed: {e}")
    if data is None:
        raise HTTPException(404, "No OpenF1 car positions for this circuit (2023 onwards only)")
    return data


@app.get("/api/pitlane/{year}/{round}")
def race_pitlane(year: int, round: int):
    """One real pit stop's GPS at this circuit (replay.pitlane), from the newest 2023+ race there."""
    c = race_info(year, round)["Circuit"]["circuitId"]
    try:
        data = pitlane(c, [(y, d) for y, _, d in _races_at(c, max(year, date.today().year))])
    except Exception as e:
        raise HTTPException(502, f"Pit lane request failed: {e}")
    if data is None:
        raise HTTPException(404, "No OpenF1 pit stop positions for this circuit (2023 onwards only)")
    return data


@app.get("/api/circuit/{circuit_id}")
def circuit(circuit_id: str):
    """The most recent race held at a circuit (for the circuit selector): year, round and name."""
    today = str(date.today())
    for y in range(date.today().year, 2017, -1):  # back to 2018, where MultiViewer's outlines begin
        for r in reversed(races(y)):
            if r["Circuit"]["circuitId"] == circuit_id and r["date"] <= today:
                return {"year": y, "round": int(r["round"]), "raceName": r["raceName"]}
    raise HTTPException(404, f"No race at {circuit_id} since 2018")


LIVE_NOW = "This session is live now: opening live timing."  # replay.js switches to the live view on this


def _is_live(race: dict, session: str) -> bool:
    """Whether F1's live feed is running this session now (OpenF1 keeps it locked until it ends)."""
    info = live.snapshot()["topics"].get("SessionInfo") or {}
    start = (info.get("StartDate") or "")[:10]
    return bool(start) and (info.get("Name") or "").lower() == session.lower() \
        and abs((date.fromisoformat(start) - date.fromisoformat(race["date"])).days) <= 3


@app.get("/api/replay/{year}/{round}")
def race_replay(year: int, round: int, session: str = "Race"):
    race = race_info(year, round)
    try:
        return raw_json(replay(year, race, session))
    except ReplayUnavailable as e:
        raise HTTPException(409, LIVE_NOW) if _is_live(race, session) else HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Replay data request failed: {e}")


@app.get("/api/f1tv/account")
def f1tv_account(x_f1_token: str | None = Header(None)):
    """Whether the caller's F1 TV token (f1auth) is a live subscription, never the token itself."""
    t = f1auth.valid(x_f1_token)
    c = f1auth.claims(t) if t else {}
    return {"linked": bool(t), "product": c.get("SubscribedProduct"), "status": c.get("SubscriptionStatus"),
            "error": None if t or not x_f1_token else "F1 TV sign-in expired: connect again"}


@app.get("/api/f1tv/channels/{content_id}")
def f1tv_channels(content_id: int):
    try:
        return f1tv.channels(content_id)
    except Exception as e:
        raise HTTPException(502, f"F1 TV content unavailable: {e}")


@app.get("/api/f1tv/play/{content_id}")
def f1tv_play(content_id: int, channel: int | None = None, uhd: bool = False, x_f1_token: str | None = Header(None)):
    t = f1auth.valid(x_f1_token)
    if not t:
        raise HTTPException(401, "Connect your F1 TV account to play videos")
    try:
        return f1tv.play(content_id, channel, t, uhd)
    except f1tv.F1TVError as e:
        raise HTTPException(403, str(e))
    except Exception as e:
        raise HTTPException(502, f"F1 TV play request failed: {e}")


@app.get("/api/f1tv/telemetry/{year}/{round}/{driver}")
def f1tv_telemetry(year: int, round: int, driver: int, session: str = "Race"):
    """One car's telemetry over a whole session, for the multiviewer's overlay on an F1 TV stream."""
    race = race_info(year, round)
    try:
        # OpenF1 called 2023's sprint qualifying "Sprint Shootout"
        names = [session, "Sprint Shootout"] if session == "Sprint Qualifying" else [session]
        s = next((x for n in names if (x := find_session(year, race["date"], n))), None) if year >= 2023 else None
        if s is None:
            raise ReplayUnavailable("Car telemetry needs a 2023 or later session (OpenF1 data).")
        return raw_json(session_telemetry(s, driver))
    except ReplayUnavailable as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Telemetry request failed: {e}")


# registered after /api/f1tv/channels and /play, or it would catch them
@app.get("/api/f1tv/{year}/{round}")
def f1tv_videos(year: int, round: int):
    """The race weekend's F1 TV videos (sessions live or replayed, highlights, shows)."""
    race = race_info(year, round)
    try:
        return f1tv.videos(year, race["raceName"])
    except Exception as e:
        raise HTTPException(502, f"F1 TV catalogue unavailable: {e}")


@app.get("/api/live")
def live_state(x_f1_token: str | None = Header(None)):
    """Current state of the live (or most recent) session from F1's free live timing feed."""
    return raw_json(live.snapshot(f1auth.valid(x_f1_token)))  # polled every second


@app.get("/api/live/track")
def live_track():
    info = live.snapshot()["topics"].get("SessionInfo") or {}
    key = info.get("Meeting", {}).get("Circuit", {}).get("Key")
    try:
        t = mv_track(int(key), int(info["StartDate"][:4])) if key else None
    except Exception as e:
        raise HTTPException(502, f"Track map request failed: {e}")
    if t is None:
        raise HTTPException(404, "No track map for the live session's circuit")
    return t


@app.get("/api/live/table/{topic}")
def live_table(topic: str):
    topics = live.snapshot()["topics"]
    if topic not in topics:
        raise HTTPException(404, f"No live topic '{topic}'. Available: {', '.join(topics) or 'none yet'}")
    return table(pd.json_normalize(live.rows(topics[topic])))


@app.get("/api/telemetry/{year}/{round}")
def car_telemetry(year: int, round: int, driver: int, start: str, duration: float, session: str = "Race"):
    """start / duration: the GPS replay's, so its time grid is matched without rebuilding the replay."""
    race = race_info(year, round)
    try:
        t0 = datetime.fromisoformat(start)
    except ValueError:
        raise HTTPException(400, f"Bad start time '{start}'")
    if not 0 < duration <= 6 * 3600:
        raise HTTPException(400, "duration must be between 0 and 6 hours")
    try:
        s = find_session(year, race["date"], session) if year >= 2023 else None
        if s is None:
            raise ReplayUnavailable("Car telemetry needs a 2023 or later session (OpenF1 data).")
        return raw_json(telemetry(s, driver, t0, duration))
    except ReplayUnavailable as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Telemetry request failed: {e}")


@app.middleware("http")
async def revalidate_static(request, call_next):
    # Without it browsers cache old modules heuristically and mix them with new ones after an edit, and one missing
    # export blanks the whole app. no-cache still serves 304s for unchanged files.
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# replay payloads are several MB of JSON; level 1 is ~4x faster than the default 9 for ~20 % more bytes
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=1)
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

def warm_up():
    """The page's first load, done at start-up on parallel threads so the first visit finds warm caches: the season list,
    this season's calendar and sessions, the latest race's track, ground, heights and results (each 0.5-2.5 s cold,
    ~10 ms warm; the page asked for them one after another), and its GPS replay (~30 OpenF1 requests, ~40 s on the
    free tier; a click meanwhile waits on REPLAY_LOCKS instead of building it twice). All network-bound, so threads
    run them side by side despite the GIL."""
    today = date.today().isoformat()
    year = int(today[:4])
    try:
        last = [r for r in races(year) if r["date"] <= today]
    except Exception:
        return
    jobs = [seasons, lambda: jolpica(year, "races"), lambda: season_sessions(year)]
    if last:
        rnd = int(last[-1]["round"])
        jobs += [lambda: race_track(year, rnd), lambda: race_geo(year, rnd), lambda: race_elevation(year, rnd),
                 lambda: jolpica(year, "results", rnd)]
        if year >= 2023:
            jobs.append(lambda: replay(year, last[-1], "Race"))

    def quietly(job):
        try:
            job()
        except Exception:
            pass  # e.g. OpenF1 locked while a session is live: that part loads on first use as before

    with ThreadPoolExecutor(len(jobs)) as pool:
        pool.map(quietly, jobs)


if __name__ == "__main__":
    threading.Thread(target=warm_up, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8086)
