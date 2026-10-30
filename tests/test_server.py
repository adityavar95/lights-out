"""Run: .venv/Scripts/python tests/test_server.py"""
import sys
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
replay._meetings.cache_clear(); replay._sessions.cache_clear()
_orig = replay._season_list
replay._season_list = lambda kind, year: {
    "meetings": [{"meeting_key": 7, "date_start": "2026-10-23T17:00:00", "date_end": "2026-10-25T21:00:00"}],
    "sessions": [{"meeting_key": 6, "session_name": "Race", "session_key": 1},
                 {"meeting_key": 7, "session_name": "Practice 3", "session_key": 2},
                 {"meeting_key": 7, "session_name": "Race", "session_key": 3}]}[kind]
assert replay.find_session(2026, "2026-10-25", "race")["session_key"] == 3
assert replay.find_session(2026, "2026-11-01", "Race") is None
replay._season_list = _orig
replay._meetings.cache_clear(); replay._sessions.cache_clear()
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
print("jolpica cache ok")

import f1tv
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
with tempfile.TemporaryDirectory() as tmp:
    real = (radio.DIR, radio.openf1, radio.live.radio, radio.transcribe, radio.requests.get)
    radio.DIR = Path(tmp)
    try:
        radio.openf1 = lambda path: [{"date": "2026-10-25T20:05:00+00:00", "recording_url": "https://livetiming.formula1.com/static/a.mp3"}]
        assert radio.clips({"session_key": 1}, "Race", 2026, 44) == [(1792958700.0, "https://livetiming.formula1.com/static/a.mp3")]
        def locked(path): raise _rp.OpenF1Locked("live")
        radio.openf1 = locked
        radio.live.radio = lambda: ({"Name": "Practice 1", "Path": "2026/x/y/"}, [
            {"Utc": "2026-10-30T12:40:00.1Z", "RacingNumber": "44", "Path": "TeamRadio/HAM.mp3"},
            {"Utc": "2026-10-30T12:41:00Z", "RacingNumber": "16", "Path": "TeamRadio/LEC.mp3"}])
        assert radio.clips({"session_key": 2}, "Practice 1", 2026, 44) == [(1793364000.1, "https://livetiming.formula1.com/static/2026/x/y/TeamRadio/HAM.mp3")]
        assert radio.clips({"session_key": 2}, "Practice 2", 2026, 44) == []  # the feed is on another session
        # transcription off (as shipped): F1's clips with their audio urls, nothing queued, no words
        radio.TRANSCRIBE = False
        r = radio.radio({"session_key": 2}, "Practice 1", 2026, 44, "tok")
        assert r == {"clips": [{"t": 1793364000.1, "url": "https://livetiming.formula1.com/static/2026/x/y/TeamRadio/HAM.mp3", "text": None}],
                     "pending": 0, "error": None, "transcribe": False}, r
        assert not radio._queued
        for bad in ["https://evil.example/a.mp3", "https://livetiming.formula1.com/static/../x", "file:///etc/passwd"]:
            try:
                radio.audio(bad, "tok")
                raise AssertionError(f"fetched {bad}")
            except ValueError:
                pass
        # transcription on: the worker fetches the audio with the caller's token and keeps the words; a refused clip says why
        radio.TRANSCRIBE = True
        sent = []
        class _A:
            def __init__(self, ok): self.ok, self.status_code, self.content = ok, 200 if ok else 401, b"mp3"
        radio.requests.get = lambda url, headers=None, timeout=None: sent.append(headers) or _A("HAM" in url)
        radio.transcribe = lambda audio: {"text": "Box this lap"}
        r = radio.radio({"session_key": 2}, "Practice 1", 2026, 44, "tok")
        assert r["clips"][0]["t"] == 1793364000.1 and r["pending"] in (0, 1)
        for _ in range(100):
            if not radio._queued: break
            time.sleep(0.02)
        assert radio.radio({"session_key": 2}, "Practice 1", 2026, 44, "tok")["clips"][0]["text"] == "Box this lap"
        assert sent[0] == {"Authorization": "Bearer tok"}
        r = radio.radio({"session_key": 2}, "Practice 1", 2026, 16, None)
        for _ in range(100):
            if not radio._queued: break
            time.sleep(0.02)
        r = radio.radio({"session_key": 2}, "Practice 1", 2026, 16, None)
        assert r["clips"][0]["text"] is None and "refused" in r["error"], r
    finally:
        radio.DIR, radio.openf1, radio.live.radio, radio.transcribe, radio.requests.get = real
        radio.TRANSCRIBE = False
# a message is timed from its recording start in the clip's name (circuit local time), not F1's publish time ~30 s later
from datetime import datetime as _dt, timezone as _tz
pub = _dt(2026, 10, 30, 18, 33, 37, tzinfo=_tz.utc).timestamp()
assert pub - radio.started(pub, "https://livetiming.formula1.com/static/2026/x/TeamRadio/HAD_6_20261030_123307.mp3") == 30
assert pub - radio.started(pub, "https://livetiming.formula1.com/static/2026/x/TeamRadio/HAD_6_20261031_003307.mp3") == 30  # UTC+6
assert radio.started(pub, "https://livetiming.formula1.com/static/x/HAM.mp3") == pub  # no time in the name
print("team radio ok")
