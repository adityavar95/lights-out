"""Where the app writes. In a checkout that's .cache beside src. In the exe it's %LOCALAPPDATA%\LightsOut, because the
exe's own folder can be Program Files, which isn't writable."""
import os
import sys
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
# the build_exe.py edition (full, standard or lite) the exe was built as; a checkout is "dev"
EDITION = (Path(sys._MEIPASS) / "edition.txt").read_text(encoding="utf8").strip() if FROZEN else "dev"
DATA = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "LightsOut" if FROZEN else Path(__file__).resolve().parent.parent / ".cache"
