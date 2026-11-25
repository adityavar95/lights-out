"""What the page used to fetch from CDNs, kept in static/assets (gitignored). `core`: three.js, shaka, anime.js, theatre.js, fonts and flags, which the
page can't start without, fetched on the first page load. `start`: skies, textures and satellite tiles for every circuit
(~600 MB), which the page gets at lower resolution or from Esri until someone chooses to download them (downloads.js, or
scripts/fetch_assets.py before a build). The page's own modules name what's needed; files already here are skipped."""
import hashlib
import json
import os
import re
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from paths import DATA, EDITION, FROZEN

STATIC = Path(__file__).parent / "static"
ASSETS = DATA / "assets" if FROZEN else STATIC / "assets"  # the exe's own folder may not be writable (paths.py)
if FROZEN and not (ASSETS / f".bundled-{EDITION}").exists():
    # shortcut: the exe's assets (build_exe.py edition: up to ~1.1 GB) are copied out once per edition, so installing full over lite still copies
    # its extras; downloads have one folder to add to. Served from both folders instead if the copy ever matters
    shutil.copytree(STATIC / "assets", ASSETS, dirs_exist_ok=True)
    (ASSETS / f".bundled-{EDITION}").touch()
THREE = "https://cdn.jsdelivr.net/npm/three@0.187.0/"
ANIME = "https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.esm.min.js"
THEATRE = "https://cdn.jsdelivr.net/npm/@theatre/core@0.7.2/+esm"  # ESM: the package's own build is CommonJS
THEATRE_DATA = "https://cdn.jsdelivr.net/npm/@theatre/dataverse@0.7.2/+esm"  # core imports it by this path (index.html's import map)
SHAKA = "https://cdn.jsdelivr.net/npm/shaka-player@4.12.6/dist/shaka-player.compiled.js"
PH = "https://dl.polyhaven.org/file/ph-assets"
ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile"
# the 2026 team cars at full texture size (PNG, up to 4096 px; CC BY 4.0, static/models/CREDITS.md), pinned to a commit
CARS = "https://raw.githubusercontent.com/Rayman0106/f1-economics-3d-deck/c821c8e42c41c6234ece0288b860fe2f5e1f5551/assets/cars/2026"
FONTS = ["family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&family=Titillium+Web:ital,wght@1,900",
         "family=Titillium+Web:ital,wght@0,400;0,600;0,700;1,900"]
CHROME = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"}  # Google sends others no woff2

# the page's other libraries, as URL -> path under ASSETS; hash-pinned like three.js, since they run beside the F1 TV token
PINNED = {SHAKA: "shaka/shaka-player.compiled.js", ANIME: "animejs/anime.esm.min.js", THEATRE: "theatre/core.js", THEATRE_DATA: "theatre/dataverse.js"}
# three.js file (under three/) or PINNED path -> sha256, see write_hashes
HASHES = json.loads((STATIC / "asset_hashes.json").read_text(encoding="utf8"))
_core_done = False
_core_lock = threading.Lock()
_lock = threading.Lock()
_state = {"state": "idle", "done": 0, "total": 0, "failed": 0, "missing": None}


def _read(name: str) -> str:
    return (STATIC / name).read_text(encoding="utf8")


def fetch(url: str, dest: Path, sha: str | None = None) -> Path:
    """Atomic: a download killed midway must not pass for a finished file on the next run. sha: the file must hash to it."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f"{dest.name}.{uuid.uuid4().hex}.tmp")
    try:
        with requests.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with tmp.open("wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        if sha and hashlib.sha256(tmp.read_bytes()).hexdigest() != sha:
            raise RuntimeError(f"{url} does not match its recorded sha256")
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    return dest


def _three_walk(text_of) -> set[str]:
    """Every three.js file the page loads: the two builds, the addons the app imports, and what those import in turn."""
    app = "".join(p.read_text(encoding="utf8") for p in STATIC.glob("*.js"))
    queue = ["build/three.webgpu.js", "build/three.tsl.js"]
    queue += ["examples/jsm/" + a for a in re.findall(r"""(?:from\s*|import\(\s*)['"]three/addons/([^'"]+)""", app)]
    seen = set()
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        src = re.sub(r"/\*.*?\*/", "", text_of(path), flags=re.S)
        # relative imports only: three, three/webgpu and three/tsl are the import map's own entries
        for dep in re.findall(r"""(?:from|import)\s*['"](\.{1,2}/[^'"]+)['"]""", src):
            queue.append(os.path.normpath(os.path.join(os.path.dirname(path), dep)).replace("\\", "/"))
    return seen


def _three() -> None:
    # HASHES[path] raises KeyError for a file with no recorded hash: a three.js bump needs write_hashes first
    _three_walk(lambda p: fetch(THREE + p, ASSETS / "three" / p, HASHES[p]).read_text(encoding="utf8"))


def write_hashes() -> None:
    """Run after a three.js or PINNED version bump, on files you trust: records the sha256 of each file _three() loads
    and of each PINNED file. Also run it if jsDelivr rebuilds a +esm bundle (theatre): a first start then fails on its hash."""
    paths = _three_walk(lambda p: (ASSETS / "three" / p).read_text(encoding="utf8"))
    out = {p: hashlib.sha256((ASSETS / "three" / p).read_bytes()).hexdigest() for p in sorted(paths)}
    out |= {p: hashlib.sha256((ASSETS / p).read_bytes()).hexdigest() for p in sorted(PINNED.values())}
    (STATIC / "asset_hashes.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf8")


def _fonts() -> None:
    out = ASSETS / "fonts" / "fonts.css"
    if out.exists():
        return
    css = ""
    for q in FONTS:
        r = requests.get(f"https://fonts.googleapis.com/css2?{q}&display=swap", headers=CHROME, timeout=60)
        r.raise_for_status()
        css += r.text
    urls = set(re.findall(r"url\((https://[^)]+\.woff2)\)", css))
    assert urls, "Google Fonts sent no woff2"
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda u: fetch(u, ASSETS / "fonts" / u.rsplit("/", 1)[1]), urls))
    out.write_text(re.sub(r"url\(https://[^)]+/([^/)]+\.woff2)\)", r"url(\1)", css), encoding="utf8")


def core() -> None:
    """Once a process, cheap when everything's here. Raises if it can't: the page can't start without these."""
    global _core_done
    with _core_lock:
        if _core_done:
            return
        _three()
        _fonts()
        iso_m = re.search(r"const ISO = \{(.*?)\};", _read("util.js"), re.S)
        assert iso_m, "no ISO table in util.js"
        iso = iso_m.group(1)
        jobs = {f"https://flagcdn.com/w40/{c}.png": (ASSETS / "flags" / "w40" / f"{c}.png", None) for c in set(re.findall(r": '([a-z]{2})'", iso))}
        jobs |= {url: (ASSETS / p, HASHES[p]) for url, p in PINNED.items()}  # KeyError: a bump needs write_hashes first
        with ThreadPoolExecutor(6) as pool:
            list(pool.map(lambda job: fetch(job[0], *job[1]), jobs.items()))
        _core_done = True


def _heavy() -> dict[str, Path]:
    """Day sky presets, photo sets at both tiers' resolutions (4k desktop, 1k mobile), and the tiles scripts/tile_list.py listed."""
    jobs = {}
    hdris = re.findall(r"hdri\('(\w+)'\)", _read("scene3d.js"))
    assert hdris, "no sky presets found in scene3d.js"
    for name in hdris:
        jobs[f"{PH}/HDRIs/hdr/4k/{name}_4k.hdr"] = ASSETS / "hdri" / f"{name}_4k.hdr"
    photos = re.findall(r"photo\('(\w+)'", _read("textures3d.js"))
    assert photos, "no photo sets found in textures3d.js"
    for name in photos:
        for res in ("4k", "1k"):
            for kind in ("diff", "nor_gl", "rough"):
                file = f"{res}/{name}/{name}_{kind}_{res}.jpg"
                jobs[f"{PH}/Textures/jpg/{file}"] = ASSETS / "textures" / file
    cars = re.findall(r"\[/[^/]+/, '([\w-]+)'", _read("rb22.js"))
    assert cars, "no team models found in rb22.js"
    for key in cars:
        jobs[f"{CARS}/{key}-hires.glb"] = ASSETS / "cars" / f"{key}-hires.glb"
    for path in json.loads(_read("tile_list.json")):
        z, y, x = path.split("/")
        jobs[f"{ESRI}/{path}"] = ASSETS / "tiles" / z / y / f"{x}.jpg"
    return jobs


def _missing() -> dict[str, Path]:
    return {u: d for u, d in _heavy().items() if not d.exists()}


def _one(job: tuple[str, Path]) -> str:
    """'ok', or 'none' where the server has no such file. Other failures retry, then count: another run picks up the rest."""
    for wait in (2, 8, 30, None):
        try:
            fetch(*job)
            return "ok"
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return "none"
        except (requests.RequestException, OSError):  # OSError: a full disk, say; the partial file is already gone
            pass
        if wait is None:
            return "failed"
        time.sleep(wait)


def _run() -> None:
    try:
        jobs = _missing()
        _state["total"] = len(jobs)
        with ThreadPoolExecutor(6) as pool:  # six at a time, as the page itself asks for tiles
            for result in pool.map(_one, jobs.items()):
                _state["done"] += 1
                _state["failed"] += result == "failed"
        _state["missing"] = len(_missing())
        _state["state"] = "error" if _state["failed"] else "done"
    except Exception as e:  # on a thread nobody waits for: the page must hear it from status()
        print(f"asset download failed: {e!r}")
        _state["state"] = "error"


def start() -> None:
    with _lock:
        if _state["state"] != "running":
            _state.update(state="running", done=0, total=0, failed=0)
            threading.Thread(target=_run, daemon=True).start()


def status() -> dict:
    with _lock:
        if _state["missing"] is None:  # ~25,000 file checks: once, and again after a download
            _state["missing"] = len(_missing())
    return dict(_state)
