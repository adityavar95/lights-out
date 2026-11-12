"""Run: .venv/Scripts/python tests/test_server.py"""
import sys
import hashlib
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from jolpica import jolpica_rows

laps_page = {"Races": [{"round": "1", "Circuit": {"circuitId": "albert_park"}, "Laps": [
    {"number": "1", "Timings": [{"driverId": "norris", "time": "1:57.099"}, {"driverId": "piastri", "time": "2:00.807"}]},
    {"number": "2", "Timings": [{"driverId": "norris", "time": "1:50.000"}]},
]}]}
rows = jolpica_rows(laps_page, ["Races", "Laps", "Timings"])
assert rows == [
    {"number": "1", "driverId": "norris", "time": "1:57.099"},
    {"number": "1", "driverId": "piastri", "time": "2:00.807"},
    {"number": "2", "driverId": "norris", "time": "1:50.000"},
], rows

drivers = {"Drivers": [{"driverId": "norris"}, {"driverId": "piastri"}]}
assert jolpica_rows(drivers, ["Drivers"]) == drivers["Drivers"]
assert jolpica_rows({}, ["Races", "Results"]) == []

from datetime import datetime, timezone
from replay import _hold, _resample, lap_seconds, session_rows

session_data = session_rows(
    [{"round": "1", "date": "2026-03-08"}, {"round": "2", "date": "2026-03-15"}],
    [{"meeting_key": 1, "date_start": "2026-03-06T00:00:00Z", "date_end": "2026-03-08T23:59:00Z"}],
    [{"meeting_key": 1, "session_name": "Race", "date_start": "2026-03-08T10:00:00Z",
      "date_end": "2026-03-08T12:00:00Z"}],
)
assert session_data == [
    {"Round": "1", "Session Name": "Race", "StartDate": "2026-03-08T10:00:00Z",
     "EndDate": "2026-03-08T12:00:00Z"}
], session_data

assert round(lap_seconds("1:57.099"), 6) == 117.099
assert lap_seconds("59.5") == 59.5
assert lap_seconds("1:02:03.5") == 3723.5

start = datetime(2025, 1, 1, tzinfo=timezone.utc)
samples = [{"date": "2025-01-01T00:00:00+00:00", "x": 0, "y": 0},
           {"date": "2025-01-01T00:00:01+00:00", "x": 100, "y": -100},
           {"date": "2025-01-01T00:00:10+00:00", "x": 200, "y": 0}]  # 9 s gap: car had no data
frames = _resample(samples, start, 6)
assert frames["x"] == [0, 50, None, None, None, None], frames  # interpolates, then blanks the gap and the tail
assert frames["y"] == [0, -50, None, None, None, None], frames

car = [{"date": "2025-01-01T00:00:00.200000+00:00", "speed": 100, "n_gear": 3},
       {"date": "2025-01-01T00:00:01+00:00", "speed": 120, "n_gear": 4}]
held = _hold(car, start, 16, ("speed", "n_gear"))
assert held["speed"][:4] == [None, 100, 120, 120], held  # holds the last sample...
assert held["speed"][12:] == [120, None, None, None], held  # ...for at most 5 s
assert held["n_gear"][2] == 4

from live import merge, rows

state = {"Lines": {"1": {"Position": "2", "Sectors": [{"Segments": [{"Status": 0}, {"Status": 0}]}]}},
         "Messages": [{"Message": "GREEN LIGHT"}]}
merge(state, {"Lines": {"1": {"Position": "1", "Sectors": {"0": {"Segments": {"1": {"Status": 2049}}}}}, "44": {"Position": "2"}}})
merge(state, {"Messages": {"1": {"Message": "TRACK CLEAR"}}})
assert state["Lines"]["1"]["Position"] == "1"
assert state["Lines"]["1"]["Sectors"][0]["Segments"] == [{"Status": 0}, {"Status": 2049}]  # list item updated by index
assert state["Lines"]["44"] == {"Position": "2"}
assert merge([{"a": 1}], {"_kf": True, "0": {"a": 2}}) == [{"a": 2}]  # a marker key among the indices is skipped, not a crash
assert [m["Message"] for m in state["Messages"]] == ["GREEN LIGHT", "TRACK CLEAR"]  # new index appended
assert [r["Position"] for r in rows(state)] == ["1", "2"]
assert rows({"AirTemp": "29.3", "_kf": True}) == [{"AirTemp": "29.3", "_kf": True}]

import base64, json as _json, zlib
import live


def _z(obj) -> str:  # the feed's encoding of the .z topics: base64 raw deflate
    c = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    return base64.b64encode(c.compress(_json.dumps(obj).encode()) + c.flush()).decode()


sample = lambda sec: {"Timestamp": f"2026-10-25T20:00:{sec:02d}.000Z", "Entries": {"1": {"X": sec, "Y": 0}}}
live._state.clear()
live._put("Position.z", _z({"Position": [sample(0), sample(1)]}))
live._put("Position.z", _z({"Position": [sample(1), sample(9)]}))  # repeat dropped; > BUFFER s old trimmed
assert [e["Entries"]["1"]["X"] for e in live._state["Position"]["Position"]] == [9]
live._put("Position.z", _z({"Position": [sample(10)]}))
assert [e["Entries"]["1"]["X"] for e in live._state["Position"]["Position"]] == [9, 10]
live._state.clear()

from tracks import _clean_loop

# a square lap (decimetres) recorded with a duplicate point and running 3 points past its own start
x = [0, 0, 1000, 1000, 0, 5, 300, 600]
y = [0, 0, 0, 1000, 1000, 2, 0, 0]
cx, cy, idx = _clean_loop(x, y, [2, 4, 7])
assert (cx, cy) == ([0, 1000, 1000, 0], [0, 0, 1000, 1000]), (cx, cy)  # duplicate gone, overlap trimmed at the start
assert idx == [1, 3, 3], idx  # mini-sector indices follow their points; past the end clamps to the last
# the lap's last point 4 m past the start (over 3 m from it, so the trim above keeps it): dropped as well (Baku)
bx, by, _ = _clean_loop([0, 400, 1000, 1000, 0, 0, 40], [0, 0, 0, 1000, 1000, 100, 2], [])
assert (bx, by) == ([0, 400, 1000, 1000, 0, 0], [0, 0, 0, 1000, 1000, 100]), (bx, by)
# a zig-zag on the bottom straight (out 32, back 24, on again: Monaco's): the point it doubles back at goes, the rest stay
zx, zy, _ = _clean_loop([0, 300, 332, 308, 600, 1000, 1000, 0], [0, 0, 1, 2, 0, 0, 1000, 1000], [])
assert (zx, zy) == ([0, 300, 308, 600, 1000, 1000, 0], [0, 0, 2, 0, 0, 1000, 1000]), (zx, zy)

# circuits MultiViewer lacks: an OpenF1 lap becomes the outline, tidied the same way; MultiViewer still wins when it has one
import tracks
assert tracks.lap_track(x, y) == {"source": "openf1", "x": cx, "y": cy, "rotation": 0, "corners": []}
lap = {"x": x, "y": y}
assert tracks.track("madring", 2026, 40.46, -3.62, lambda: lap)["source"] == "openf1"
saved_mv = tracks.mv_track
tracks.mv_track = lambda key, year: {"source": "multiviewer", "x": [], "y": []}
assert tracks.track("spa", 2026, 50.44, 5.97, lambda: lap)["source"] == "multiviewer"
tracks.mv_track = saved_mv
print("ok")

# F1 TV token from the browser (Connect bookmarklet): only an unexpired JWT counts; nothing is stored server-side
import base64 as _b64, time as _time
import f1auth

def _jwt(**claims):
    enc = lambda d: _b64.urlsafe_b64encode(_json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{enc({'alg': 'none'})}.{enc(claims)}.sig"

good = _jwt(exp=_time.time() + 3600, SubscribedProduct="F1 TV Pro")
assert f1auth.valid(good) == good
assert f1auth.valid(_jwt(exp=_time.time() + 60)) is None  # about to expire
assert f1auth.valid("not a jwt") is None and f1auth.valid(None) is None
assert f1auth.claims(good)["SubscribedProduct"] == "F1 TV Pro"
print("ok")

# find_session matches the meeting by the race date, then the session by name, from the cached season list
import replay
_orig = replay._season_list
replay._season_list = lambda kind, year: {
    "meetings": [{"meeting_key": 7, "date_start": "2026-10-23T17:00:00", "date_end": "2026-10-25T21:00:00"}],
    "sessions": [{"meeting_key": 6, "session_name": "Race", "session_key": 1},
                 {"meeting_key": 7, "session_name": "Practice 3", "session_key": 2},
                 {"meeting_key": 7, "session_name": "Race", "session_key": 3}]}[kind]
assert replay.find_session(2026, "2026-10-25", "race")["session_key"] == 3
assert replay.find_session(2026, "2026-11-01", "Race") is None
replay._season_list = _orig
print("auth + sessions ok")

# finished races (and past seasons) go to Jolpica's disk cache; this season's list and recent races don't
from datetime import date, timedelta
import jolpica
_races = jolpica.races
jolpica.races = lambda year: ({"round": "1", "date": str(date.today() - timedelta(days=10))},
                              {"round": "2", "date": str(date.today() - timedelta(days=1))})
this = date.today().year
assert jolpica._settled(this - 1, None) and jolpica._settled(this, 1)
assert not jolpica._settled(this, None) and not jolpica._settled(this, 2) and not jolpica._settled(this, 9)
jolpica.races = _races
# Jolpica down: the calendar server.py last saved, held 5 minutes before Jolpica is tried again; none saved: the error
import tempfile
real_j = (jolpica.jolpica_fetch, jolpica.LAST, jolpica._pages, jolpica.jolpica_client, jolpica.SETTLED)
with tempfile.TemporaryDirectory() as d:
    jolpica.LAST = Path(d)
    asked = []
    def down(year, kind, round=None): asked.append(year); raise TimeoutError("read timed out")
    jolpica.jolpica_fetch = down
    try:
        jolpica.races(1901)
        raise AssertionError("no saved calendar, yet no error")
    except TimeoutError:
        pass
    (Path(d) / "1901_races_None.json").write_text('[{"round": "1"}, {"round": "2"}]')
    assert jolpica.races(1901) == ({"round": "1"}, {"round": "2"}) and jolpica.races(1901) and asked == [1901, 1901]  # the 3rd didn't ask
    jolpica._down[1901] = (0, ())
    jolpica.jolpica_fetch = lambda year, kind, round=None: asked.append(year) or [{"round": "9"}]
    assert jolpica.races(1901) == ({"round": "9"},) and len(asked) == 3
# a driver in last year's list is still active when this year's is empty (before round 1): not the year-long disk cache
class _Q:
    def __init__(self, name): self.name = name
    def query(self): return self
    def driver(self, d): return self
asked = []
jolpica.jolpica_fetch = lambda y, kind, round=None: [{"driverId": "max"}] if (y, kind) == (this - 1, "drivers") else []
jolpica._pages = lambda q, method, rows_of: asked.append(q.name) or []
jolpica.jolpica_client, jolpica.SETTLED = _Q("live"), _Q("settled")
jolpica.driver_career("max"), jolpica.driver_career("fangio")
assert asked == ["live", "settled"], asked
jolpica.jolpica_fetch, jolpica.LAST, jolpica._pages, jolpica.jolpica_client, jolpica.SETTLED = real_j
jolpica._races.cache_clear(), jolpica._down.clear()
print("jolpica cache ok")

import f1tv
f1tv.DISK = Path(tempfile.mkdtemp())  # past seasons' weekends are kept on disk: not in the real cache
# one search per past weekend, whatever the restarts (_cache cleared); names that share a stem get their own file
searched = []
_real_search, f1tv._search = f1tv._search, lambda **f: searched.append(f) or [
    {"metadata": {"contentId": len(searched), "title": f["filter_Meeting_Name"]}, "actions": [{"href": "/v"}]}]
first = f1tv.videos(1983, "United States Grand Prix")
f1tv._cache.clear()
assert f1tv.videos(1983, "United States Grand Prix") == first and len(searched) == 1
assert f1tv.videos(1983, "United States Grand Prix West")[0]["title"].endswith("West") and len(searched) == 2
f1tv._search = _real_search
f1tv._cache.clear()
assert f1tv._stem("Malaysian Grand Prix") == f1tv._stem("Malaysia Grand Prix")
assert f1tv._stem("São Paulo Grand Prix") == f1tv._stem("Sao Paulo Grand Prix")
assert f1tv._stem("Austrian Grand Prix") != f1tv._stem("Australian Grand Prix")
item = lambda cid, kind, meeting, start=0: {"metadata": {"contentId": cid, "title": f"t{cid}", "contentSubtype": kind, "entitlement": "Pro",
    "emfAttributes": {"Meeting_Name": meeting, "sessionStartDate": start, "sessionEndDate": start}}, "actions": [{"href": f"/detail/{cid}"}]}
calls = []
def fake_search(**f):  # F1 TV calls it "Malaysia": the exact-name search finds nothing, the season list has the name
    calls.append(f)
    if f.get("filter_Meeting_Name") == "Malaysia Grand Prix":
        return [item(2, "HIGHLIGHTS", "Malaysia Grand Prix"), item(1, "REPLAY", "Malaysia Grand Prix", 5)]
    return [] if "filter_Meeting_Name" in f else [item(9, "SHOW", "Malaysia Grand Prix"), item(8, "SHOW", "Chinese Grand Prix")]
_search, f1tv._search = f1tv._search, fake_search
v = f1tv.videos(2012, "Malaysian Grand Prix")
assert [x["id"] for x in v] == [1, 2] and v[0]["url"] == "https://f1tv.formula1.com/detail/1", v
assert calls[-1] == {"filter_season": 2012, "filter_Meeting_Name": "Malaysia Grand Prix"}, calls
f1tv._search = _search

# a 2024 race: INTERNATIONAL by channelId has no stream, 4K has no rights; both play as the content's own feed in HD
class Res:
    def __init__(self, ok, body): self.ok, self.status_code, self.headers, self.body = ok, 200 if ok else 403, {"content-type": "application/json"}, body
    def json(self): return self.body
    def raise_for_status(self): pass
def fake_get(url, params=None, headers=None, timeout=None):
    if "CONTENT/VIDEO" in url:
        return Res(True, {"resultObj": {"containers": [{"metadata": {"title": "2024 Bahrain Grand Prix", "additionalStreams": [
            {"channelId": 11, "title": "F1 LIVE"}, {"channelId": 12, "title": "INTERNATIONAL"}, {"channelId": 13, "title": "VER", "type": "obc"}]}}]}})
    if "x-f1-override-video-stream" in headers or params.get("channelId") == 12:
        return Res(False, {"message": "No Data Found"})
    return Res(True, {"resultObj": {"url": f"https://cdn/{params.get('channelId', 'main')}.m3u8", "streamType": "HLS"}})
_get, f1tv.requests.get = f1tv.requests.get, fake_get
s = f1tv.channels(7781)["streams"]
assert [x["channelId"] for x in s] == [11, None, 13], s
assert f1tv.play(7781, None, "tok", uhd=True)["url"] == "https://cdn/main.m3u8"
assert f1tv.play(7781, 13, "tok", uhd=True)["url"] == "https://cdn/13.m3u8"
f1tv.requests.get = _get
print("f1tv ok")

import tempfile
from server import EVENTS, count_event
import server
# CI has no network: the page's libraries are stubbed, and the 503 path is asserted on its own.
import assets as _assets
from fastapi.testclient import TestClient as _TC
def _no_network(): raise RuntimeError("no network")
_assets.core = _no_network
assert _TC(server.app, base_url="http://127.0.0.1:8086").get("/").status_code == 503
_assets.core = lambda: None

with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "counts.json"
    count_event("visit", "2026-10-30", path)
    count_event("visit", "2026-10-30", path)
    assert count_event("watched_60s", "2026-10-31", path) == {"2026-10-30": {"visit": 2}, "2026-10-31": {"watched_60s": 1}}
assert "visit" in EVENTS and "../etc" not in EVENTS
print("usage counts ok")

# /api/seasons: a fresh copy from disk; Jolpica down with a stale copy -> that copy; down with none -> every year since 1950
import os, tempfile, livef1, server
from datetime import date
with tempfile.TemporaryDirectory() as tmp:
    real, server.SEASONS = (livef1.list_seasons, server.SEASONS), Path(tmp) / "seasons.json"
    try:
        livef1.list_seasons = lambda: ["2025", "2026"]
        assert server.seasons() == ["2025", "2026"] and server.SEASONS.exists()
        def down(): raise TimeoutError("read timed out")
        livef1.list_seasons = down
        assert server.seasons() == ["2025", "2026"]  # still fresh
        os.utime(server.SEASONS, (0, 0))  # a day old: Jolpica is asked, fails, the old list stands
        assert server.seasons() == ["2025", "2026"]
        server.SEASONS.unlink()
        years = server.seasons()
        assert years[0] == "1950" and years[-1] == str(date.today().year), years
    finally:
        livef1.list_seasons, server.SEASONS = real
print("seasons fallback ok")

# this season's Jolpica answers: the first waits; later ones come from disk at once, a stale one refreshes in the background,
# and a failing refresh keeps the last answer
import threading as _t, time
with tempfile.TemporaryDirectory() as tmp:
    real_last, server.LAST = server.LAST, Path(tmp)
    try:
        calls = []
        assert server.last_or_fetch("k", lambda: calls.append(1) or [{"round": "1"}]) == [{"round": "1"}] and calls == [1]
        assert server.last_or_fetch("k", lambda: calls.append(2) or [{"round": "2"}]) == [{"round": "1"}] and calls == [1]  # fresh
        os.utime(server.LAST / "k.json", (0, 0))
        done = _t.Event()
        def slow():
            calls.append(3)
            done.set()
            return [{"round": "3"}]
        assert server.last_or_fetch("k", slow) == [{"round": "1"}]  # stale: the old answer now, the new one fetched behind it
        done.wait(5)
        for _ in range(50):
            if not server._refreshing: break
            time.sleep(0.02)
        assert server.last_or_fetch("k", lambda: [{"round": "x"}]) == [{"round": "3"}]
        os.utime(server.LAST / "k.json", (0, 0))
        def down(): raise TimeoutError("read timed out")
        assert server.last_or_fetch("k", down) == [{"round": "3"}]
        for _ in range(50):
            if not server._refreshing: break
            time.sleep(0.02)
        assert server.last_or_fetch("k", down) == [{"round": "3"}]  # still the last good answer
    finally:
        server.LAST = real_last
print("jolpica last answer ok")

# live licences go only to F1's own hosts (the url comes from the page)
import f1tv
for bad in ["https://evil.example/la", "http://f1tv.formula1.com/la", "https://formula1.com.evil.example/la", "file:///etc/passwd"]:
    try:
        f1tv.license(bad, b"x", "tok", None)
        raise AssertionError(f"forwarded to {bad}")
    except f1tv.F1TVError:
        pass
# and never follows a redirect, which would carry the subscription token to another host
sent, real_post = {}, f1tv.requests.post
f1tv.requests.post = lambda url, **kw: sent.update(kw) or type("R", (), {"status_code": 302, "content": b"", "headers": {}})()
assert f1tv.license("https://f1tv.formula1.com/la", b"x", "tok", None)[0] == 302 and sent["allow_redirects"] is False
f1tv.requests.post = real_post
print("f1tv licence hosts ok")

# play: an Akamai manifest (no CORS for localhost) is asked for again until formula1.com's CDN answers, within `tries`
class _R:
    def __init__(self, url): self.ok, self.status_code, self.headers, self._u = True, 200, {"content-type": "application/json"}, url
    def json(self): return {"resultObj": {"url": self._u, "streamType": "DASHWV", "laURL": "https://f1tv.formula1.com/la"}}
real_get, hosts = f1tv.requests.get, iter(["https://f1prodlive.akamaized.net/a.mpd", "https://f1prodlive.akamaized.net/b.mpd", "https://ott-video-cf.formula1.com/c.mpd"])
f1tv.requests.get = lambda *a, **k: _R(next(hosts))
try:
    assert f1tv.play(1, None, "tok")["url"] == "https://ott-video-cf.formula1.com/c.mpd"
    f1tv.requests.get = lambda *a, **k: _R("https://f1prodlive.akamaized.net/x.mpd")
    assert f1tv.play(1, None, "tok", tries=3)["url"].endswith("x.mpd")  # still Akamai after 3: that one, not an error
finally:
    f1tv.requests.get = real_get
print("f1tv cdn retry ok")

# live 4K: an HD Widevine answer to HDR_UHD_DASH is asked for again as HDR_UHD_DASHWV, kept only if F1 TV says UHD
class _K(_R):
    def __init__(self, kind): super().__init__("https://ott-video-cf.formula1.com/m.mpd"); self.kind = kind
    def json(self): return {"resultObj": {"url": self._u, "streamType": self.kind, "laURL": "https://f1tv.formula1.com/la"}}
seen = []
def fake(url, params=None, headers=None, timeout=None):
    seen.append(headers.get("x-f1-override-video-stream"))
    return _K("HDR_UHD_DASHWV" if seen[-1] == "HDR_UHD_DASHWV" else "SDR_HD_DASHWV")
f1tv.requests.get = fake
try:
    assert f1tv.play(1, None, "tok", uhd=True)["streamType"] == "HDR_UHD_DASHWV" and seen == ["HDR_UHD_DASH", "HDR_UHD_DASHWV"], seen
    seen.clear()
    f1tv.requests.get = lambda url, params=None, headers=None, timeout=None: seen.append(1) or _K("SDR_HD_DASHWV")
    assert f1tv.play(1, None, "tok", uhd=True)["streamType"] == "SDR_HD_DASHWV" and len(seen) == 2  # no live 4K: the HD one
    seen.clear()
    f1tv.requests.get = lambda url, params=None, headers=None, timeout=None: seen.append(1) or _K("DASH")
    assert f1tv.play(1, None, "tok", uhd=True)["streamType"] == "DASH" and len(seen) == 1  # replays: one request, as before
finally:
    f1tv.requests.get = real_get
print("f1tv live 4k ok")

# team radio: OpenF1's clips after a session, the live feed's while it's locked; each clip transcribed once, kept on disk
import radio, replay as _rp
# the 2.5 GB speech model is never fetched unasked: until its files are here nothing is queued, and the panel is told why
with tempfile.TemporaryDirectory() as tmp:
    real_m = (radio.MODEL_DIR, radio._download, radio.clips, radio.drivers, radio.TRANSCRIBE)
    radio.MODEL_DIR, radio.TRANSCRIBE = Path(tmp), True
    radio.clips, radio.drivers = lambda *a: [(1.0, "https://x/unasked.mp3", 1)], lambda *a: {}
    fetched = _t.Event()
    def fake_download(): fetched.wait(5); raise OSError("disk full")
    radio._download = fake_download
    r = radio.radio(None, "Race", 2024, None, None)
    assert r["model"] == "missing" and r["pending"] == 0 and radio._jobs.empty() and r["clips"][0]["text"] is None, r
    radio.fetch_model(); radio.fetch_model()  # the second finds one already running
    assert radio.model_state() == "downloading"
    fetched.set(); radio._fetch_state["thread"].join(5)
    assert radio.model_state() == "failed" and "disk full" in radio._fetch_state["error"]
    def good_download():
        for f in radio.MODEL_FILES: (Path(tmp) / f).write_bytes(b"x")
    radio._download = good_download
    radio.fetch_model(); radio._fetch_state["thread"].join(5)
    assert radio.model_state() == "ready" and radio._fetch_state["error"] is None
    radio.MODEL_DIR, radio._download, radio.clips, radio.drivers, radio.TRANSCRIBE = real_m
    radio._fetch_state.update(thread=None, error=None)
radio.model_state = lambda: "ready"  # for the rest of this file: the tests below stub the transcriber itself
with tempfile.TemporaryDirectory() as tmp:
    real = (radio.DIR, radio.openf1, radio.live.radio, radio.transcribe, radio.requests.get)
    radio.DIR = Path(tmp)
    try:
        radio.openf1 = lambda path: [{"date": "2026-10-25T20:05:00+00:00", "recording_url": "https://livetiming.formula1.com/static/a.mp3"}]
        assert radio.clips({"session_key": 1, "date_end": "2026-10-25T22:00:00+00:00"}, "Race", 2026, 44) == [(1792958700.0, "https://livetiming.formula1.com/static/a.mp3", 44)]
        def locked(path): raise _rp.OpenF1Locked("live")
        radio.openf1 = locked
        radio.live.radio = lambda: ({"Name": "Practice 1", "Path": "2026/x/y/"}, [
            {"Utc": "2026-10-30T12:40:00.1Z", "RacingNumber": "44", "Path": "TeamRadio/HAM.mp3"},
            {"Utc": "2026-10-30T12:41:00Z", "RacingNumber": "16", "Path": "TeamRadio/LEC.mp3"}])
        assert radio.clips({"session_key": 2, "date_end": "2026-10-25T22:00:00+00:00"}, "Practice 1", 2026, 44) == [(1793364000.1, "https://livetiming.formula1.com/static/2026/x/y/TeamRadio/HAM.mp3", 44)]
        assert radio.clips({"session_key": 2, "date_end": "2026-10-25T22:00:00+00:00"}, "Practice 2", 2026, 44) == []  # the feed is on another session
        # transcription off (as shipped): F1's clips with their audio urls, nothing queued, no words
        radio.TRANSCRIBE = False
        r = radio.radio({"session_key": 2, "date_end": "2026-10-25T22:00:00+00:00"}, "Practice 1", 2026, 44, "tok")
        assert r == {"clips": [{"t": 1793364000.1, "url": "https://livetiming.formula1.com/static/2026/x/y/TeamRadio/HAM.mp3", "driver": 44, "text": None, "error": None}],
                     "pending": 0, "error": None, "transcribe": False, "model": "ready"}, r
        assert not radio._queued
        for bad in ["https://evil.example/a.mp3", "https://livetiming.formula1.com/static/../x", "file:///etc/passwd",
                    "https://livetiming.formula1.com/static/%2e%2e/x.mp3", "https://livetiming.formula1.com/static/%252e%252e/x.mp3",
                    "https://livetiming.formula1.com/static/..%2fsecret.mp3", "https://livetiming.formula1.com/static/a\\..\\b.mp3",
                    "https://livetiming.formula1.com/other/a.mp3", "https://livetiming.formula1.com/static/a.json",
                    "https://livetiming.formula1.com@evil.example/static/a.mp3", "http://livetiming.formula1.com/static/a.mp3",
                    "https://livetiming.formula1.com/static/a.mp3?x=1", "https://livetiming.formula1.com/static/" + "a" * 3000 + ".mp3"]:
            try:
                radio.audio(bad, "tok")
                raise AssertionError(f"fetched {bad}")
            except ValueError:
                pass
        # transcription on: the worker fetches the audio with the caller's token and keeps the words; a refused clip says why
        radio.TRANSCRIBE = True
        radio.IDLE = 0.05  # the worker (started below) frees the model after this long without a clip
        sent = []
        class _A:
            def __init__(self, ok): self.ok, self.status_code, self.content = ok, 200 if ok else 401, b"mp3"
        radio.requests.get = lambda url, headers=None, timeout=None: sent.append(headers) or _A("HAM" in url)
        radio.transcribe = lambda audio: {"text": "Box this lap"}
        r = radio.radio({"session_key": 2, "date_end": "2026-10-25T22:00:00+00:00"}, "Practice 1", 2026, 44, "tok")
        assert r["clips"][0]["t"] == 1793364000.1 and r["pending"] in (0, 1)
        for _ in range(100):
            if not radio._queued: break
            time.sleep(0.02)
        assert radio.radio({"session_key": 2, "date_end": "2026-10-25T22:00:00+00:00"}, "Practice 1", 2026, 44, "tok")["clips"][0]["text"] == "Box this lap"
        assert sent[0] == {"Authorization": "Bearer tok"}
        r = radio.radio({"session_key": 2, "date_end": "2026-10-25T22:00:00+00:00"}, "Practice 1", 2026, 16, None)
        for _ in range(100):
            if not radio._queued: break
            time.sleep(0.02)
        r = radio.radio({"session_key": 2, "date_end": "2026-10-25T22:00:00+00:00"}, "Practice 1", 2026, 16, None)
        assert r["clips"][0]["text"] is None and "refused" in r["error"], r
        radio._model = "loaded"
        time.sleep(0.3)
        assert radio._model is None  # unloaded while idle
    finally:
        radio.DIR, radio.openf1, radio.live.radio, radio.transcribe, radio.requests.get = real
        radio.TRANSCRIBE = False
# a transcript is read from disk once, then kept: a poll of a race's several hundred clips opens no files
with tempfile.TemporaryDirectory() as tmp:
    real_dir, radio.DIR = radio.DIR, Path(tmp)
    assert radio.entry("https://x/kept.mp3") is None
    radio.save(radio._path("https://x/kept.mp3"), {"text": "box box"})
    assert radio.entry("https://x/kept.mp3") == {"text": "box box"}
    radio._path("https://x/kept.mp3").unlink()
    assert radio.entry("https://x/kept.mp3") == {"text": "box box"}
    radio.DIR = real_dir
# a message is timed from its recording start in the clip's name (circuit local time), not F1's publish time ~30 s later
from datetime import datetime as _dt, timezone as _tz
pub = _dt(2026, 10, 30, 18, 33, 37, tzinfo=_tz.utc).timestamp()
assert pub - radio.started(pub, "https://livetiming.formula1.com/static/2026/x/TeamRadio/HAD_6_20261030_123307.mp3") == 30
assert pub - radio.started(pub, "https://livetiming.formula1.com/static/2026/x/TeamRadio/HAD_6_20261031_003307.mp3") == 30  # UTC+6
assert radio.started(pub, "https://livetiming.formula1.com/static/x/HAM.mp3") == pub  # no time in the name
print("team radio ok")

# S-M1: a failed clip says so per clip, waits RETRY s, and a refusal for want of a token retries as soon as there is one
with tempfile.TemporaryDirectory() as tmp:
    real = (radio.DIR, radio.requests.get, radio.transcribe, radio.openf1, dict(radio._errors), radio.TRANSCRIBE)
    radio.DIR, radio.TRANSCRIBE = Path(tmp), True
    radio._errors.clear()
    U = "https://livetiming.formula1.com/static/2026/x/TeamRadio/A.mp3"
    queued = []
    real_jobs, radio._jobs = radio._jobs, type("Q", (), {"put": lambda self, job: queued.append(job)})()
    real_worker, radio._worker = radio._worker, object()  # queueing only: nothing fetches
    try:
        def queue_once(token):
            queued.clear()
            radio.queue_clips([U], token)
            radio._queued.clear()
            return len(queued)
        now = time.time()
        radio._errors[U] = (now, "refused", True)  # 401 with no token
        assert queue_once(None) == 0 and queue_once("tok") == 1 and U not in radio._errors
        radio._errors[U] = (now, "refused", False)  # 401 with a token: it stands, even with a token
        assert queue_once("tok") == 0 and radio._errors[U][1] == "refused"
        radio._errors[U] = (now - radio.RETRY - 1, "clip unavailable (500)", False)  # old enough: tried again
        assert queue_once(None) == 1
        radio._errors[U] = (now, "transcription failed: x", False)
        radio.openf1 = lambda path: [{"date": "2026-10-25T20:05:00+00:00", "recording_url": U}]
        r = radio.radio({"session_key": 90, "date_end": "2026-10-25T22:00:00+00:00"}, "Race", 2026, 1, None)
        assert r["clips"][0]["error"] == "transcription failed: x" == r["error"], r
    finally:
        radio._jobs, radio._worker = real_jobs, real_worker
        radio._queued.clear()
        radio.DIR, radio.requests.get, radio.transcribe, radio.openf1, errors, radio.TRANSCRIBE = real
        radio._errors.clear(); radio._errors.update(errors)

# S-H2: OpenF1's team radio rows are asked once per TTL, for good once finished; a running feed session never asks at all
real = (radio.openf1, radio.live.radio, radio.live.status)
try:
    asked = []
    row = {"date": "2026-10-25T20:05:00+00:00", "recording_url": "https://livetiming.formula1.com/static/b.mp3"}
    radio.openf1 = lambda path: asked.append(path) or [row]
    done, recent = {"session_key": 91, "date_end": "2026-10-25T22:00:00+00:00"}, {"session_key": 92, "date_end": "2999-01-01T00:00:00+00:00"}
    for s in (done, recent, done, recent):
        assert len(radio.clips(s, "Race", 2026, 1)) == 1
    assert len(asked) == 2, asked
    radio._rows[92, 1] = (time.time() - radio.ROWS_TTL - 1, [row])
    radio.clips(recent, "Race", 2026, 1)
    assert len(asked) == 3, asked  # 30 s on: asked again
    radio._rows[91, 1] = (None, [row])
    radio.clips(done, "Race", 2026, 1)
    assert len(asked) == 3, asked  # finished: for good
    # an empty answer for a finished session isn't kept for good
    radio.openf1 = lambda path: []
    radio.clips({**done, "session_key": 93}, "Race", 2026, 1)
    assert radio._rows[93, 1][0] is not None
    # locked: remembered for the TTL too, so polls don't each spend a request
    def locked(path):
        asked.append(path)
        raise _rp.OpenF1Locked("live")
    radio.openf1 = locked
    asked.clear()
    assert radio.clips({**recent, "session_key": 94}, "Race", 2026, 1) == [] == radio.clips({**recent, "session_key": 94}, "Race", 2026, 1)
    assert len(asked) == 1, asked
    # live on the feed: OpenF1 isn't asked
    asked.clear()
    radio.live.radio = lambda: ({"Name": "Race", "Path": "2026/x/"}, [{"Utc": "2026-10-30T12:40:00Z", "RacingNumber": "1", "Path": "TeamRadio/V.mp3"}])
    radio.live.status = lambda: {"live": True, "title": "x"}
    assert len(radio.clips({**recent, "session_key": 95}, "Race", 2026, 1)) == 1 and not asked
finally:
    radio.openf1, radio.live.radio, radio.live.status = real
print("team radio cache, retries ok")

# S-H1: threads saving one path at once all succeed (Windows refuses a replace while the target is open) and leave no temp file
import replay as rp
with tempfile.TemporaryDirectory() as tmp:
    target, errs = Path(tmp) / "x.json", []
    def writer(n):
        try:
            for _ in range(15):
                rp.save(target, [n] * 2000)
        except Exception as e:
            errs.append(e)
    def reader():
        for _ in range(60):
            try:
                _json.loads(target.read_text())
            except OSError:
                pass
    ts_ = [_t.Thread(target=writer, args=(n,)) for n in range(4)] + [_t.Thread(target=reader)]
    [t.start() for t in ts_]; [t.join() for t in ts_]
    assert not errs, errs
    assert [p.name for p in Path(tmp).iterdir()] == ["x.json"]
    assert len(_json.loads(target.read_text())) == 2000

# S-M2: never more than 3 a second or 30 in any 60 s, across threads; a 429 still retries
class _Clock:
    t = 1000.0
    def monotonic(self): return self.t
    def sleep(self, s): self.t += s
    def time(self): return self.t
real_time, real_sent = rp.time, list(rp._sent)
rp.time = clock = _Clock()
rp._sent.clear()
try:
    stamps = []
    for _ in range(95):
        rp._throttle()
        stamps.append(clock.t)
    assert all(b - a >= 1 / 3 - 1e-9 for a, b in zip(stamps, stamps[1:])), stamps[:5]
    assert all(b - a >= 60 - 1e-9 for a, b in zip(stamps, stamps[30:])), "more than 30 in 60 s"
    assert stamps[29] - stamps[0] < 11  # a burst still goes out fast
    class _Ans:
        def __init__(self, code): self.status_code = code
        def raise_for_status(self): pass
        def json(self): return [1]
    answers = iter([429, 429, 200])
    real_get, rp._http.get = rp._http.get, lambda url, timeout: _Ans(next(answers))
    try:
        assert rp.openf1("x") == [1]
    finally:
        rp._http.get = real_get
finally:
    rp.time = real_time
    rp._sent.clear(); rp._sent.extend(real_sent)

# S-M3 (an unfinished session's build is kept a few minutes) and S-M5 (an empty list keeps the good copy and isn't cached)
real = (rp.openf1, rp.CACHE, rp.LISTS)
with tempfile.TemporaryDirectory() as tmp:
    rp.CACHE, rp.LISTS = Path(tmp), Path(tmp) / "lists"
    try:
        asked = []
        def feeds(path):
            asked.append(path)
            if path.startswith("drivers"):
                return [{"driver_number": 1, "name_acronym": "VER", "full_name": "Max", "team_name": "RB"}]
            if path.startswith("laps"):
                return [{"date_start": "2026-10-25T20:00:00+00:00", "driver_number": 1, "lap_number": 1}]
            if path.startswith("location"):
                return [{"date": "2026-10-25T20:00:00+00:00", "x": 0, "y": 0}, {"date": "2026-10-25T20:00:04+00:00", "x": 9, "y": 9}]
            return []
        rp.openf1 = feeds
        s = {"session_key": 501, "session_type": "Qualifying", "session_name": "Qualifying",
             "date_start": "2026-10-25T20:00:00+00:00", "date_end": "2999-01-01T00:00:00+00:00"}
        first = rp.gps_replay(s)
        n = len(asked)
        assert rp.gps_replay(s) is first and len(asked) == n  # no rebuild
        assert not (rp.CACHE / "501.json").exists()
        rp._recent[501] = (time.time() - rp.RECENT_TTL - 1, first)
        rp.gps_replay(s)
        assert len(asked) == 2 * n  # stale: rebuilt
        rp._recent.clear()

        rp.openf1 = lambda path: [{"meeting_key": 1}]
        assert rp._season_list("meetings", 3001) == [{"meeting_key": 1}]
        rp._lists.clear()
        rp.openf1 = lambda path: []
        assert rp._season_list("meetings", 3001) == [{"meeting_key": 1}]  # the saved copy, not the empty answer
        assert _json.loads((rp.LISTS / "meetings_3001.json").read_text()) == [{"meeting_key": 1}]
        rp._lists.clear()
        assert rp._season_list("sessions", 3001) == []  # no copy: empty, and asked again next time
        rp.openf1 = lambda path: [{"session_key": 2}]
        assert rp._season_list("sessions", 3001) == [{"session_key": 2}]
        # this season's list is asked again after LISTS_TTL (a moved session); a refresh that fails keeps the list it had
        rp.openf1 = lambda path: [{"session_key": 3}]
        assert rp._season_list("sessions", 3001) == [{"session_key": 2}]  # still fresh
        rp._lists["sessions", 3001] = (time.time() - rp.LISTS_TTL - 1, [{"session_key": 2}])
        assert rp._season_list("sessions", 3001) == [{"session_key": 3}]
        rp._lists["sessions", 3001] = (time.time() - rp.LISTS_TTL - 1, [{"session_key": 3}])
        def locked(path): raise rp.OpenF1Locked("live")
        rp.openf1 = locked
        assert rp._season_list("sessions", 3001) == [{"session_key": 3}]
        rp._lists["sessions", 1999] = (0, [{"session_key": 1}])  # a past season: for the server's lifetime
        assert rp._season_list("sessions", 1999) == [{"session_key": 1}]
        # saved_replay: the file's own bytes once a session's replay is on disk, None before that and before 2023
        real_find, rp.find_session = rp.find_session, lambda y, d, n: {"session_key": 77}
        assert rp.saved_replay(2024, "2024-03-02", "Race") is None
        rp.save(rp.CACHE / "77.json", {"mode": "gps"})
        assert rp.saved_replay(2024, "2024-03-02", "Race") == b'{"mode": "gps"}' and rp.saved_replay(2022, "2022-03-20", "Race") is None
        rp.find_session = real_find
    finally:
        rp.openf1, rp.CACHE, rp.LISTS = real
        rp._lists.clear()

# S-M4: telemetry goes in the shared cache only on the replay's own time grid, or the F1 TV overlay's server-made one
with tempfile.TemporaryDirectory() as tmp:
    real = (rp.openf1, rp.CACHE)
    rp.CACHE = Path(tmp)
    try:
        rp.openf1 = lambda path: [{"date": "2026-10-25T20:00:00+00:00", "speed": 1, "rpm": 1, "n_gear": 1, "throttle": 1, "brake": 0, "drs": 0}]
        s = {"session_key": 7, "date_start": "2026-10-25T20:00:00+00:00", "date_end": "2026-10-25T22:00:00+00:00"}
        t0 = _dt(2026, 10, 25, 20, 0, tzinfo=_tz.utc)
        file = rp.CACHE / "7_car1.json"
        rp.telemetry(s, 1, t0, 10)
        assert not file.exists()  # no replay to compare with
        rp.save(rp.CACHE / "7.json", {"start": t0.isoformat(), "duration": 7200.0})
        rp.telemetry(s, 1, t0, 10)
        assert not file.exists()  # a client's shorter window
        rp.telemetry(s, 1, t0, 7200.0)
        assert file.exists()  # the replay's own
        rp.telemetry(s, 1, t0, 10, "_tv")
        assert (rp.CACHE / "7_car1_tv.json").exists()
    finally:
        rp.openf1, rp.CACHE = real

# S-M6: the feed stopping clears its state; S-M7: status reads it without opening or holding the feed
assert live.status() is None
before = live._status["last_request"]
live._state["SessionStatus"] = {"Status": "Started"}
live._state["SessionInfo"] = {"Name": "Race", "Meeting": {"Name": "US GP"}}
assert live.status() == {"live": True, "title": "US GP · Race"} and live._status["last_request"] == before
live._state["SessionStatus"] = {"Status": "Aborted"}
assert live.status()["live"]
live._state["SessionStatus"] = {"Status": "Finalised"}
assert not live.status()["live"]
assert live._thread is None  # nothing opened the connection
live._status.update(last_request=0.0, error="old", connected=True)
live._run()  # idle: stops straight away
assert not live._state and live._status["error"] is None and not live._status["connected"]

# S-L6: after F1 rejects a token, no other is taken up for a while, so forged ones can't force reconnects
real = live._thread
live._thread = type("Alive", (), {"is_alive": lambda self: True})()
live._state["x"] = 1
try:
    live._status.update(token=None, rejected="bad", rejected_at=time.time())
    live.snapshot("bad"); live.snapshot("forged")
    assert live._status["token"] is None
    live._status["rejected_at"] = time.time() - live.REJECT_WAIT - 1
    live.snapshot("bad")
    assert live._status["token"] is None
    live.snapshot("good")
    assert live._status["token"] == "good"
finally:
    live._thread = real
    live._state.clear()
    live._status.update(token=None, rejected=None, rejected_at=0.0)

# S-L9: the season fallback search runs once however many weekends F1 TV names differently
f1tv._cache.clear()
calls = []
_search, f1tv._search = f1tv._search, fake_search
assert f1tv.videos(2012, "Malaysian Grand Prix") and f1tv.videos(2012, "Brazilian Grand Prix") == []
assert sum("filter_Meeting_Name" not in c for c in calls) == 1, calls
f1tv._search = _search
f1tv._cache.clear()

# S-L10: MultiViewer down: the fallbacks answer
def down(key, year): raise tracks.requests.ConnectionError("down")
tracks.mv_track = down
assert tracks.track("spa", 2026, 50.44, 5.97, lambda: lap)["source"] == "openf1"
tracks.mv_track = saved_mv
# an outline fetched once is on disk: after a restart (the lru caches empty) with no connection it still answers
with tempfile.TemporaryDirectory() as tmp:
    real_tracks = (tracks.DISK, tracks._get)
    tracks.DISK = Path(tmp)
    square = {"x": [0, 1000, 1000, 0], "y": [0, 0, 1000, 1000], "rotation": 90}
    tracks._get = lambda url, **kw: square if url.endswith("/7/2024") else {"7": {"years": [2024]}}
    tracks._mv_years.cache_clear(), tracks._mv_track.cache_clear()
    online = tracks.mv_track(7, 2026)
    tracks._mv_years.cache_clear(), tracks._mv_track.cache_clear()
    def offline(url, **kw): raise tracks.requests.ConnectionError("offline")
    tracks._get = offline
    assert tracks.mv_track(7, 2026) == online and online["rotation"] == 90
    tracks._mv_years.cache_clear(), tracks._mv_track.cache_clear()
    try:
        tracks._kept("never", "https://x/")
        raise AssertionError("no saved copy, yet no error")
    except tracks.requests.ConnectionError:
        pass
    tracks.DISK, tracks._get = real_tracks

# the routes, through the app (no upstream call: races and the feed are stubbed)
from fastapi.testclient import TestClient
import asyncio
from fastapi import HTTPException
client = TestClient(server.app, base_url="http://127.0.0.1:8086")  # by address: a name is refused (below)
this = date.today().year
real = (server.races, server.scheduled_session, server._elevation_at, server.live.snapshot, server.replay)
server.races = lambda year: ({"round": "1", "date": f"{year}-03-08", "raceName": "X", "Circuit": {"circuitId": "spa"}},)
try:
    # S-L2: out of range never reaches Jolpica
    def nope(*a): raise AssertionError("asked Jolpica")
    server.races = nope
    for url in ["/api/jolpica/1949/races", f"/api/jolpica/{this + 2}/races", "/api/jolpica/2020/results?round=31", "/api/season/99999",
                "/api/season/1800/f1schedule", "/api/track/1800/1", "/api/elevation/2020/0", "/api/replay/2020/31"]:
        assert client.get(url).status_code == 404, url
    # S-L1: Jolpica down is a 502, an unknown round a 404, also where a broad except used to turn it into a 502
    def timeout(year): raise TimeoutError("read timed out")
    server.races = timeout
    assert client.get("/api/track/2020/1").status_code == 502
    assert client.get("/api/f1tv/radio/2024/1?driver=1").status_code == 502
    assert client.get("/api/circuit/spa").status_code == 502
    server.races = lambda year: ({"round": "1", "date": f"{year}-03-08", "raceName": "X", "Circuit": {"circuitId": "spa"}},)
    assert client.get("/api/track/2020/2").status_code == 404
    assert client.get("/api/f1tv/radio/2024/2?driver=1").status_code == 404
    # L-M15: elevation looks at newer years whatever the race's, like the track and pit lane routes
    newest = []
    server._elevation_at = lambda c, y: newest.append(y) or {"x": []}
    assert client.get("/api/elevation/2010/1").status_code == 200 and newest == [this]
    # only the page's own origin may start the resources download
    started = []
    server.assets.start = lambda: started.append(1)
    assert client.post("/api/assets/download", headers={"Origin": "https://evil.example"}).status_code == 403 and not started
    assert client.post("/api/assets/download", headers={"Origin": "http://127.0.0.1:8086"}).status_code == 202 and started
    # S-L3: only the page's own origin may count
    assert client.post("/api/count/visit", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/count/nope", headers={"Origin": "http://127.0.0.1:8086"}).status_code == 404  # past the origin check
    assert client.post("/api/count/nope").status_code == 404  # no Origin: not a page's cross-site request
    # a domain pointed at this computer (DNS rebinding) is same-origin with it, so only an address or localhost is served
    started.clear()
    rebound = {"Host": "evil.example:8086", "Origin": "http://evil.example:8086"}
    assert client.get("/api/counts", headers=rebound).status_code == 400
    assert client.post("/api/assets/download", headers=rebound).status_code == 400 and not started
    for host in ["192.168.1.5:8086", "localhost:8086", "app.localhost", "[::1]:8086"]:
        assert client.post("/api/count/nope", headers={"Host": host}).status_code == 404, host
    # a season of lap times is ~240 Jolpica requests: a round is required
    real_fetch, server.jolpica_fetch = server.jolpica_fetch, lambda *a: [{"lap": "1"}]
    assert client.get("/api/jolpica/2020/laps").status_code == 400 and client.get("/api/jolpica/2020/pitstops").status_code == 400
    assert client.get("/api/jolpica/2020/laps?round=1").json()["total"] == 1
    server.jolpica_fetch = real_fetch
    # the speech model's download starts only from the page's own origin
    asked_model, real_fetch_model = [], server.radio.fetch_model
    server.radio.fetch_model = lambda: asked_model.append(1)
    assert client.post("/api/f1tv/radio/model", headers={"Origin": "https://evil.example"}).status_code == 403 and not asked_model
    assert client.post("/api/f1tv/radio/model", headers={"Origin": "http://127.0.0.1:8086"}).status_code == 202 and asked_model
    server.radio.fetch_model = real_fetch_model
    # S-L4: an oversized licence body is refused unread, a chunked one as soon as it's over
    token = _jwt(exp=_time.time() + 3600)
    assert client.post("/api/f1tv/license?u=https://x/", content=b"x" * 70000, headers={"X-F1-Token": token}).status_code == 413
    pulled = []
    class _Req:
        def __init__(self, length): self.headers = {"content-length": length} if length else {}
        async def stream(self):
            for i in range(50):
                pulled.append(i)
                yield b"x" * 30000
    def refused(req):
        try:
            asyncio.run(server.f1tv_license(req, "https://x/", token, None))
        except HTTPException as e:
            return e.status_code
    assert refused(_Req("70000")) == 413 and not pulled
    assert refused(_Req(None)) == 413 and len(pulled) == 3
    # S-L5
    assert client.get("/").headers["cache-control"] == "no-cache"
    # S-M7: the route answers from the feed when it's up, else the schedule, and never opens the feed
    server.live.snapshot = nope
    server.scheduled_session = lambda now: "US GP · Race"
    assert client.get("/api/live/status").json() == {"live": True, "title": "US GP · Race"}
    server.scheduled_session = lambda now: None
    assert client.get("/api/live/status").json() == {"live": False, "title": None}
    def locked_now(now): raise server.OpenF1Locked("live")
    server.scheduled_session = locked_now
    assert client.get("/api/live/status").json()["live"]
    def unreachable(now): raise OSError("down")
    server.scheduled_session = unreachable
    assert client.get("/api/live/status").json()["live"] is False
    live._state["SessionStatus"] = {"Status": "Finished"}
    live._state["SessionInfo"] = {"Name": "Race", "Meeting": {"Name": "US GP"}}
    assert client.get("/api/live/status").json() == {"live": False, "title": "US GP · Race"}
    live._state.clear()
    # S-M8: a race weekend's session counts only while it's running; any other race doesn't even open the feed
    today = date.today().isoformat()
    topics = lambda status: {"topics": {"SessionInfo": {"Name": "Race", "StartDate": today + "T14:00:00"}, "SessionStatus": {"Status": status}}}
    server.live.snapshot = lambda: topics("Started")
    assert server._is_live({"date": today}, "race") and not server._is_live({"date": today}, "Qualifying")
    server.live.snapshot = lambda: topics("Aborted")
    assert server._is_live({"date": today}, "Race")
    server.live.snapshot = lambda: topics("Finished")
    assert not server._is_live({"date": today}, "Race")
    server.live.snapshot = nope
    assert not server._is_live({"date": "2020-03-08"}, "Race")
    # the documented flow: OpenF1 locked with the session running -> 409 LIVE_NOW
    def refuse(*a): raise server.ReplayUnavailable("locked")
    server.replay = refuse
    # a replay on disk goes out as stored (no parse, no re-encoding); the lap replay never takes that path
    real_saved, server.saved_replay = server.saved_replay, lambda y, d, s: b'{"mode": "gps"}'
    real_laps, server.laps_replay = server.laps_replay, lambda y, r: {"mode": "laps"}
    assert client.get("/api/replay/2024/1").json() == {"mode": "gps"}
    assert client.get("/api/replay/2024/1?laps=1").json() == {"mode": "laps"}
    # the session's laps out of that file, without its positions; never a build unless asked
    server.saved_replay = lambda y, d, s: b'{"session": "Qualifying", "laps": [[1, "4", 1, 80.0]], "frames": [1, 2], "drivers": []}'
    r = client.get("/api/sessionlaps/2024/1").json()
    assert r == {"session": "Qualifying", "drivers": [], "laps": [[1, "4", 1, 80.0]], "stints": None, "race_control": None}, r
    assert client.get("/api/sessionlaps/2022/1").status_code == 404
    server.saved_replay = lambda y, d, s: None
    r = client.get("/api/sessionlaps/2024/1")
    assert r.status_code == 404 and r.json()["detail"] == server.NOT_BUILT, r.text
    r = client.get("/api/sessionlaps/2024/1?build=1")  # asked: replay() is tried, and its refusal comes back as it is
    assert r.status_code == 404 and r.json()["detail"] == "locked", r.text
    server.saved_replay, server.laps_replay = lambda y, d, s: None, real_laps  # not built: on to replay()
    server.races = lambda year: ({"round": "1", "date": today, "raceName": "X", "Circuit": {"circuitId": "spa"}},)
    server.live.snapshot = lambda: topics("Started")
    r = client.get(f"/api/replay/{this}/1")
    assert r.status_code == 409 and r.json()["detail"] == server.LIVE_NOW, r.text
    server.live.snapshot = lambda: topics("Finished")
    assert client.get(f"/api/replay/{this}/1").status_code == 404
finally:
    server.races, server.scheduled_session, server._elevation_at, server.live.snapshot, server.replay = real
    server.saved_replay = real_saved
    live._state.clear()

# scheduled_session: inside its times + 30 min
real = (rp._season_list,)
rp._season_list = lambda kind, year: {
    "meetings": [{"meeting_key": 7, "meeting_name": "US GP"}],
    "sessions": [{"meeting_key": 7, "session_name": "Race", "date_start": "2026-10-25T20:00:00+00:00", "date_end": "2026-10-25T22:00:00+00:00"}]}[kind]
at = lambda h, m=0: _dt(2026, 10, 25, h, m, tzinfo=_tz.utc)
assert rp.scheduled_session(at(19, 59)) is None and rp.scheduled_session(at(22, 31)) is None
assert rp.scheduled_session(at(20)) == "US GP · Race" == rp.scheduled_session(at(22, 29))
rp._season_list, = real
print("backend hardening ok")

# the ledger routes: stubbed feeds, no network
import ledgers
from replay import OpenF1Locked as _Locked
_session = {"session_key": 7, "date_start": "2024-01-01T14:00:00+00:00", "date_end": "2024-01-01T16:00:00+00:00"}
_feeds = {
    "overtakes": [{"date": "2024-01-01T14:05:00+00:00", "overtaking_driver_number": 1, "overtaken_driver_number": 2, "position": 3},
                  {"date": "2024-01-01T14:03:30+00:00", "overtaking_driver_number": 2, "overtaken_driver_number": 1, "position": 3}],
    "pit": [{"date": "2024-01-01T13:00:00+00:00", "driver_number": 1, "lap_number": 1, "stop_duration": None, "pit_duration": None},
            {"date": "2024-01-01T14:30:00+00:00", "driver_number": 1, "lap_number": 20, "stop_duration": 2.4, "pit_duration": 22.1}],
    "race_control": [{"date": "2023-12-31T14:00:00+00:00", "category": "SessionStatus", "flag": None, "message": "SESSION STARTED"},
                     {"date": "2024-01-01T14:03:00+00:00", "category": "SessionStatus", "flag": None, "message": "SESSION STARTED"}],
}
with tempfile.TemporaryDirectory() as tmp:
    asked, tmp = [], Path(tmp)
    def fake_openf1(path):
        asked.append(path)
        return _feeds[path.split("?")[0]]
    real_led = (ledgers.openf1, ledgers.LEDGERS, ledgers.CACHE, ledgers.laps_replay, server.find_session, server.races)
    ledgers.openf1, ledgers.LEDGERS, ledgers.CACHE = fake_openf1, tmp / "ledgers", tmp / "replay"
    ledgers.laps_replay = lambda y, r: {"drivers": [{"id": "a", "num": "1"}, {"id": "b", "num": "2"}], "cum": {"a": [90.0, 180.0], "b": [91.0]}}
    server.find_session = lambda y, d, s: _session
    server.races = lambda year: ({"round": "1", "date": f"{year}-03-08", "raceName": "X", "Circuit": {"circuitId": "spa"}},)
    try:
        # input bounds: nothing asked of OpenF1
        def no_session(*a): raise AssertionError("asked OpenF1")
        server.find_session = no_session
        for route in ["overtakes", "stationary"]:
            assert client.get(f"/api/{route}/2022/1").status_code == 404
            assert "2023" in client.get(f"/api/{route}/2022/1").json()["detail"]
            assert client.get(f"/api/{route}/1800/1").status_code == 404
            assert client.get(f"/api/{route}/2024/31").status_code == 404
            assert client.get(f"/api/{route}/2024/x").status_code == 422
        assert not asked
        server.find_session = lambda y, d, s: _session

        r = client.get("/api/overtakes/2024/1")
        assert r.status_code == 200, r.text
        d = r.json()
        assert [o[1:] for o in d["overtakes"]] == [["2", "1", 3], ["1", "2", 3]]  # sorted by time, numbers as strings
        go = d["race_control"][1][0]
        assert d["overtakes"][0][0] - go == 30
        assert sorted(l[1:] for l in d["laps"]) == [["1", 1], ["1", 2], ["2", 1]]  # lap 1 from lights out, today's SESSION STARTED
        assert [l[0] - go for l in d["laps"] if l[1:] == ["1", 2]] == [90]
        assert sorted(asked) == sorted(f"{k}?session_key=7" for k in _feeds)  # 3 requests, then all from disk
        assert client.get("/api/overtakes/2024/1").status_code == 200 and client.get("/api/stationary/2024/1").status_code == 200
        assert len(asked) == 3

        assert client.get("/api/stationary/2024/1").json() == [["1", 1, None, None], ["1", 20, 2.4, 22.1]]
        # the pace table's compounds: one request, the replay's own row shape
        _feeds["stints"] = [{"driver_number": 1, "lap_start": 1, "lap_end": 20, "compound": "MEDIUM", "tyre_age_at_start": 0}]
        assert client.get("/api/stints/2024/1").json() == [["1", 1, 20, "MEDIUM", 0]] and client.get("/api/stints/2022/1").status_code == 404
        del _feeds["stints"]

        # a built GPS replay supplies pits, laps and race control: only the overtakes are asked for
        asked.clear()
        (tmp / "ledgers" / "7_overtakes.json").unlink()
        (tmp / "replay").mkdir()
        (tmp / "replay" / "7.json").write_text(json.dumps({"start": "2024-01-01T14:00:00+00:00", "laps": [[180.0, "1", 1, 90.0, 1, 2, 3]],
                                                           "pits": [[1800.0, "1", 20, 22.1]], "race_control": [[0, "Flag", "GREEN", "x"]]}))
        d = client.get("/api/overtakes/2024/1").json()
        assert asked == ["overtakes?session_key=7"] and d["laps"] == [[180.0, "1", 1]] and d["pits"] == [[1800.0, "1", 20]] and d["overtakes"][0][0] == 210.0

        # plain words, never a Python repr
        (tmp / "ledgers" / "7_overtakes.json").unlink()
        real_feed = _feeds["overtakes"]
        _feeds["overtakes"] = []
        r = client.get("/api/overtakes/2024/1")
        assert r.status_code == 404 and "no overtake rows" in r.json()["detail"]
        _feeds["overtakes"] = real_feed
        def locked(path): raise _Locked("locked")
        ledgers.openf1 = locked
        r = client.get("/api/overtakes/2024/1")
        assert r.status_code == 503 and "live" in r.json()["detail"]
        def broken(path): raise ValueError("secret url")
        ledgers.openf1 = broken
        r = client.get("/api/overtakes/2024/1")
        assert r.status_code == 502 and "secret" not in r.text
        server.find_session = lambda y, d, s: None
        assert client.get("/api/stationary/2024/1").status_code == 404
    finally:
        ledgers.openf1, ledgers.LEDGERS, ledgers.CACHE, ledgers.laps_replay, server.find_session, server.races = real_led
print("ledger routes ok")

from urllib.parse import quote
from desktop import came_up, token_of
import desktop as _desktop

# S-L11: the launcher stops waiting once the server's thread has died
real_serving, _desktop.serving = _desktop.serving, lambda: False
dead = _t.Thread(target=lambda: None); dead.start(); dead.join()
assert came_up(dead) is False
_desktop.serving = lambda: True
assert came_up(dead) is True
_desktop.serving = real_serving

assert token_of(quote(json.dumps({"data": {"subscriptionToken": "abc"}}))) == "abc"
assert token_of(quote(json.dumps({"data": {}}))) is None  # signed in, no subscription
assert token_of("") is None and token_of("%7Bbroken") is None

# the asset scrape finds the sky presets, photo sets and tiles in the real static files
heavy = _assets._heavy()
assert any("/HDRIs/" in u for u in heavy) and any("/Textures/" in u for u in heavy)
assert any("tiles" in d.parts for d in heavy.values())
print("asset scrape ok")

# MultiViewer raising: the lap stand-in answers, and with no lap the GeoJSON outline does
_saved_mv, _saved_geo = tracks.mv_track, tracks._geo_track
def _mv_down(*a, **k): raise tracks.requests.RequestException("down")
tracks.mv_track = _mv_down
assert tracks.track("spa", 2026, 50.44, 5.97, lambda: lap)["source"] == "openf1"
tracks._geo_track = lambda lat, lng: {"source": "geojson", "x": [], "y": []}
assert tracks.track("spa", 2026, 50.44, 5.97)["source"] == "geojson"
tracks.mv_track, tracks._geo_track = _saved_mv, _saved_geo
print("track fallbacks ok")

# a three.js download is kept only when it hashes to its recorded sha256; a mismatch leaves nothing behind
class _Resp:
    def __init__(self, body): self.body = body
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def raise_for_status(self): pass
    def iter_content(self, n): yield self.body
real_get = _assets.requests.get
_assets.requests.get = lambda url, **kw: _Resp(b"console.log(1)")
with tempfile.TemporaryDirectory() as tmp:
    dest = Path(tmp) / "f.js"
    _assets.fetch("https://x/f.js", dest, hashlib.sha256(b"console.log(1)").hexdigest())
    assert dest.read_bytes() == b"console.log(1)"
    dest.unlink()
    try:
        _assets.fetch("https://x/f.js", dest, "0" * 64)
        raise AssertionError("a mismatched download was kept")
    except RuntimeError:
        pass
    assert not dest.exists() and not list(Path(tmp).iterdir())
_assets.requests.get = real_get
print("three hashes ok")

# the page's policy is sent report-only, and allows the import map by its hash
_csp = client.get("/").headers["content-security-policy-report-only"]
assert "script-src 'self' 'wasm-unsafe-eval' 'sha256-" in _csp and "frame-ancestors 'none'" in _csp
print("csp header ok")
