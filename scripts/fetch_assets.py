"""Downloads what the page used to fetch from CDNs into src/static/assets (gitignored), so the app runs from local files:
three.js, shaka-player, fonts, flags, Poly Haven's skies and photo textures, and Esri imagery tiles for every circuit. scene3d.js, textures3d.js and
util.js name what's needed, so a new sky, photo set or flag only needs this run again; files already here are skipped.
Run: .venv/Scripts/python scripts/fetch_assets.py (build_exe.py runs it first). Also run it after adding a three/addons import."""
import os
import json
import re
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "src" / "static"
ASSETS = STATIC / "assets"
THREE = "https://cdn.jsdelivr.net/npm/three@0.187.0/"
SHAKA = "https://cdn.jsdelivr.net/npm/shaka-player@4.12.6/dist/shaka-player.compiled.js"
PH = "https://dl.polyhaven.org/file/ph-assets"
ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile"
FONTS = ["family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&family=Titillium+Web:ital,wght@1,900",
         "family=Titillium+Web:ital,wght@0,400;0,600;0,700;1,900"]
CHROME = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"}  # Google sends others no woff2


def fetch(url: str, dest: Path, quiet: bool = False) -> Path:
    """Atomic: a download killed midway must not pass for a finished file on the next run."""
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
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    if not quiet:
        print(f"{dest.stat().st_size / 1e6:7.1f} MB  {dest.relative_to(ASSETS)}")
    return dest


def three() -> None:
    """The two builds, every addon the app imports, and whatever those import in turn."""
    app = "".join(p.read_text(encoding="utf8") for p in STATIC.glob("*.js"))
    queue = ["build/three.webgpu.js", "build/three.tsl.js"]
    queue += ["examples/jsm/" + a for a in re.findall(r"""(?:from\s*|import\(\s*)['"]three/addons/([^'"]+)""", app)]
    seen = set()
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        src = re.sub(r"/\*.*?\*/", "", fetch(THREE + path, ASSETS / "three" / path).read_text(encoding="utf8"), flags=re.S)
        # relative imports only: three, three/webgpu and three/tsl are the import map's own entries
        for dep in re.findall(r"""(?:from|import)\s*['"](\.{1,2}/[^'"]+)['"]""", src):
            queue.append(os.path.normpath(os.path.join(os.path.dirname(path), dep)).replace("\\", "/"))


def fonts() -> None:
    css = "".join(requests.get(f"https://fonts.googleapis.com/css2?{q}&display=swap", headers=CHROME, timeout=60).text for q in FONTS)
    urls = set(re.findall(r"url\((https://[^)]+\.woff2)\)", css))
    assert urls, "Google Fonts sent no woff2"
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda u: fetch(u, ASSETS / "fonts" / u.rsplit("/", 1)[1]), urls))
    out = ASSETS / "fonts" / "fonts.css"
    out.write_text(re.sub(r"url\(https://[^)]+/([^/)]+\.woff2)\)", r"url(\1)", css), encoding="utf8")


def files() -> dict[str, Path]:
    """Sky presets, photo sets at both tiers' resolutions and flags, as the page's own modules name them."""
    jobs = {}
    for name in re.findall(r"hdri\('(\w+)'\)", (STATIC / "scene3d.js").read_text(encoding="utf8")):
        jobs[f"{PH}/HDRIs/hdr/4k/{name}_4k.hdr"] = ASSETS / "hdri" / f"{name}_4k.hdr"
    photos = re.findall(r"photo\('(\w+)'.*?high \? '(\w+)' : '(\w+)'\)", (STATIC / "textures3d.js").read_text(encoding="utf8"))
    assert photos, "no photo sets found in textures3d.js"
    for name, hi, lo in photos:
        for res in (hi, lo):
            for kind in ("diff", "nor_gl", "rough"):
                file = f"{res}/{name}/{name}_{kind}_{res}.jpg"
                jobs[f"{PH}/Textures/jpg/{file}"] = ASSETS / "textures" / file
    iso = re.search(r"const ISO = \{(.*?)\};", (STATIC / "util.js").read_text(encoding="utf8"), re.S).group(1)
    for code in set(re.findall(r": '([a-z]{2})'", iso)):
        jobs[f"https://flagcdn.com/w40/{code}.png"] = ASSETS / "flags" / "w40" / f"{code}.png"
    jobs[SHAKA] = ASSETS / "shaka" / "shaka-player.compiled.js"
    return jobs


def circuits() -> list[dict]:
    """Every circuit with a real-world outline, at its latest race: an older layout's odd tile comes from Esri at run time."""
    sys.path.insert(0, str(ROOT / "src"))
    from fastapi import HTTPException
    from server import race_geo, race_info, race_track, races
    today, seen, out = date.today().isoformat(), set(), []
    for year in range(date.today().year, 1949, -1):
        for r in races(year):
            cid = r["Circuit"]["circuitId"]
            if cid in seen or r["date"] > today:
                continue
            seen.add(cid)
            try:
                t, g = race_track(year, int(r["round"])), race_geo(year, int(r["round"]))
            except HTTPException:  # no outline: the app shows no imagery there either
                continue
            f1 = t.get("source") in ("multiviewer", "openf1")  # circuits.js f1Coords
            out.append({"x": t["x"], "y": t["y"], "rotation": t.get("rotation", 0), "mpu": 0.1 if f1 else 1, "geo": g})
    return out


def tile(path: str) -> str:
    """'ok', or 'none' where Esri has no such tile. Other failures retry, then count: a re-run picks up what's left."""
    for wait in (2, 8, 30, None):
        try:
            z, y, x = path.split("/")
            fetch(f"{ESRI}/{path}", ASSETS / "tiles" / z / y / f"{x}.jpg", quiet=True)
            return "ok"
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return "none"
        except requests.RequestException:
            pass
        if wait is None:
            return "failed"
        time.sleep(wait)


def tiles() -> None:
    wanted = json.loads(subprocess.run(["node", str(ROOT / "scripts" / "tile_list.mjs")], input=json.dumps(circuits()),
                                       capture_output=True, text=True, encoding="utf8", check=True).stdout)
    print(f"{len(wanted)} imagery tiles", flush=True)
    done = {"ok": 0, "none": 0, "failed": 0}
    with ThreadPoolExecutor(6) as pool:  # six at a time, as the app itself asks for them
        for i, result in enumerate(pool.map(tile, wanted), 1):
            done[result] += 1
            if i % 1000 == 0:
                print(f"{i} / {len(wanted)} {done}", flush=True)
    print(done, flush=True)
    if done["failed"]:
        sys.exit(f"{done['failed']} tiles failed: run this again to fetch the rest")


if __name__ == "__main__":
    three()
    fonts()
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda job: fetch(*job), files().items()))  # list(): a failed download raises and fails the build
    tiles()
    sizes = [p.stat().st_size for p in ASSETS.rglob("*") if p.is_file()]
    print(f"{len(sizes)} files, {sum(sizes) / 1e6:.0f} MB in {ASSETS}")
