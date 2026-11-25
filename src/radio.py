"""Team radio as text, for the F1 TV viewer's driver onboards. Neither F1 nor OpenF1 publishes words, only audio clips:
the clip list comes from OpenF1 once a session is over (it locks everything while one is live) or from F1's live feed
(`TeamRadio`) during one; the audio sits on F1's livetiming server, which refuses it without an F1 TV sign-in (401), so
it's fetched with the caller's subscription token; the words come from a local speech-to-text model (NVIDIA Parakeet
TDT 0.6B v3). Each clip is transcribed once, on one background thread, and kept on disk."""
import hashlib
import json
import queue
import threading
import time
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

import requests

import live
from replay import CACHE, OpenF1Locked, _finished, openf1, save

HOST = "livetiming.formula1.com"
STATIC = f"https://{HOST}/static/"
DIR = CACHE.parent / "radio" / "parakeet"  # Whisper's older transcripts sit one folder up, not reused
MODEL = "nemo-parakeet-tdt-0.6b-v3"  # onnx-asr's name for it
MODEL_REPO = "istupakov/parakeet-tdt-0.6b-v3-onnx"  # nvidia/parakeet-tdt-0.6b-v3 exported to ONNX (NeMo itself won't run here)
MODEL_DIR = CACHE.parent / "parakeet"

_jobs: queue.Queue = queue.LifoQueue()  # newest clip first: on a live session that's what's being said
_queued: set = set()
# shortcut: _errors, _rows and _texts only grow (one entry per clip or session, a few thousand a season); add a sweep if the server runs for weeks
_errors: dict = {}  # clip url -> (when, why it has no text, whether it was refused for want of a token)
RETRY = 300  # s before a clip that failed is tried again
ROWS_TTL = 30  # s an unfinished session's clip list is kept (the viewer asks every 8 s per onboard)
MAX_URL = 2048
_rows: dict = {}  # (session_key, driver) -> (asked at, or None for good; OpenF1's rows, None while it's locked)
_lock = threading.Lock()
_worker: threading.Thread | None = None
_model = None
IDLE = 120  # s without a clip to transcribe before the model is unloaded (reloading it takes a few s)


def _path(url: str) -> Path:
    return DIR / f"{hashlib.sha1(url.encode()).hexdigest()}.json"


_texts: dict = {}  # url -> {text}: a sentence each, so a poll doesn't open several hundred files


def entry(url: str) -> dict | None:
    """A clip's transcript, {text}, or None while it has none."""
    if url not in _texts:
        try:
            e = json.loads(_path(url).read_text())
        except (OSError, ValueError):
            return None
        if "text" not in e:
            return None
        _texts[url] = e
    return _texts[url]


def _load():
    """NVIDIA's Parakeet TDT 0.6B v3 (nvidia/parakeet-tdt-0.6b-v3) as ONNX, run by onnx-asr on the CPU: ~1.4 s for an
    8 s clip, measured on the 2026 São Paulo race. Its int8 build is faster but garbled the same clip ("risk of rain"
    as "risk of read"). Kept in .cache/parakeet (~2.5 GB, downloaded on first use): from the Hugging Face cache, whose
    files are links into a blob store, ONNX Runtime refuses the encoder's external weights."""
    global _model
    if _model is None:
        import onnx_asr  # heavy import: only once a clip needs it
        _model = onnx_asr.load_model(MODEL, _download(), providers=["CPUExecutionProvider"])
    return _model


MODEL_FILES = ("nemo128.onnx", "encoder-model.onnx", "encoder-model.onnx.data", "decoder_joint-model.onnx")
_fetch_state = {"thread": None, "error": None}


def _download() -> str:
    from huggingface_hub import snapshot_download
    return snapshot_download(MODEL_REPO, local_dir=MODEL_DIR, allow_patterns=["*.json", "*.txt", "nemo128.onnx",
                                                                             "encoder-model.onnx*", "decoder_joint-model.onnx"])


def model_state() -> str:
    """'ready' (the model's files are here: a download moves each into place only once it's whole), 'downloading',
    'failed' (the last download stopped) or 'missing'. Nothing is transcribed, so nothing downloaded, until it's ready:
    2.5 GB is the reader's to agree to (fetch_model, from the radio panel's button)."""
    if all((MODEL_DIR / f).exists() for f in MODEL_FILES):
        return "ready"
    t = _fetch_state["thread"]
    return "downloading" if t and t.is_alive() else "failed" if _fetch_state["error"] else "missing"


def fetch_model() -> None:
    """Starts the model's download in the background, unless it's here or already coming; a stopped one resumes."""
    def run():
        try:
            _download()
            _fetch_state["error"] = None
        except Exception as e:
            _fetch_state["error"] = str(e)
    with _lock:
        if model_state() in ("missing", "failed"):
            _fetch_state["thread"] = threading.Thread(target=run, daemon=True)
            _fetch_state["thread"].start()


def decode(audio):
    """A clip (path or file-like, any format ffmpeg reads) as 16 kHz mono float samples, what the model takes."""
    import av
    import numpy as np
    out = av.AudioResampler(format="s16", layout="mono", rate=16000)
    with av.open(audio) as c:
        frames = [f.to_ndarray() for frame in c.decode(audio=0) for f in out.resample(frame)]
    frames += [f.to_ndarray() for f in out.resample(None)]  # what the resampler still holds
    return (np.concatenate(frames, axis=1).flatten() / 32768.0).astype(np.float32) if frames else np.zeros(0, np.float32)


def transcribe(audio) -> dict:
    """A clip's words, {text} (a path or file-like, any format ffmpeg reads)."""
    x = decode(audio)
    return {"text": _load().recognize(x, sample_rate=16000).strip() if len(x) else ""}


def clip_url(url: str) -> str:
    """The url if it's an F1 team radio clip, else ValueError: it comes from the page or OpenF1, and the caller's F1 TV
    token goes with the request. Checked decoded, since the host decodes %2e%2e back into a path outside /static/."""
    u = urlsplit(url)
    path = unquote(u.path)
    if (len(url) > MAX_URL or (u.scheme, u.netloc) != ("https", HOST) or u.query or u.fragment
            or re.search(r"[\\\x00-\x1f]", url + path) or "%" in path  # % left after decoding: encoded twice
            or str(PurePosixPath(path)) != path or ".." in path.split("/")
            or not path.startswith("/static/") or not path.endswith(".mp3")):
        raise ValueError("Not an F1 team radio clip")
    return url


def _fetch(url: str, token: str | None):
    return requests.get(clip_url(url), headers={"Authorization": f"Bearer {token}"} if token else {}, timeout=(5, 30))


def _work():
    import io
    global _model
    while True:
        try:
            url, token = _jobs.get(timeout=IDLE)
        except queue.Empty:  # no clips for a while: free the model (~2.5 GB of RAM) until the next one
            _model = None
            continue
        try:
            r = _fetch(url, token)
            if r.status_code in (401, 403):
                _errors[url] = (time.time(), "F1's radio server refused the clip (needs an F1 TV sign-in)", not token)
            elif not r.ok:
                _errors[url] = (time.time(), f"clip unavailable ({r.status_code})", False)
            else:
                save(_path(url), transcribe(io.BytesIO(r.content)))
        except Exception as e:  # a bad clip mustn't stop the rest
            _errors[url] = (time.time(), f"transcription failed: {e}", False)
        finally:
            with _lock:
                _queued.discard(url)


def _waiting(url: str, token: str | None) -> bool:
    """A clip that failed waits RETRY s, unless it was refused for want of a token and now there is one."""
    e = _errors.get(url)
    return bool(e) and time.time() - e[0] < RETRY and not (token and e[2])


def queue_clips(urls: list, token: str | None):
    """Transcribe these clips (oldest first) in the background, skipping done or queued ones."""
    global _worker
    with _lock:
        if _worker is None:
            _worker = threading.Thread(target=_work, daemon=True)
            _worker.start()
        for u in urls:
            if u not in _queued and u not in _texts and not _waiting(u, token) and not _path(u).exists():
                _errors.pop(u, None)
                _queued.add(u)
                _jobs.put((u, token))


def _ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def started(published: float, url: str) -> float:
    """When a clip was recorded (unix s). F1 publishes it once it's processed, ~30 s after it was said (Mexico FP1 2026:
    HAD_6_20261030_123307.mp3, local 12:33:07, published 18:33:37 UTC), and the file name keeps the recording's start in
    the circuit's local time: the published time less that delay, which is the part of the gap past a whole quarter
    hour (time zones are whole quarter hours). A name without it: the published time."""
    m = re.search(r"_(\d{8})_(\d{6})\.mp3$", url)
    if not m:
        return published
    local = datetime.strptime(m[1] + m[2], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).timestamp()
    delay = (published - local) % 900
    return published - delay if delay < 300 else published


def _openf1_rows(session: dict, endpoint: str, driver: int | None = None) -> list | None:
    """OpenF1's rows for this session (one driver's, or all), kept until it's over (then for good), or None while it's
    locked: the viewer polls, and OpenF1 allows ~30 req/min."""
    key = (session["session_key"], driver if endpoint == "team_radio" else endpoint)
    hit = _rows.get(key)
    if hit and (hit[0] is None or time.time() - hit[0] < ROWS_TTL):
        return hit[1]
    try:
        rows = openf1(f"{endpoint}?session_key={session['session_key']}" + (f"&driver_number={driver}" if driver else ""))
    except OpenF1Locked:
        rows = None
    _rows[key] = (None if rows and _finished(session) else time.time(), rows)
    return rows


def _feed(session_name: str, year: int) -> tuple:
    """(SessionInfo, clips) from F1's live feed when it's carrying this session, else (None, [])."""
    info, caps = live.radio()
    on = info and info.get("Name") == session_name and str(info.get("Path", "")).startswith(f"{year}/")
    return (info, caps) if on else (None, [])


def clips(session: dict | None, session_name: str, year: int, driver: int | None = None) -> list:
    """[(unix seconds it was said, audio url, driver number)] for one driver, or every driver with None: OpenF1's once
    the session is over, else the live feed's when it's running this session (OpenF1 is locked while it's live)."""
    info, caps = _feed(session_name, year)
    if session and not (info and (live.status() or {}).get("live")):  # running on the feed: OpenF1 would only refuse
        rows = _openf1_rows(session, "team_radio", driver)
        if rows is not None:
            return sorted((started(_ts(r["date"]), r["recording_url"]), r["recording_url"], int(r.get("driver_number") or driver))
                          for r in rows)
    if info:
        urls = [(_ts(c["Utc"]), STATIC + info["Path"] + c["Path"], int(c["RacingNumber"]))
                for c in caps if driver is None or str(c.get("RacingNumber")) == str(driver)]
        return sorted((started(t, u), u, d) for t, u, d in urls)
    return []


def drivers(session: dict | None, session_name: str, year: int) -> dict:
    """{number: {tla, name, team, colour, headshot}} for the radio panel's driver cards: the live feed's DriverList while
    it's carrying this session, else OpenF1's drivers (F1's headshots either way); {} when neither answers."""
    info, _ = _feed(session_name, year)
    if info:
        return {int(k): {"tla": d.get("Tla"), "name": " ".join(filter(None, (d.get("FirstName"), d.get("LastName")))) or None,
                         "team": d.get("TeamName"), "colour": d.get("TeamColour"), "headshot": d.get("HeadshotUrl")}
                for k, d in live.driver_list().items() if isinstance(d, dict) and str(k).isdigit()}
    rows = _openf1_rows(session, "drivers") if session else None
    return {int(r["driver_number"]): {"tla": r.get("name_acronym"), "name": r.get("full_name") and r["full_name"].title(),
                                      "team": r.get("team_name"), "colour": r.get("team_colour"), "headshot": r.get("headshot_url")}
            for r in rows or [] if r.get("driver_number")}



def radio(session: dict | None, session_name: str, year: int, driver: int | None, token: str | None) -> dict:
    """{clips: [{t (when it was said), url, driver, text, error}], pending, error, model}, plus drivers
    (radio.drivers) when it's every driver's (driver None): what the viewer's radio panel shows. url: F1's audio, played
    through /api/f1tv/radio/audio; text null while it's being transcribed (F1 publishes no words: speech-to-text, the user's call); error: why this
    clip has no words (it's tried again after RETRY s), else null; model: model_state(), and no clip is transcribed
    until it's 'ready' (the panel asks before the 2.5 GB download)."""
    cs = clips(session, session_name, year, driver)
    state = model_state()
    if state == "ready":
        queue_clips([u for _, u, _ in cs], token)  # oldest in first, so the LIFO queue hands out the newest first
    why = lambda u: _errors[u][1] if u in _errors else None
    out = [{"t": t, "url": u, "driver": d, "text": (e := entry(u)) and e["text"], "error": why(u)}
           for t, u, d in cs]
    errs = {why(u) for _, u, _ in cs if u in _errors}
    r = {"clips": out, "pending": sum(1 for _, u, _ in cs if u in _queued), "error": next(iter(errs), None), "model": state}
    if driver is None:
        r["drivers"] = drivers(session, session_name, year)
    return r


def audio(url: str, token: str | None) -> bytes:
    """A clip's audio from F1's livetiming server, which refuses it without an F1 TV sign-in; only clips are fetched
    (the url comes from the page)."""
    r = _fetch(url, token)
    if r.status_code in (401, 403):
        raise PermissionError("F1's radio server refused the clip: connect your F1 TV account")
    r.raise_for_status()
    return r.content
