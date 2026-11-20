"""Where the app writes. In a checkout that's .cache beside src. In the exe it's %LOCALAPPDATA%\LightsOut, because the
exe's own folder can be Program Files, which isn't writable."""
import os
import sys
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
DATA = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "LightsOut" if FROZEN else Path(__file__).resolve().parent.parent / ".cache"
