"""Builds dist/LightsOut/LightsOut.exe from src/desktop.py. Run: .venv/Scripts/python scripts/build_exe.py
A folder, not one file: a one-file exe unpacks ~0.5 GB to a temp dir on every launch, and .cache would land there."""
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parent.parent
PyInstaller.__main__.run([
    str(ROOT / "src" / "desktop.py"),
    "--name", "LightsOut", "--windowed", "--noconfirm",
    "--icon", str(ROOT / "scripts" / "lightsout.ico"),  # the LO badge, 16-256 px; the windows and taskbar take it from the exe
    "--paths", str(ROOT / "src"),
    "--add-data", f"{ROOT / 'src' / 'static'}:static",
    "--collect-all", "faster_whisper",  # imported only at the first radio clip, so the analysis misses it
    "--collect-all", "livef1",
    # shortcut: CUDA's 2 GB of DLLs stay out, so radio transcription runs on the CPU (~4.5 s a clip); include them if that's too slow
    "--exclude-module", "nvidia",
    "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build"), "--specpath", str(ROOT / "build"),
])
