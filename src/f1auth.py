"""F1 TV sign-in, the way MultiViewer does it: you sign in on F1's own site, which keeps your subscription token in its
`login-session` cookie (domain .formula1.com, readable by page scripts). The Connect bookmarklet (multiviewer.js) reads
it there and brings it back in this app's URL fragment; the page keeps it for that tab (sessionStorage) and sends it as
the X-F1-Token header. The server never stores it or a password: each request uses the caller's own token.
"""
import base64
import json
import time


def claims(jwt: str) -> dict:
    """Unverified JWT payload (F1 verifies the signature)."""
    part = jwt.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def valid(token: str | None) -> str | None:
    """The token if it's an unexpired subscription token, else None."""
    try:
        return token if claims(token)["exp"] - 300 > time.time() else None
    except Exception:
        return None
