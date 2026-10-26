"""Live timing from F1's SignalR Core feed (livetiming.formula1.com/signalrcore), which still works without a login.

The connection is opened on the first request and closed after IDLE seconds without one. Car GPS and telemetry
(Position.z, CarData.z) need an F1 TV subscription token (f1auth.py), sent as Bearer like MultiViewer and FastF1 do;
without one the feed silently leaves them out. They arrive as base64 raw-deflate JSON and are kept here decoded, as
"Position" / "CarData" with the last BUFFER s of samples, so the browser's 1 s poll can interpolate between them.
"""
import base64
import copy
import json
import threading
import time
import zlib
from datetime import datetime

import requests
from websockets.sync.client import connect

import f1auth

HOST = "livetiming.formula1.com/signalrcore"
TOPICS = ["Heartbeat", "SessionInfo", "SessionStatus", "DriverList", "TimingData", "TimingAppData", "TrackStatus",
          "LapCount", "RaceControlMessages", "WeatherData", "ExtrapolatedClock", "TopThree", "TimingStats",
          "Position.z", "CarData.z"]
IDLE = 120
BUFFER = 6  # seconds of GPS / car data samples kept for the browser
RS = "\x1e"  # SignalR message separator

_state: dict = {}
# token: the last poller's F1 TV token, in memory only; rejected: one F1 refused, so pollers can't resend it every 5 s
_status = {"connected": False, "error": None, "last_request": 0.0, "auth": False, "token": None, "rejected": None,
           "auth_error": None}
_lock = threading.Lock()
_start_lock = threading.Lock()
_thread: threading.Thread | None = None


def merge(base, update):
    """Apply a partial feed update. A dict update to a list addresses items by index ({"3": {...}})."""
    if isinstance(base, dict) and isinstance(update, dict):
        for k, v in update.items():
            base[k] = merge(base[k], v) if k in base else v
        return base
    if isinstance(base, list) and isinstance(update, dict):
        for k, v in update.items():
            i = int(k)
            if i < len(base):
                base[i] = merge(base[i], v)
            else:
                base.append(v)  # shortcut: assumes new items arrive in index order, which the feed does
        return base
    return update


def inflate(data: str):
    return json.loads(zlib.decompress(base64.b64decode(data), -zlib.MAX_WBITS))


def _utc(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


# compressed topic -> (state key, list of timestamped samples, timestamp field)
SAMPLED = {"Position.z": ("Position", "Position", "Timestamp"), "CarData.z": ("CarData", "Entries", "Utc")}


def _put(topic: str, data):
    """Store one topic's data; samples of the compressed topics are appended and trimmed to BUFFER s."""
    if topic not in SAMPLED:
        _state[topic] = merge(_state[topic], data) if topic in _state else data
        return
    key, field, stamp = SAMPLED[topic]
    new = inflate(data).get(field) or []
    old = _state.get(key, {}).get(field, [])
    last = _utc(old[-1][stamp]) if old else 0
    samples = old + [e for e in new if _utc(e[stamp]) > last]
    newest = _utc(samples[-1][stamp]) if samples else 0
    _state[key] = {field: [e for e in samples if _utc(e[stamp]) > newest - BUFFER]}


def _handle(msg: dict):
    if msg.get("type") == 3 and isinstance(msg.get("result"), dict):  # Subscribe reply: the full current state
        with _lock:
            _state.clear()
            for topic, data in msg["result"].items():
                _put(topic, data)
    elif msg.get("type") == 1 and msg.get("target") == "feed":
        topic, data = msg["arguments"][0], msg["arguments"][1]
        with _lock:
            _put(topic, data)
    elif msg.get("type") == 7:
        raise ConnectionError(msg.get("error") or "closed by server")


def _idle() -> bool:
    return time.time() - _status["last_request"] > IDLE


def _run():
    while not _idle():
        try:
            tok = _status["token"] = f1auth.valid(_status["token"])  # an expired one is dropped
            auth = {"Authorization": f"Bearer {tok}"} if tok else {}
            _status["auth"] = bool(tok)
            neg = requests.post(f"https://{HOST}/negotiate?negotiateVersion=1", headers=auth, timeout=15)
            if neg.status_code == 401 and tok:  # rejected token: drop it, and use the free feed for a while
                _status.update(token=None, rejected=tok, auth_error="F1 rejected the F1 TV token: connect again")
            neg.raise_for_status()
            cookie = "; ".join(f"{k}={v}" for k, v in neg.cookies.items())  # load balancer stickiness
            with connect(f"wss://{HOST}?id={neg.json()['connectionToken']}",
                         additional_headers={"Cookie": cookie, **auth}, max_size=None, open_timeout=15) as ws:
                ws.send(json.dumps({"protocol": "json", "version": 1}) + RS)
                ws.send(json.dumps({"type": 1, "invocationId": "0", "target": "Subscribe", "arguments": [TOPICS]}) + RS)
                _status.update(connected=True, error=None)
                pinged = time.time()
                while not _idle() and not (_status["token"] and not tok):  # reconnect signed in once a token arrives
                    if time.time() - pinged > 10:  # the server drops clients that stay silent for 30 s
                        ws.send(json.dumps({"type": 6}) + RS)
                        pinged = time.time()
                    try:
                        raw = ws.recv(timeout=5)
                    except TimeoutError:
                        continue
                    for part in filter(None, raw.split(RS)):
                        _handle(json.loads(part))
        except Exception as e:
            _status.update(connected=False, error=str(e))
            time.sleep(5)
    _status["connected"] = False


def snapshot(token: str | None = None) -> dict:
    """Current live state; starts the connection if needed and waits up to 5 s for the first data. A caller's F1 TV
    token (f1auth) unlocks car GPS and telemetry on the shared connection."""
    global _thread
    _status["last_request"] = time.time()
    if token and token != _status["rejected"]:
        _status.update(token=token, auth_error=None)
    with _start_lock:  # requests run in a thread pool: two first polls must not open two feed connections
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_run, daemon=True)
            _thread.start()
    for _ in range(50):
        if _state or _status["error"]:
            break
        time.sleep(0.1)
    with _lock:
        return {"connected": _status["connected"], "error": _status["error"], "auth": _status["auth"],
                "auth_error": _status["auth_error"],
                "topics": copy.deepcopy(_state)}


def rows(data) -> list:
    """One topic as table rows: per driver for Lines-style topics, per message for RaceControlMessages."""
    for key in ("Lines", "Messages"):
        if isinstance(data, dict) and key in data:
            data = data[key]
            break
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        values = [v for k, v in data.items() if not k.startswith("_")]
        if len(values) > 1 and all(isinstance(v, dict) for v in values):  # keyed by driver number
            return values
    return [data]
