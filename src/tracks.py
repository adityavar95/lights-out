"""Track outlines: MultiViewer (the same source livef1 uses, F1 timing coordinates), else an OpenF1 lap (same
coordinates), else GeoJSON."""
import math
from functools import lru_cache

import requests

MV_URL = "https://api.multiviewer.app/api/v1/circuits"
MV_HEADERS = {"User-Agent": "LiveF1/user"}
GEOJSON_URL = "https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson"

# Jolpica circuitId -> MultiViewer circuitKey
MV_KEYS = {
    "silverstone": 2, "hungaroring": 4, "imola": 6, "spa": 7, "americas": 9, "albert_park": 10,
    "interlagos": 14, "catalunya": 15, "red_bull_ring": 19, "monaco": 22, "villeneuve": 23, "ricard": 28,
    "hockenheimring": 34, "monza": 39, "suzuka": 46, "shanghai": 49, "zandvoort": 55, "istanbul": 59,
    "marina_bay": 61, "bahrain": 63, "rodriguez": 65, "yas_marina": 70, "nurburgring": 72, "sochi": 79,
    "baku": 144, "mugello": 146, "portimao": 147, "jeddah": 149, "losail": 150, "miami": 151, "vegas": 152,
}
MV_IDS = {v: k for k, v in MV_KEYS.items()}

# shortcut: typical track width in metres per Jolpica circuitId (real widths vary along the lap, e.g. Baku narrows to
# 7.6 m at the castle); FIA asks 12 m minimum for new circuits, so unknown circuits get 13 m. Bahrain, Jeddah, Losail,
# Shanghai, Yas Marina, Spa, Villeneuve and the Red Bull Ring are measured: the white edge lines' spacing on the main
# straights in Esri imagery (Oct 2026) + 0.85 m, as circuit3d.js draws the lines 0.25-0.6 m in from the edge.
WIDTHS = {
    "monaco": 9, "baku": 11, "marina_bay": 11, "zandvoort": 10.5, "suzuka": 11, "imola": 11, "villeneuve": 10.5,
    "hungaroring": 12, "jeddah": 13, "albert_park": 12, "interlagos": 12, "spa": 11.5, "losail": 15.5, "monza": 13,
    "catalunya": 13, "red_bull_ring": 12.5, "rodriguez": 13, "miami": 13, "mugello": 13, "nurburgring": 13,
    "hockenheimring": 13, "vegas": 14, "americas": 14, "yas_marina": 14.5, "shanghai": 15.5, "sochi": 14, "ricard": 14,
    "portimao": 14, "istanbul": 14, "valencia": 14, "buddh": 14, "silverstone": 15, "bahrain": 14, "yeongam": 15,
    "sepang": 16,
}
DEFAULT_WIDTH = 13


def _get(url: str, **kw):
    r = requests.get(url, timeout=30, **kw)
    r.raise_for_status()
    return r.json()


@lru_cache(maxsize=None)
def _mv_years() -> dict:
    return {int(k): v["years"] for k, v in _get(MV_URL, headers=MV_HEADERS).items()}


def _clean_loop(x: list, y: list, idx: list) -> tuple:
    """Tidy a closed outline: drop points under 1 m from the previous kept one (duplicates make zero-length segments and
    false curvature), and trim the tail where the recorded lap runs past its own start (the overlap kinks the loop shut).
    idx: outline indices to remap (mini-sectors). Returns (x, y, remapped idx)."""
    keep = [0]
    for i in range(1, len(x)):
        if math.hypot(x[i] - x[keep[-1]], y[i] - y[keep[-1]]) >= 10:  # decimetres
            keep.append(i)
    # a point the outline doubles back at (over 150 degrees between its two segments): Monaco's ran 2.4 m backwards and on
    # again near Rascasse, a zig-zag that folded the road mesh. A real hairpin turns ~40 degrees a point at most.
    k = 1
    while k < len(keep) - 1 and len(keep) > 3:
        a, b, c = keep[k - 1], keep[k], keep[k + 1]
        ux, uy, vx, vy = x[b] - x[a], y[b] - y[a], x[c] - x[b], y[c] - y[b]
        if ux * vx + uy * vy < -0.866 * math.hypot(ux, uy) * math.hypot(vx, vy):
            del keep[k]
            k = max(1, k - 1)  # the point before may double back now
        else:
            k += 1
    tail = keep[max(len(keep) // 2, len(keep) - 12):]  # the point closest to the start among the last few is where the lap closed
    close = min(tail, key=lambda i: math.hypot(x[i] - x[0], y[i] - y[0]))
    if math.hypot(x[close] - x[0], y[close] - y[0]) < 30:
        keep = keep[:keep.index(close)]  # the start point itself closes the loop
    # and any point still past the start along the first segment (Baku's ran 4 m past it, a doubled-back hairpin)
    fx, fy = x[keep[1]] - x[0], y[keep[1]] - y[0]
    while len(keep) > 3 and (x[keep[-1]] - x[0]) * fx + (y[keep[-1]] - y[0]) * fy > 0 and math.hypot(x[keep[-1]] - x[0], y[keep[-1]] - y[0]) < 300:
        keep.pop()
    new = {old: n for n, old in enumerate(keep)}
    remap = [new.get(i, min((n for old, n in new.items() if old >= i), default=len(keep) - 1)) for i in idx]
    return [x[i] for i in keep], [y[i] for i in keep], remap


@lru_cache(maxsize=None)
def _mv_track(key: int, year: int) -> dict:
    d = _get(f"{MV_URL}/{key}/{year}", headers=MV_HEADERS)
    x, y, minisectors = _clean_loop(d["x"], d["y"], d.get("miniSectorsIndexes", []))
    return {
        "source": "multiviewer",
        "x": x, "y": y, "rotation": d.get("rotation", 0),
        "corners": [{"number": c["number"], "angle": c.get("angle", 0), **c["trackPosition"]} for c in d.get("corners", [])],
        "minisectors": minisectors,  # outline index of each mini-sector boundary after the line
        "pitLoss": d.get("pitLoss"),  # seconds lost to a stop: normal / sc / vsc
    }


@lru_cache(maxsize=None)
def _geojson() -> list:
    return _get(GEOJSON_URL)["features"]


def _geo_track(lat: float, lng: float) -> dict | None:
    """Nearest GeoJSON circuit within 5 km, projected to local metres (x east, y north)."""
    def dist_km(f):
        pts = f["geometry"]["coordinates"]
        clng, clat = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        return math.hypot((clng - lng) * 111.32 * math.cos(math.radians(lat)), (clat - lat) * 110.57)

    best = min(_geojson(), key=dist_km, default=None)
    if best is None or dist_km(best) > 5:
        return None
    pts = best["geometry"]["coordinates"]
    kx = 111320 * math.cos(math.radians(lat))
    # shortcut: GeoJSON gives no start line or driving direction, so lap-based replays may run the wrong way round
    return {"source": "geojson", "x": [(p[0] - lng) * kx for p in pts], "y": [(p[1] - lat) * 110570 for p in pts],
            "rotation": 0, "corners": []}


def mv_track(key: int, year: int) -> dict | None:
    years = sorted(_mv_years().get(key, []))
    if not years:
        return None
    # layouts change over time, so use the newest MultiViewer layout not newer than the race
    t = _mv_track(key, max([y for y in years if y <= year] or [years[0]]))
    return {**t, "width": WIDTHS.get(MV_IDS.get(key), DEFAULT_WIDTH)}


def lap_track(x: list, y: list) -> dict:
    """Outline from one OpenF1 lap of a car's positions: F1 timing coordinates like MultiViewer's, starting at the line,
    but no corner numbers or map rotation."""
    x, y, _ = _clean_loop(x, y, [])
    return {"source": "openf1", "x": x, "y": y, "rotation": 0, "corners": []}


def track(circuit_id: str, year: int, lat: float, lng: float, lap=lambda: None) -> dict | None:
    """lap: () -> an OpenF1 lap {x, y} at this circuit or None, tried when MultiViewer hasn't got the circuit."""
    key = MV_KEYS.get(circuit_id)
    t = mv_track(key, year) if key else None
    if t is None and (positions := lap()):
        t = lap_track(positions["x"], positions["y"])
    t = t or _geo_track(lat, lng)
    return t and {**t, "width": WIDTHS.get(circuit_id, DEFAULT_WIDTH), "circuitId": circuit_id}
