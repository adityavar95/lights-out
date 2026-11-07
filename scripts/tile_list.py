"""Regenerates src/static/tile_list.json, the satellite tiles the download offers, by asking tile_list.mjs at every circuit with a
real-world outline, at its latest race. Run when a new circuit joins the calendar (needs node and network); until then
that circuit's tiles just come from Esri. Run: .venv/Scripts/python scripts/tile_list.py"""
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
from fastapi import HTTPException
from server import race_geo, race_track, races

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
tiles = subprocess.run(["node", str(ROOT / "scripts" / "tile_list.mjs")], input=json.dumps(out), capture_output=True, text=True,
                       encoding="utf8", check=True).stdout
(ROOT / "src" / "static" / "tile_list.json").write_text(tiles, encoding="utf8")
print(f"{len(json.loads(tiles))} tiles at {len(out)} circuits")
