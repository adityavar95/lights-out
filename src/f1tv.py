"""F1 TV videos of a race from F1 TV's public catalogue search (listing needs no sign-in).

Playback stays on f1tv.formula1.com: its streams are DRM-protected and the site refuses to be framed
(X-Frame-Options: SAMEORIGIN), so the browser opens each video there, signed in with the user's F1 TV subscription.
A session's live stream and its replay are the same content id.
"""
import time
from datetime import date
import unicodedata

import requests

SEARCH = "https://f1tv.formula1.com/2.0/R/ENG/WEB_DASH/ALL/PAGE/SEARCH/VOD/F1_TV_Pro_Annual/2"
SITE = "https://f1tv.formula1.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
TTL = 300  # s: a race weekend's catalogue grows as sessions are added
_cache = {}


def _search(**filters) -> list:
    r = requests.get(SEARCH, params={"filter_Series": "FORMULA 1", **filters}, headers={"User-Agent": UA}, timeout=(5, 20))
    if r.status_code == 404:  # F1 TV's answer to a search with no results
        return []
    r.raise_for_status()
    return (r.json().get("resultObj") or {}).get("containers") or []


def _stem(name: str) -> str:
    """'Malaysian Grand Prix' and F1 TV's 'Malaysia Grand Prix' (or 'São Paulo' / 'Sao Paulo') both give 'malays'."""
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower().replace(" ", "")[:6]


def videos(year: int, race_name: str) -> list:
    """The race weekend's F1 TV videos: {id, title, kind, tier, start, end (ms, 0 for archive content), url,
    img (F1 TV's image resizer: add ?w=&h=), duration (s)}."""
    hit = _cache.get((year, race_name))
    if hit and time.time() - hit[0] < (TTL if year >= date.today().year else 86400):  # a past season's catalogue is settled
        return hit[1]
    items = _search(filter_season=year, filter_Meeting_Name=race_name)
    if not items:  # F1 TV names the meeting differently: find its name in the season's catalogue
        names = {(c["metadata"].get("emfAttributes") or {}).get("Meeting_Name") for c in _search(filter_season=year)}
        match = next((n for n in names if n and _stem(n) == _stem(race_name)), None)
        items = _search(filter_season=year, filter_Meeting_Name=match) if match else []
    out = []
    for c in items:
        m, href = c["metadata"], next((a.get("href") for a in c.get("actions") or [] if a.get("href")), None)
        if not href:
            continue
        e = m.get("emfAttributes") or {}
        out.append({"id": m["contentId"], "title": m.get("title"), "kind": m.get("contentSubtype"), "tier": m.get("entitlement"),
                    "start": e.get("sessionStartDate") or 0, "end": e.get("sessionEndDate") or 0, "url": SITE + href,
                    "img": m.get("pictureUrl") and f"{SITE}/image-resizer/image/{m['pictureUrl']}", "duration": m.get("duration") or 0})
    out.sort(key=lambda v: (v["kind"] != "REPLAY", v["start"] or float("inf"), v["title"] or ""))
    _cache[(year, race_name)] = (time.time(), out)
    return out


# Playback, as MultiViewer does it: the content's channels (main feed, F1 LIVE, tracker, data, driver onboards) from
# the public content API, then CONTENT/PLAY with the account's subscription token (f1auth) for a signed DASH manifest
# that the browser plays itself. The manifest CDN allows localhost origins; replays carry no DRM.
API = "https://f1tv.formula1.com/2.0/R/ENG/WEB_DASH/ALL"


def channels(content_id: int) -> dict:
    hit = _cache.get(("channels", content_id))  # a video's channel list doesn't change: saves ~0.7 s per viewer open
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    r = requests.get(f"{API}/CONTENT/VIDEO/{content_id}/F1_TV_Pro_Annual/2", headers={"User-Agent": UA}, timeout=(5, 20))
    r.raise_for_status()
    m = r.json()["resultObj"]["containers"][0]["metadata"]
    # INTERNATIONAL is the content's own feed: by its channelId, 2024 and older races answer "No Data Found in DB"
    streams = [{"channelId": None if s.get("title") == "INTERNATIONAL" else s.get("channelId"), "title": s.get("title"), "type": s.get("type"), "number": s.get("racingNumber") or None,
                "driver": " ".join(filter(None, (s.get("driverFirstName"), s.get("driverLastName")))) or None,
                "team": s.get("teamName") or None, "hex": s.get("hex")} for s in m.get("additionalStreams") or []]
    out = {"id": content_id, "title": m.get("title"), "streams": streams or [{"channelId": None, "title": "MAIN", "type": "main"}]}
    _cache[("channels", content_id)] = (time.time(), out)
    return out


def play(content_id: int, channel_id: int | None, subscription_token: str, uhd: bool = False) -> dict:
    """{url, streamType, laURL, entitlementToken}: the manifest url is signed for this play and expires.
    uhd: F1 TV's 4K HDR stream type (F1 TV Premium), asked for with the header its web player's developer settings use
    (x-f1-override-video-stream); its manifest adds 1620p and 2160p50 HEVC Main10 to the main feed's renditions."""
    params = {"contentId": content_id, **({"channelId": channel_id} if channel_id else {})}
    headers = {"User-Agent": UA, "ascendontoken": subscription_token, **({"x-f1-override-video-stream": "HDR_UHD_DASH"} if uhd else {})}
    r = requests.get(f"{API}/CONTENT/PLAY", params=params, headers=headers, timeout=(5, 20))
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    o = body.get("resultObj") or {}
    if uhd and not r.ok:  # no 4K rights (every video before 2025): the same video in HD
        return play(content_id, channel_id, subscription_token)
    if not r.ok or not o.get("url"):
        raise F1TVError(body.get("message") or f"F1 TV play request failed ({r.status_code})")
    return {k: o.get(k) for k in ("url", "streamType", "laURL", "entitlementToken")}


class F1TVError(Exception):
    pass
