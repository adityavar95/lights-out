"""F1 TV videos of a race from F1 TV's public catalogue search (listing needs no sign-in).

Playback runs in the app: CONTENT/PLAY with the user's subscription token gives the stream, which shaka plays
through this server's licence proxy. A session's live stream and its replay are the same content id.
"""
import json
import re
import time
from datetime import date
import unicodedata
from urllib.parse import urlparse

import requests

from replay import CACHE, save

DISK = CACHE.parent / "f1tv"  # past seasons' weekends (videos)

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


# Jolpica's name -> F1 TV's, where they share no stem and the catalogue's season search (capped at ~30 results) can't find it
MEETING_ALIASES = {"Brazilian Grand Prix": "São Paulo Grand Prix"}


def _ascii(name: str) -> str:
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()


def _stem(name: str) -> str:
    """'Malaysian Grand Prix' and F1 TV's 'Malaysia Grand Prix' (or 'São Paulo' / 'Sao Paulo') both give 'malays'."""
    return _ascii(name).lower().replace(" ", "")[:6]


def _fresh(hit, year: int) -> bool:
    return bool(hit) and time.time() - hit[0] < (TTL if year >= date.today().year else 86400)  # a past season's catalogue is settled


def _meeting_names(year: int) -> set:
    """Every meeting name in a season's catalogue, one search per TTL: each weekend F1 TV names differently asks for it."""
    hit = _cache.get(("meetings", year))
    if _fresh(hit, year):
        return hit[1]
    names = {(c["metadata"].get("emfAttributes") or {}).get("Meeting_Name") for c in _search(filter_season=year)}
    _cache[("meetings", year)] = (time.time(), names)
    return names


def videos(year: int, race_name: str) -> list:
    """The race weekend's F1 TV videos: {id, title, kind, tier, start, end (ms, 0 for archive content), url,
    img (F1 TV's image resizer: add ?w=&h=), duration (s)}."""
    hit = _cache.get((year, race_name))
    if _fresh(hit, year):
        return hit[1]
    # A past season's weekend is kept on disk: every restart searched all ~24 again, and F1 TV blocks an IP after a few
    # hundred searches. The whole name, not _stem: United States and United States West share those six letters.
    # shortcut: a video F1 TV adds to a past season later isn't seen; delete .cache/f1tv to search again
    past = year < date.today().year and DISK / f"{year}_{re.sub(r'[^a-z0-9]', '', _ascii(race_name).lower())}.json"
    if past and past.exists():
        _cache[(year, race_name)] = (time.time(), json.loads(past.read_text()))
        return _cache[(year, race_name)][1]
    items = _search(filter_season=year, filter_Meeting_Name=race_name)
    if not items and race_name in MEETING_ALIASES:
        items = _search(filter_season=year, filter_Meeting_Name=MEETING_ALIASES[race_name])
    if not items:  # F1 TV names the meeting differently: find its name in the season's catalogue
        match = next((n for n in _meeting_names(year) if n and _stem(n) == _stem(race_name)), None)
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
    if past and out:
        save(past, out)
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


def play(content_id: int, channel_id: int | None, subscription_token: str, uhd: bool = False, tries: int = 5,
         override: str = "HDR_UHD_DASH") -> dict:
    """{url, streamType, laURL, entitlementToken}: the manifest url is signed for this play and expires.
    uhd: F1 TV's 4K HDR stream type (F1 TV Premium), asked for with the header its web player's developer settings use
    (x-f1-override-video-stream); its manifest adds 1620p and 2160p50 HEVC Main10 to the main feed's renditions.
    F1 TV hands out its CDNs at random per play (measured on a live session: ~1 in 3 on f1prodlive.akamaized.net). Akamai
    doesn't allow this page's localhost origin, so the browser couldn't fetch the manifest (shaka 1002) and a feed failed
    at random; formula1.com's own CDN does. An Akamai answer is asked again, up to `tries` plays in all."""
    params = {"contentId": content_id, **({"channelId": channel_id} if channel_id else {})}
    headers = {"User-Agent": UA, "ascendontoken": subscription_token, **({"x-f1-override-video-stream": override} if uhd else {})}
    r = requests.get(f"{API}/CONTENT/PLAY", params=params, headers=headers, timeout=(5, 20))
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    o = body.get("resultObj") or {}
    if uhd and not r.ok and override == "HDR_UHD_DASH":  # no 4K rights (every video before 2025): the same video in HD
        return play(content_id, channel_id, subscription_token, tries=tries)
    if not r.ok or not o.get("url"):
        raise F1TVError(body.get("message") or f"F1 TV play request failed ({r.status_code})")
    if tries > 1 and not (urlparse(o["url"]).hostname or "").endswith(".formula1.com"):
        return play(content_id, channel_id, subscription_token, uhd, tries - 1, override)
    kind = o.get("streamType") or ""
    if uhd and override == "HDR_UHD_DASH" and kind.endswith("WV") and "UHD" not in kind:
        # A live stream is Widevine (streamType SDR_HD_DASHWV), and HDR_UHD_DASH gave it in HD (Mexico FP1 2026, every
        # try). F1 TV's naming suggests its 4K one is HDR_UHD_DASHWV: asked for, and kept only if F1 TV answers with UHD.
        # shortcut: that name is a guess from the naming; drop this once a live 4K session shows what F1 TV calls it
        try:
            alt = play(content_id, channel_id, subscription_token, uhd, tries, "HDR_UHD_DASHWV")
            if "UHD" in (alt.get("streamType") or ""):
                return alt
        except F1TVError:
            pass
    return {k: o.get(k) for k in ("url", "streamType", "laURL", "entitlementToken")}


def license(url: str, challenge: bytes, subscription_token: str, entitlement_token: str | None) -> tuple:
    """A Widevine licence for a live stream: (status, body, content type) from F1 TV's licence server, asked with the
    account's tokens. The page's own request was cross-origin from localhost and carried only the entitlement token
    (MultiViewer, a desktop app, makes it outside any browser). url comes from the page, so only F1's hosts are asked."""
    u = urlparse(url)
    if u.scheme != "https" or not (u.hostname == "formula1.com" or (u.hostname or "").endswith(".formula1.com")):
        raise F1TVError(f"Not an F1 TV licence server: {u.hostname}")
    headers = {"User-Agent": UA, "ascendontoken": subscription_token, "Content-Type": "application/octet-stream",
               **({"entitlementtoken": entitlement_token} if entitlement_token else {})}
    # no redirects: requests would carry ascendontoken (not a header it strips) to whatever host one named
    r = requests.post(url, data=challenge, headers=headers, timeout=(5, 20), allow_redirects=False)
    return r.status_code, r.content, r.headers.get("content-type", "application/octet-stream")


class F1TVError(Exception):
    pass
