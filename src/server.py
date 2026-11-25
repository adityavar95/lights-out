"""Lights Out backend: Jolpica/OpenF1 tables, track maps and race replay data."""
import os
# Before numpy loads (radio's transcriber): OpenBLAS commits a buffer per CPU thread, ~740 MB on a 32-thread CPU, and
# nothing here does matrix maths
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
import asyncio
import gzip
import ipaddress
import json
import mimetypes
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from urllib.parse import urlsplit

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Path as PathParam, Query, Request
from fastapi.concurrency import run_in_threadpool
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

import assets
import f1auth
import f1tv
import ledgers
import radio
from jolpica import JOLPICA, calendar_ics, driver_career, jolpica_fetch, list_seasons, races, session_rows
from replay import CACHE, OpenF1Locked, background, ReplayUnavailable, elevation, find_session, laps_replay, pitlane, replay, save, saved_head, saved_replay, scheduled_session, session_events, season_session_rows, session_telemetry, telemetry
import live
from tracks import _geo_track, mv_track, track

app = FastAPI(title="Lights Out")
MAX_ROWS = 5000  # shortcut: bigger tables are truncated in the data explorer


def raw_json(data) -> Response:
    """Sends data as JSON without FastAPI's jsonable_encoder, which takes ~1 s to walk a multi-MB replay."""
    return Response(json.dumps(data, separators=(",", ":")), media_type="application/json")


def _flat(d: dict, pre: str = "") -> dict:
    out = {}
    for k, v in d.items():
        out.update(_flat(v, f"{pre}{k}.") if isinstance(v, dict) else {pre + k: v})
    return out


def table(rows: list, columns: list | None = None) -> dict:
    """Row dicts as {columns, data, total}, nested dicts flattened to dotted names ('Driver.code'): what pandas'
    json_normalize gave, top-level fields first, without the second it took to import."""
    flat = [{**{k: v for k, v in r.items() if not isinstance(v, dict)}, **_flat({k: v for k, v in r.items() if isinstance(v, dict)})}
            for r in rows[:MAX_ROWS]]
    columns = columns or list(dict.fromkeys(k for r in flat for k in r))
    return {"columns": columns, "data": [[r.get(c) for c in columns] for r in flat], "total": len(rows)}


def check_season(year: int, round: int | None = None):
    """Years and rounds come from the url: anything else would spend Jolpica's ~500 requests an hour, and fill its caches."""
    if not 1950 <= year <= date.today().year + 1:
        raise HTTPException(404, f"No {year} season")
    if round is not None and not 1 <= round <= 30:
        raise HTTPException(404, f"No round {round} in {year}")


@app.get("/")
def index():
    try:
        assets.core()
    except Exception as e:
        raise HTTPException(503, f"The first start needs internet to fetch the page's libraries: {e!r}")
    return FileResponse(Path(__file__).parent / "static" / "index.html")


SEASONS = CACHE.parent / "seasons.json"


@app.get("/api/seasons")
def seasons():
    """Every season, oldest first. One new season a year, so Jolpica is asked once a day at most; when it's slow or down
    (a read timeout here was a 500, and the page had no year picker) the last list, else every year since 1950."""
    try:
        if time.time() - SEASONS.stat().st_mtime < 86400:
            return json.loads(SEASONS.read_text())
    except (OSError, ValueError):
        pass
    try:
        years = list_seasons()
        save(SEASONS, years)
        return years
    except Exception:
        try:
            return json.loads(SEASONS.read_text())
        except (OSError, ValueError):
            return [str(y) for y in range(1950, date.today().year + 1)]


@app.get("/api/calendar/{year}.ics")
def calendar(year: int):
    """Every session of the season for a calendar app (the hero's Add to calendar)."""
    check_season(year)
    try:
        body = calendar_ics(year)
    except Exception as e:
        raise HTTPException(502, f"Jolpica could not give the {year} calendar: {e}")
    return Response(body, media_type="text/calendar", headers={"Content-Disposition": f'attachment; filename="grand-prix-{year}.ics"'})


@app.get("/api/season/{year}")
def season_sessions(year: int):
    check_season(year)
    if year >= 2023:
        try:
            rows = season_session_rows(year)
            return table(rows, ["Round", "Session Name", "StartDate", "EndDate"])
        except OpenF1Locked:
            pass  # OpenF1 is locked while a session is live and has no saved copy yet: Jolpica's times instead
        except Exception as e:
            raise HTTPException(502, f"OpenF1 could not load the {year} session list: {e!r}")
    try:
        return table(session_rows(year), ["Round", "Session Name", "StartDate", "EndDate"])
    except Exception as e:
        raise HTTPException(502, f"Jolpica could not load the {year} session list: {e!r}")


@app.get("/api/jolpica/{year}/{kind}")
def jolpica(year: int, kind: str, round: int | None = None):
    if kind not in JOLPICA:
        raise HTTPException(404, f"Unknown kind '{kind}'. Use one of: {', '.join(JOLPICA)}")
    check_season(year, round)
    if kind in ("laps", "pitstops") and round is None:
        raise HTTPException(400, "Pick a round: a season of lap times is over 200 Jolpica requests.")
    fetch = lambda: jolpica_fetch(year, kind, round)
    try:
        rows = last_or_fetch(f"{year}_{kind}_{round}", fetch) if year >= date.today().year else fetch()
    except Exception as e:
        raise HTTPException(502, f"Jolpica request failed: {e}")
    return table(rows)


LAST = CACHE.parent / "jolpica"  # the last answer to each of this season's Jolpica requests
_refreshing = set()
_refreshing_lock = threading.Lock()  # routes run on a thread pool: two requests mustn't both refresh one key


def last_or_fetch(key: str, fetch, max_age: float = 300):
    """This season's answers change (calendar, results, standings), so they're fetched again after 5 minutes, but the
    page gets the last one at once while that runs in the background: Jolpica took ~11 s for a race list, or timed out,
    and the whole page waited on it. Only the first request for a key waits (and fails with Jolpica)."""
    path = LAST / f"{key}.json"
    try:
        age, data = time.time() - path.stat().st_mtime, json.loads(path.read_text())
    except (OSError, ValueError):
        data = fetch()
        save(path, data)
        return data
    with _refreshing_lock:
        stale = age > max_age and key not in _refreshing
        if stale:
            _refreshing.add(key)
    if stale:

        def refresh():
            try:
                save(path, fetch())
            except Exception:
                pass  # Jolpica slow or down: the last answer stands, and the next request tries again
            finally:
                _refreshing.discard(key)
        threading.Thread(target=refresh, daemon=True).start()
    return data


@app.get("/api/driver/{driver_id}")
def driver(driver_id: str):
    """A driver's career: every race result and their final standing in each season (the Drivers tab)."""
    if not re.fullmatch(r"[a-z0-9_]+", driver_id):
        raise HTTPException(404, "Unknown driver")
    try:
        return raw_json(driver_career(driver_id))
    except Exception as e:
        raise HTTPException(502, f"Jolpica request failed: {e}")


def season_races(year: int) -> tuple:
    try:
        return races(year)
    except Exception as e:  # a Jolpica timeout isn't a server bug
        raise HTTPException(502, f"Jolpica request failed: {e}")


def race_info(year: int, round: int) -> dict:
    check_season(year, round)
    race = next((r for r in season_races(year) if r["round"] == str(round)), None)
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
    return {**t, "lat": float(c["Location"]["lat"])}  # circuits.js biome(): what grows round an unlisted circuit


@lru_cache(maxsize=64)
def _geo(lat: float, lng: float, year: int):
    return _geo_track(lat, lng, year)


@app.get("/api/geo/{year}/{round}")
def race_geo(year: int, round: int):
    """The circuit's real outline in local metres (x east, y north of its lat/long) from the GeoJSON set: satellite.js
    fits the F1-coordinate outline to it to place the satellite imagery."""
    c = race_info(year, round)["Circuit"]
    lat, lng = float(c["Location"]["lat"]), float(c["Location"]["long"])
    try:
        g = _geo(lat, lng, year)
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
        data = _elevation_at(c, max(year, date.today().year))
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
        for r in reversed(season_races(y)):
            if r["Circuit"]["circuitId"] == circuit_id and r["date"] <= today:
                return {"year": y, "round": int(r["round"]), "raceName": r["raceName"]}
    raise HTTPException(404, f"No race at {circuit_id} since 2018")


LIVE_NOW = "This session is live now: opening live timing."  # replay.js switches to the live view on this


def _is_live(race: dict, session: str) -> bool:
    """Whether F1's live feed is running this session now (OpenF1 keeps it locked until it ends)."""
    # The feed has to be open to know, and nothing else need have opened it when ▶ is the first thing clicked on a live
    # session: so it's opened, but only for a race weekend happening now.
    if abs((date.today() - date.fromisoformat(race["date"])).days) > 3:
        return False
    try:  # the schedule says first: opening the feed waits up to 5 s, on every "no data yet" 404 of a race weekend
        if scheduled_session(datetime.now(timezone.utc)) is None:
            return False
    except Exception:
        pass  # schedule unknown: ask the feed as before
    topics = live.snapshot()["topics"]
    info = topics.get("SessionInfo") or {}
    start = (info.get("StartDate") or "")[:10]
    return bool(start) and (topics.get("SessionStatus") or {}).get("Status") in live.RUNNING \
        and (info.get("Name") or "").lower() == session.lower() \
        and abs((date.fromisoformat(start) - date.fromisoformat(race["date"])).days) <= 3


@app.get("/api/replay/{year}/{round}")
def race_replay(request: Request, year: int, round: int, session: str = "Race", laps: bool = False,
                x_f1_token: str | None = Header(None)):
    """laps: the lap-timing replay even for a 2023+ race, which the page plays while the GPS one builds.
    X-F1-Token: builds the GPS replay from F1's archive, 2018 on (archive.py)."""
    race = race_info(year, round)
    try:
        if laps and session == "Race":
            return raw_json(laps_replay(year, round))
        stored = saved_replay(year, race["date"], session)
        if not stored:
            return raw_json(replay(year, race, session, f1auth.valid(x_f1_token)))
        if "gzip" not in request.headers.get("accept-encoding", ""):
            return Response(gzip.decompress(stored), media_type="application/json")
        return Response(stored, media_type="application/json", headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    except ReplayUnavailable as e:
        raise HTTPException(409, LIVE_NOW) if _is_live(race, session) else HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Replay data request failed: {e}")


NOT_BUILT = "NOT_BUILT"  # quali.js's sections ask before a build: ~30 OpenF1 requests


@app.get("/api/sessionlaps/{year}/{round}")
def session_laps(year: int, round: int, session: str = "Qualifying", build: bool = False):
    """A session's laps, stints, race control and drivers out of its GPS replay, without the 2 MB of positions: the
    Results tab's qualifying evolution and long runs. From the replay on disk; build=1 builds one that isn't there."""
    if year < 2023:
        raise HTTPException(404, f"No session timing for {year}: OpenF1's records start in 2023")
    race = race_info(year, round)
    try:
        data = saved_head(year, race["date"], session)
        if not data and not build:
            raise HTTPException(404, NOT_BUILT)
        data = data or replay(year, race, session)
    except ReplayUnavailable as e:
        raise HTTPException(409, LIVE_NOW) if _is_live(race, session) else HTTPException(404, str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Replay data request failed: {e}")
    return raw_json({k: data.get(k) for k in ("session", "drivers", "laps", "stints", "race_control")})


def _openf1_ledger(year: int, round: int, fetch):
    """A Results-tab table from OpenF1's race feeds, in plain words when it can't be had."""
    race = race_info(year, round)
    if year < 2023:  # no request: OpenF1 has nothing older
        raise HTTPException(404, "OpenF1's records start in 2023.")
    try:
        session = find_session(year, race["date"], "Race")
        if not session:
            raise ReplayUnavailable("OpenF1 has no race session for this event.")
        return raw_json(fetch(year, round, session))
    except OpenF1Locked:
        raise HTTPException(503, "OpenF1 locks its data while a session is live: this table comes back when the session ends.")
    except ReplayUnavailable as e:
        raise HTTPException(404, str(e))
    except Exception:  # requests' text carries the url and a Python repr
        raise HTTPException(502, "OpenF1 didn't answer. Try again in a minute.")


@app.get("/api/overtakes/{year}/{round}")
def race_overtakes(year: int, round: int):
    return _openf1_ledger(year, round, ledgers.overtakes)


@app.get("/api/stationary/{year}/{round}")
def race_stationary(year: int, round: int):
    return _openf1_ledger(year, round, ledgers.stationary)


@app.get("/api/stints/{year}/{round}")
def race_stints(year: int, round: int):
    return _openf1_ledger(year, round, ledgers.stints)


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


MAX_LICENCE = 65536  # a Widevine challenge is a few kB


@app.post("/api/f1tv/license")
async def f1tv_license(request: Request, u: str, x_f1_token: str | None = Header(None), x_f1_entitlement: str | None = Header(None)):
    """A live stream's Widevine licence (f1tv.license): the page's licence request, passed on with the account's tokens."""
    t = f1auth.valid(x_f1_token)
    if not t:
        raise HTTPException(401, "Connect your F1 TV account to play videos")
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_LICENCE:
        raise HTTPException(413, "Licence request too large")
    challenge = b""
    async for chunk in request.stream():  # a chunked body gives no length to check
        challenge += chunk
        if len(challenge) > MAX_LICENCE:
            raise HTTPException(413, "Licence request too large")
    try:
        status, body, kind = await run_in_threadpool(f1tv.license, u, challenge, t, x_f1_entitlement)
    except f1tv.F1TVError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"F1 TV licence request failed: {e}")
    return Response(body, status_code=status, media_type=kind)


@app.get("/api/events/{year}/{round}")
def event_marks(year: int, round: int, session: str = "Race"):
    """A session's important events for the F1 TV viewer's seek bars."""
    race = race_info(year, round)
    try:
        s = find_session(year, race["date"], session) if year >= 2023 else None
        if s is None:
            raise HTTPException(404, "Session events need a 2023 or later session (OpenF1 data).")
        return raw_json(session_events(s))
    except HTTPException:
        raise
    except OpenF1Locked:
        raise HTTPException(503, "OpenF1 locks its data while a session is live.")
    except Exception as e:
        raise HTTPException(502, f"Session events request failed: {e}")


@app.get("/api/f1tv/telemetry/{year}/{round}/{driver}")
def f1tv_telemetry(year: int, round: int, driver: Annotated[int, PathParam(ge=1, le=99)], session: str = "Race"):
    """One car's telemetry over a whole session, for the multiviewer's overlay on an F1 TV stream."""
    race = race_info(year, round)
    try:
        s = find_session(year, race["date"], session) if year >= 2023 else None
        if s is None:
            raise ReplayUnavailable("Car telemetry needs a 2023 or later session (OpenF1 data).")
        return raw_json(session_telemetry(s, driver))
    except ReplayUnavailable as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Telemetry request failed: {e}")


@app.get("/api/f1tv/radio/{year}/{round}")
def f1tv_radio(year: int, round: int, session: str = "Race", driver: Annotated[int | None, Query(ge=1, le=99)] = None, x_f1_token: str | None = Header(None)):
    """Team radio as text (radio.py) for the multiviewer's radio panel: every driver's clips so far (or one driver's),
    each with its words once transcribed, and the drivers' codes, team colours and headshots. The caller's F1 TV token
    fetches the audio, which F1 refuses without one."""
    if year < 2023:
        return {"clips": [], "drivers": {}, "pending": 0, "error": None}  # OpenF1 has team radio from 2023
    race = race_info(year, round)
    try:
        s = find_session(year, race["date"], session)
        return radio.radio(s, session, year, driver, f1auth.valid(x_f1_token))
    except Exception as e:
        raise HTTPException(502, f"Team radio request failed: {e}")


@app.post("/api/f1tv/radio/model", status_code=202)
def f1tv_radio_model(request: Request):
    """Starts the speech model's download (radio.fetch_model): the radio panel's button, after the reader agrees to 2.5 GB."""
    radio.fetch_model()
    return Response(status_code=202)


# registered before /api/f1tv/{year}/{round}, which would take /radio/audio for a year and refuse it
@app.get("/api/f1tv/radio/audio")
def f1tv_radio_audio(u: str, x_f1_token: str | None = Header(None)):
    """One team radio clip's audio (radio.audio), fetched from F1 with the caller's F1 TV token."""
    try:
        return Response(radio.audio(u, f1auth.valid(x_f1_token)), media_type="audio/mpeg",
                        headers={"Cache-Control": "private, max-age=86400"})
    except ValueError as e:
        raise HTTPException(400, str(e))
    except PermissionError as e:
        raise HTTPException(401, str(e))
    except Exception as e:
        raise HTTPException(502, f"Team radio clip unavailable: {e}")


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
    return raw_json(live.snapshot(f1auth.valid(x_f1_token)))  # the stream's fallback: polled every second


_tickets: dict = {}  # one-time ticket -> (F1 TV token, expiry), in memory only: EventSource can't send X-F1-Token


@app.post("/api/live/ticket")
def live_ticket(x_f1_token: str | None = Header(None)):
    """{ticket}: lets /api/live/stream use the caller's F1 TV token without it ever going in a URL. Single use, 30 s."""
    t = f1auth.valid(x_f1_token)
    now = time.time()
    for k in [k for k, (_, exp) in _tickets.items() if exp < now]:
        _tickets.pop(k, None)
    if not t:
        return {"ticket": None}
    ticket = secrets.token_urlsafe(16)
    _tickets[ticket] = (t, now + 30)
    return {"ticket": ticket}


async def live_events(token: str | None, wait: float = 0.5, keepalive: float = 15):
    """Server-sent events: one /api/live snapshot each time the feed changed (checked every `wait` s, so a burst of
    feed messages is one event), a comment after `keepalive` quiet seconds. Runs until the client goes."""
    last, quiet = None, time.monotonic()
    while True:
        snap = await run_in_threadpool(live.snapshot, token)  # also keeps F1's feed open while someone listens
        key = (snap["topics"], snap["connected"], snap["error"], snap["auth"], snap["auth_error"])
        if last is None or key[0] is not last[0] or key[1:] != last[1:]:  # topics: a new copy per feed message
            last, quiet = key, time.monotonic()
            yield f"data: {json.dumps(snap, separators=(',', ':'))}\n\n"
        elif time.monotonic() - quiet > keepalive:
            quiet = time.monotonic()
            yield ": keep-alive\n\n"
        await asyncio.sleep(wait)


@app.get("/api/live/stream")
def live_stream(ticket: str | None = None):
    """/api/live pushed as server-sent events; `ticket` (from /api/live/ticket) carries an F1 TV token."""
    token, exp = _tickets.pop(ticket, (None, 0)) if ticket else (None, 0)
    return StreamingResponse(live_events(token if exp > time.time() else None), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})


@app.get("/api/live/status")
def live_status():
    """{live, title}: is a session on, for a tab's periodic check. Unlike /api/live it never opens F1's feed or holds it
    open: the feed's word while it's running, else the schedule's, so no websocket stays up between weekends."""
    feed = live.status()
    if feed:
        return feed
    try:
        title = scheduled_session(datetime.now(timezone.utc))
    except OpenF1Locked:  # no saved season list yet, and OpenF1 only locks while a session is live
        title = "Live session"
    except Exception:
        title = None  # OpenF1 unreachable: no way to tell, so no LIVE button
    return {"live": bool(title), "title": title}


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
    return table(live.rows(topics[topic]))


@app.get("/api/telemetry/{year}/{round}")
def car_telemetry(year: int, round: int, driver: Annotated[int, Query(ge=1, le=99)], start: str, duration: float, session: str = "Race"):
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


def by_address(host: str | None) -> bool:
    """Whether a request's Host is localhost or an IP address. A page on a domain re-pointed at this computer (DNS
    rebinding) is same-origin with the server and passes every Origin check; it can't be reached by an address."""
    if host == "localhost" or (host or "").endswith(".localhost"):
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


# the import map is index.html's only inline script: its exact text is allowed by hash in the policy below
import base64, hashlib
IMPORTMAP_HASH = "'sha256-" + base64.b64encode(hashlib.sha256(re.search(r'<script type="importmap">(.*?)</script>', (Path(__file__).parent / "static" / "index.html").read_text(encoding="utf8"), re.S).group(1).encode("utf8")).digest()).decode() + "'"


@app.middleware("http")
async def revalidate_static(request, call_next):
    if not by_address(request.url.hostname):
        return Response("Open Lights Out by its address (http://127.0.0.1:8086), not a name.", status_code=400)
    # a POST starts downloads (600 MB, 2.5 GB) or writes: only the page's own origin, never another site or a bare client
    origin = request.headers.get("origin")
    if request.method == "POST" and (not origin or urlsplit(origin).netloc != request.headers.get("host")):
        return Response("Cross-origin request", status_code=403)
    # Without it browsers cache old modules heuristically and mix them with new ones after an edit, and one missing
    # export blanks the whole app. no-cache still serves 304s for unchanged files.
    response = await call_next(request)
    if request.url.path.startswith("/static/assets/") and response.status_code == 200:
        # hash-pinned (asset_hashes.json): a file there never changes under the same name
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    if request.url.path == "/" or request.url.path.endswith(".html"):
        # report-only while the page's inline scripts and handlers are moved out: violations show in the console
        response.headers["Content-Security-Policy-Report-Only"] = (
            f"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' {IMPORTMAP_HASH}; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https:; "
            "worker-src 'self' blob:; frame-ancestors 'none'")
    return response


# replay payloads are several MB of JSON; level 1 is ~4x faster than the default 9 for ~20 % more bytes
mimetypes.add_type("image/vnd.radiance", ".hdr")
# a 21 MB sky hardly compresses: gzipping it would only slow the local load
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=1, exclude_content_types=(*DEFAULT_EXCLUDED_CONTENT_TYPES, "image/vnd.radiance"))
if assets.ASSETS != Path(__file__).parent / "static" / "assets":  # the exe: assets live in paths.DATA
    app.mount("/static/assets", StaticFiles(directory=assets.ASSETS), name="assets")
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
# the trailer Stream plays offline (stream.js): docs/media in a checkout, media/ beside static/ in the exe
MEDIA = next((m for m in (Path(__file__).parent / "media", Path(__file__).parent.parent / "docs" / "media") if m.is_dir()), None)
if MEDIA:
    app.mount("/media", StaticFiles(directory=MEDIA), name="media")

# Anonymous usage counts (docs/ux-audit.md item 11): per day, how often each of these happened. The page sends only the
# event's name (util.js count): no id, cookie, IP or page address is kept, and nothing goes to a third party.
EVENTS = {"visit", "return_7d", "intro_shown", "intro_explore", "intro_simulate", "intro_stream", "first_play", "watched_60s",
          "new_race_watch", "highlights", "stream_open", "video_here", "video_f1tv", "connect_open", "f1tv_connected", "palette_open", "shortcuts_open",
          "why_open", "why_moment"}
COUNTS = CACHE.parent / "counts.json"  # shortcut: lives in .cache, so deleting the cache resets it; move it if it matters
_counts_lock = threading.Lock()  # one read-add-write at a time


def count_event(event: str, day: str, path: Path = COUNTS) -> dict:
    with _counts_lock:
        data = json.loads(path.read_text()) if path.exists() else {}
        per_day = data.setdefault(day, {})
        per_day[event] = per_day.get(event, 0) + 1
        save(path, data)
        return data


@app.post("/api/count/{event}", status_code=204)
def count(event: str, request: Request):
    if event not in EVENTS:  # a fixed list, so the file can't be filled with whatever a caller sends
        raise HTTPException(404, "Unknown event")
    count_event(event, date.today().isoformat())
    return Response(status_code=204)


@app.get("/api/assets")
def assets_status():
    """Whether the 3D resources are downloaded, and how a download is going (downloads.js)."""
    return assets.status()


@app.post("/api/assets/download", status_code=202)
def assets_download(request: Request):
    assets.start()
    return Response(status_code=202)


@app.get("/api/counts")
def counts():
    """The usage counts so far: {day: {event: n}}."""
    return json.loads(COUNTS.read_text()) if COUNTS.exists() else {}


def warm_up():
    """The page's first load, done at start-up on parallel threads so the first visit finds warm caches: the season list,
    this season's calendar and sessions, the latest race's track, ground, heights and results (each 0.5-2.5 s cold,
    ~10 ms warm; the page asked for them one after another), and the GPS replays of the season's last 3 races (~30
    OpenF1 requests, ~40 s each on the free tier; a click meanwhile waits on REPLAY_LOCKS instead of building it twice).
    All network-bound, so threads run them side by side despite the GIL."""
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
        if year >= 2023:  # newest first and one at a time: OpenF1 allows ~30 requests a minute, and each is ~30
            def replays():
                background.on = True  # replay.py _throttle: these leave the window's last slots to the reader's clicks
                for r in reversed(last[-3:]):
                    quietly(lambda: replay(year, r, "Race"))
            jobs.append(replays)

    def quietly(job):
        try:
            job()
        except Exception:
            pass  # e.g. OpenF1 locked while a session is live: that part loads on first use as before

    with ThreadPoolExecutor(len(jobs)) as pool:
        pool.map(quietly, jobs)


# no auth: other devices on the network reach the server only when asked for
LAN = os.environ.get("LIGHTSOUT_LAN") == "1"
HOST = "0.0.0.0" if LAN else "127.0.0.1"


def lan_ip() -> str | None:
    """This computer's address on the local network: the one a UDP socket would send from (connect sends nothing)."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))  # TEST-NET-1: never routed anywhere
            return s.getsockname()[0]
    except OSError:
        return None


if __name__ == "__main__":
    threading.Thread(target=warm_up, daemon=True).start()
    # 0.0.0.0 listens on every address but isn't one a browser can open (ERR_ADDRESS_INVALID): say which ones work
    ip = lan_ip() if LAN else None
    print("Lights Out: open http://127.0.0.1:8086" + (f"  (other devices on this network: http://{ip}:8086)" if ip else
          "  (LIGHTSOUT_LAN=1 opens it to other devices on this network)"), flush=True)
    uvicorn.run(app, host=HOST, port=8086, timeout_graceful_shutdown=2)  # an open live stream would hold Ctrl+C
