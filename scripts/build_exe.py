"""Builds dist/<edition>/LightsOut/LightsOut.exe from src/desktop.py. Run: .venv/Scripts/python scripts/build_exe.py [full|standard|lite]
A folder, not one file: a one-file exe unpacks ~0.5 GB to a temp dir on every launch, and .cache would land there.
Editions (what's bundled; anything left out streams at lower resolution until the in-app Download assets button fetches it):
  full      everything: core, skies, team cars, 4k/1k textures, satellite tiles (~1.1 GB), nothing to download
  standard  core, skies, full-size team cars (~520 MB); textures and tiles are the user's choice (Download assets). The default
  lite      core only (~200 MB), and the app opens on the light graphics tier (Low preset, 1k sky and photos), for weak machines"""
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
import assets  # noqa: E402

BUNDLED = {"full": ("hdri", "cars", "textures", "tiles"), "standard": ("hdri", "cars"), "lite": ()}
edition = sys.argv[1] if len(sys.argv) > 1 else "standard"
if edition not in BUNDLED:
    sys.exit(f"edition must be one of {', '.join(BUNDLED)}, not {edition!r}")
keep = BUNDLED[edition]
assets.core()
missing = {u: d for u, d in assets._missing().items() if d.relative_to(assets.ASSETS).parts[0] in keep}
with ThreadPoolExecutor(6) as pool:  # six at a time, as assets._run does: full's ~25,000 tiles take ~45 min
    failed = [u for u, r in zip(missing, pool.map(assets._one, missing.items())) if r == "failed"]
if failed:  # a release missing what it promises to bundle is worse than no release
    sys.exit(f"{len(failed)} downloads failed (first: {failed[0]}); run again to resume")
(ROOT / "build").mkdir(exist_ok=True)
(ROOT / "build" / "edition.txt").write_text(edition, encoding="utf8")  # paths.py EDITION reads it in the exe
dist = ROOT / "dist" / edition
PyInstaller.__main__.run([
    str(ROOT / "src" / "desktop.py"),
    "--name", "LightsOut", "--windowed", "--noconfirm",
    "--icon", str(ROOT / "src" / "static" / "lightsout.ico"),  # the LO badge, 16-256 px; the windows and taskbar take it from the exe
    "--paths", str(ROOT / "src"),
    "--add-data", f"{ROOT / 'src' / 'static'}:static",
    "--add-data", f"{ROOT / 'docs' / 'media'}:media",  # the offline trailer on Stream
    "--add-data", f"{ROOT / 'build' / 'edition.txt'}:.",
    "--collect-all", "onnx_asr",  # imported only at the first radio clip, so the analysis misses it
    # shortcut: CUDA's 2 GB of DLLs stay out, so radio transcription runs on the CPU (~4.5 s a clip); include them if that's too slow
    "--exclude-module", "nvidia",
    "--distpath", str(dist), "--workpath", str(ROOT / "build"), "--specpath", str(ROOT / "build"),
])
# a checkout may hold more than this edition bundles: drop the rest from the build
for heavy in {"hdri", "cars", "textures", "tiles"} - set(keep):
    shutil.rmtree(dist / "LightsOut" / "_internal" / "static" / "assets" / heavy, ignore_errors=True)
print(f"{edition}: {dist / 'LightsOut' / 'LightsOut.exe'}")
