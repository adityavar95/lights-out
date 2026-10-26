"""F1 TV sign-in for live timing: the subscription token that unlocks car GPS (Position.z) and telemetry (CarData.z).

Same flow as FastF1's f1account (MIT, github.com/theOehrly/Fast-F1): OAuth2 Authorization Code + PKCE against
F1's PingOne identity provider, whose DaVinci username/password form runs as JSON calls (response_mode=pi.flow).
Credentials come from .cache/f1_account.json, or the environment variables F1_USERNAME / F1_PASSWORD; or set
F1_TOKEN to a subscription token directly. There is no refresh token: when the token expires, sign in again.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import time
from pathlib import Path

import requests

IDP = "https://id.formula1.com"
CONFIG_SCRIPT = "https://account.formula1.com/scripts/main.min.js"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
PING = {"X-Requested-With": "ping-sdk"}  # JSON instead of HTML from the DaVinci flow
CACHE = Path(__file__).resolve().parent.parent / ".cache" / "f1_token.json"
TIMEOUT = (5, 30)
ACCOUNT = CACHE.parent / "f1_account.json"  # {"username": ..., "password": ...}: kept out of the source tree


def _account() -> tuple:
    try:
        a = json.loads(ACCOUNT.read_text())
        return a.get("username"), a.get("password")
    except (OSError, ValueError, AttributeError):
        return None, None


# your F1 account (F1 TV subscription); environment variables F1_USERNAME / F1_PASSWORD override these
USERNAME, PASSWORD = _account()
RETRY = 600  # s before signing in again after a failure, so a wrong password can't lock the account

status = {"error": None, "failed_at": 0.0}

class F1AuthError(Exception):
    pass


def claims(jwt: str) -> dict:
    """Unverified JWT payload (livetiming verifies the signature)."""
    part = jwt.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def _valid(token: str | None) -> bool:
    try:
        return claims(token)["exp"] - 300 > time.time()
    except Exception:
        return False


def token() -> str | None:
    """A valid subscription token, or None: no F1 account configured, or within RETRY s of a failed sign-in or of a
    token F1 rejected (so a bad password or token can't cause a sign-in on every reconnect)."""
    if time.time() - status["failed_at"] < RETRY:
        return None
    if _valid(env := os.environ.get("F1_TOKEN")):
        return env
    try:
        cached = json.loads(CACHE.read_text())["token"]
        if _valid(cached):
            return cached
    except (OSError, ValueError, KeyError):
        pass
    user, password = os.environ.get("F1_USERNAME") or USERNAME, os.environ.get("F1_PASSWORD") or PASSWORD
    if not (user and password):
        return None
    try:
        t = login(user, password)
    except Exception as e:
        status.update(error=f"F1 TV sign-in failed: {e}", failed_at=time.time())
        return None
    status["error"] = None
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"token": t}))
    return t


def clear():
    CACHE.unlink(missing_ok=True)


def login(username: str, password: str) -> str:
    with requests.Session() as s:  # the identity provider ties the steps together with cookies
        s.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
        # client id and DaVinci policy are app settings of the account site's frontend, so read them from there
        obj = re.search(r"\bdavinci:\{([^}]*)\}", s.get(CONFIG_SCRIPT, timeout=TIMEOUT).text)
        field = lambda name: (m := obj and re.search(rf'\b{name}:"([^"]+)"', obj.group(1))) and m.group(1)
        client_id, policy = field("clientId"), field("acrValues")
        if not (client_id and policy):
            raise F1AuthError("F1 sign-in config not found on account.formula1.com")

        verifier, state = secrets.token_urlsafe(64), secrets.token_urlsafe(24)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        r = s.get(f"{IDP}/as/authorize", headers=PING, timeout=TIMEOUT, params={
            "client_id": client_id, "response_type": "code", "response_mode": "pi.flow", "scope": "openid",
            "state": state, "nonce": secrets.token_urlsafe(24), "code_challenge": challenge,
            "code_challenge_method": "S256", "acr_values": policy})
        r.raise_for_status()
        form = r.json()
        try:
            url, iid = form["_links"]["next"]["href"], form["interactionId"]
            flow, event = form["id"], form["eventName"]
        except (KeyError, TypeError):
            raise F1AuthError("Unexpected response when starting the F1 sign-in") from None
        if not url.startswith(f"{IDP}/"):  # never send the password anywhere else
            raise F1AuthError(f"Unexpected sign-in url {url}")

        r = s.post(url, headers={**PING, "interactionId": iid}, timeout=TIMEOUT, json={
            "id": flow, "eventName": event, "interactionId": iid,
            "parameters": {"eventType": "submit", "data": {"actionKey": "SIGNIN",
                                                           "formData": {"username": username, "password": password}}}})
        data = r.json()
        if data.get("status") != "COMPLETED":  # e.g. wrong password; the message is meant for the user
            raise F1AuthError(data.get("message") or f"F1 sign-in failed ({r.status_code})")
        auth = data.get("authorizeResponse") or {}
        if auth.get("state") != state or not auth.get("code"):
            raise F1AuthError("F1 sign-in returned no authorization code")

        r = s.post(f"{IDP}/as/token", timeout=TIMEOUT, data={
            "grant_type": "authorization_code", "client_id": client_id, "code": auth["code"], "code_verifier": verifier})
        r.raise_for_status()
    sub = claims(r.json()["access_token"]).get("subscriptionToken")
    if not sub:
        raise F1AuthError("This F1 account has no active F1 TV subscription")
    return sub
