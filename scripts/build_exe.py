"""Builds dist/LightsOut/LightsOut.exe from src/desktop.py. Run: .venv/Scripts/python scripts/build_exe.py
A folder, not one file: a one-file exe unpacks ~0.5 GB to a temp dir on every launch, and .cache would land there."""
import shutil
import sys
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
import assets  # noqa: E402

assets.core()  # the exe ships core + skies inside static (scripts/fetch_assets.py fetches everything, for a checkout)
for url, dest in assets._missing().items():
    if dest.parent.name == "hdri":
        assets.fetch(url, dest)
PyInstaller.__main__.run([
    str(ROOT / "src" / "desktop.py"),
    "--name", "LightsOut", "--windowed", "--noconfirm",
    "--icon", str(ROOT / "src" / "static" / "lightsout.ico"),  # the LO badge, 16-256 px; the windows and taskbar take it from the exe
    "--paths", str(ROOT / "src"),
    "--add-data", f"{ROOT / 'src' / 'static'}:static",
    "--add-data", f"{ROOT / 'docs' / 'media'}:media",  # the offline trailer on Stream
    "--collect-all", "onnx_asr",  # imported only at the first radio clip, so the analysis misses it
    # shortcut: CUDA's 2 GB of DLLs stay out, so radio transcription runs on the CPU (~4.5 s a clip); include them if that's too slow
    "--exclude-module", "nvidia",
    "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build"), "--specpath", str(ROOT / "build"),
])
# the exe ships core + skies; textures and satellite tiles (~550 MB) come from the in-app Download assets button
for heavy in ("textures", "tiles"):
    shutil.rmtree(ROOT / "dist" / "LightsOut" / "_internal" / "static" / "assets" / heavy, ignore_errors=True)
