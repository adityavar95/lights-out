"""Downloads every asset into src/static/assets, resuming what's already there (build_exe.py fetches only core, skies and the team cars).
The app offers the same download itself (downloads.js). Run: .venv/Scripts/python scripts/fetch_assets.py"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import assets

assets.core()
assets.start()
while (s := assets.status())["state"] == "running":
    print(f"{s['done']} / {s['total']} files, {s['failed']} failed", flush=True)
    time.sleep(10)
if s["state"] != "done":
    sys.exit(f"{s['failed']} files failed: run this again to fetch the rest")
sizes = [p.stat().st_size for p in assets.ASSETS.rglob("*") if p.is_file()]
print(f"{len(sizes)} files, {sum(sizes) / 1e6:.0f} MB in {assets.ASSETS}")
