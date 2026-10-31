"""Team radio as text, for the F1 TV viewer's driver onboards. Neither F1 nor OpenF1 publishes words, only audio clips:
the clip list comes from OpenF1 once a session is over (it locks everything while one is live) or from F1's live feed
(`TeamRadio`) during one; the audio sits on F1's livetiming server, which refuses it without an F1 TV sign-in (401), so
it's fetched with the caller's subscription token; the words come from a local speech-to-text model (faster-whisper,
on the GPU where CUDA is there). Each clip is transcribed once, on one background thread, and kept on disk."""
import hashlib
import json
import queue
import threading
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

import live
from replay import CACHE, OpenF1Locked, openf1, save

STATIC = "https://livetiming.formula1.com/static/"
DIR = CACHE.parent / "radio"
MODEL = "small.en"  # ~0.5 GB, downloaded on first use; radio is English and noisy, the tiny models garble it
# F1 words the model otherwise hears as everyday ones ("box" as "books", "DRS" as "DOS")
PROMPT = ("Formula 1 team radio. Box, box. Copy. Softs, mediums, hards, inters. DRS, delta, gap, P1, safety car, VSC, push. "
          "Verstappen, Hamilton, Leclerc, Norris, Piastri, Russell, Antonelli, Alonso, Stroll, Gasly, Ocon, Albon, Sainz, "
          "Hulkenberg, Bortoleto, Bearman, Hadjar, Lawson, Lindblad, Colapinto, Perez, Bottas.")

_jobs: queue.Queue = queue.Queue()
_queued: set = set()
_errors: dict = {}  # clip url -> why it has no text (the audio refused, a decode error)
_lock = threading.Lock()
_worker: threading.Thread | None = None
_model = None
IDLE = 120  # s without a clip to transcribe before the model is unloaded (reloading it takes ~1-2 s)


def _path(url: str) -> Path:
    return DIR / f"{hashlib.sha1(url.encode()).hexdigest()}.json"


def entry(url: str) -> dict | None:
    """A clip's transcript, {text}, or None while it has none."""
    try:
        e = json.loads(_path(url).read_text())
        return e if "text" in e else None
    except (OSError, ValueError):
        return None


def _cuda_dlls():
    """CUDA's cuBLAS/cuDNN from their pip wheels (nvidia-cublas-cu12, nvidia-cudnn-cu12) keep their DLLs in
    site-packages/nvidia/*/bin, where Windows doesn't look; ctranslate2 loads them by name at the first clip."""
    import importlib.util
    import os
    import sys
    if sys.platform != "win32":
        return
    for pkg in ("nvidia.cublas", "nvidia.cudnn"):
        spec = importlib.util.find_spec(pkg)
        for root in (spec.submodule_search_locations or []) if spec else []:
            bin_dir = Path(root) / "bin"
            if bin_dir.is_dir():
                os.add_dll_directory(str(bin_dir))
                os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")  # plain LoadLibrary reads PATH


def _load():
    """The model on the GPU where CUDA's cuBLAS/cuDNN libraries load (~0.2 s a clip), else on the CPU (~4.5 s for a
    9 s clip, measured): a GPU with no CUDA libraries installed only fails at the first clip, so it's tried here."""
    global _model
    if _model is None:
        _cuda_dlls()
        from faster_whisper import WhisperModel  # heavy import: only once a clip needs it
        import ctranslate2
        import numpy as np
        if ctranslate2.get_cuda_device_count() > 0:
            try:
                m = WhisperModel(MODEL, device="cuda", compute_type="float16")
                list(m.transcribe(np.random.default_rng(0).normal(0, 0.01, 16000).astype(np.float32), vad_filter=False)[0])
                _model = m
            except Exception:  # e.g. "cublas64_12.dll is not found"
                pass
        _model = _model or WhisperModel(MODEL, device="cpu", compute_type="int8")
    return _model


def decode(audio):
    """A clip (path or file-like, any format ffmpeg reads) as 16 kHz mono float samples, what the model takes.
    faster-whisper 1.2.1's own decoder passes PyAV an argument (metadata_errors) PyAV 19 no longer has."""
    import av
    import numpy as np
    out = av.AudioResampler(format="s16", layout="mono", rate=16000)
    with av.open(audio) as c:
        frames = [f.to_ndarray() for frame in c.decode(audio=0) for f in out.resample(frame)]
    frames += [f.to_ndarray() for f in out.resample(None)]  # what the resampler still holds
    return (np.concatenate(frames, axis=1).flatten() / 32768.0).astype(np.float32) if frames else np.zeros(0, np.float32)


def transcribe(audio) -> dict:
    """A clip's words, {text} (a path or file-like, any format ffmpeg reads)."""
    segments, _ = _load().transcribe(decode(audio), beam_size=5, vad_filter=True, initial_prompt=PROMPT, condition_on_previous_text=False)
    return {"text": " ".join(x.text.strip() for x in segments).strip()}


def _work():
    import io
    global _model
    while True:
        try:
            url, token = _jobs.get(timeout=IDLE)
        except queue.Empty:  # no clips for a while: free the model (~0.5 GB of RAM, or the GPU's) until the next one
            _model = None
            continue
        try:
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            r = requests.get(url, headers=headers, timeout=(5, 30))
            if r.status_code in (401, 403):
                _errors[url] = "F1's radio server refused the clip (needs an F1 TV sign-in)"
            elif not r.ok:
                _errors[url] = f"clip unavailable ({r.status_code})"
            else:
                save(_path(url), transcribe(io.BytesIO(r.content)))
        except Exception as e:  # a bad clip mustn't stop the rest
            _errors[url] = f"transcription failed: {e}"
        finally:
            with _lock:
                _queued.discard(url)


def queue_clips(urls: list, token: str | None):
    """Transcribe these clips (oldest first) in the background, skipping done or queued ones."""
    global _worker
    with _lock:
        if _worker is None:
            _worker = threading.Thread(target=_work, daemon=True)
            _worker.start()
        for u in urls:
            if u not in _queued and u not in _errors and not _path(u).exists():
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


def clips(session: dict | None, session_name: str, year: int, driver: int) -> list:
    """[(unix seconds it was said, audio url)] for one driver: OpenF1's once the session is over, else the live feed's
    when it's running this session (OpenF1 is locked while it's live)."""
    if session:
        try:
            rows = openf1(f"team_radio?session_key={session['session_key']}&driver_number={driver}")
            return sorted((started(_ts(r["date"]), r["recording_url"]), r["recording_url"]) for r in rows)
        except OpenF1Locked:
            pass
    info, caps = live.radio()
    if info and info.get("Name") == session_name and str(info.get("Path", "")).startswith(f"{year}/"):
        urls = [(_ts(c["Utc"]), STATIC + info["Path"] + c["Path"]) for c in caps if str(c.get("RacingNumber")) == str(driver)]
        return sorted((started(t, u), u) for t, u in urls)
    return []


# Each message's words in the onboard's radio list (the user's call): F1 publishes none, so speech-to-text, every clip of
# the driver queued as the list asks for it (GPU: ~0.5 s a clip). False: the list has F1's clips to play, no words.
TRANSCRIBE = True


def radio(session: dict | None, session_name: str, year: int, driver: int, token: str | None) -> dict:
    """{clips: [{t (when it was said), url, text}], pending, error, transcribe}: what the viewer shows. url:
    F1's audio, played through /api/f1tv/radio/audio; text null with transcription off, or while it's being transcribed."""
    cs = clips(session, session_name, year, driver)
    if TRANSCRIBE:
        queue_clips([u for _, u in cs], token)
    out = [{"t": t, "url": u, "text": (e := entry(u)) and e["text"] if TRANSCRIBE else None} for t, u in cs]
    errs = {_errors[u] for _, u in cs if u in _errors}
    return {"clips": out, "pending": sum(1 for _, u in cs if u in _queued), "error": next(iter(errs), None), "transcribe": TRANSCRIBE}


def audio(url: str, token: str | None) -> bytes:
    """A clip's audio from F1's livetiming server, which refuses it without an F1 TV sign-in; only clips are fetched
    (the url comes from the page)."""
    if not url.startswith(STATIC) or ".." in url:
        raise ValueError("Not an F1 team radio clip")
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"} if token else {}, timeout=(5, 30))
    if r.status_code in (401, 403):
        raise PermissionError("F1's radio server refused the clip: connect your F1 TV account")
    r.raise_for_status()
    return r.content
