"""Minimal Braintrust REST client (stdlib only).

The API key is read from the BRAINTRUST_API_KEY environment variable, or else
from the BRAINTRUST... line of ../../API_keys.txt (the file the Braintrust
wizard generated). It is never printed or written anywhere else.
"""
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request

API = "https://api.braintrust.dev"
KEYFILE = os.path.join(os.path.dirname(__file__), "..", "..", "API_keys.txt")

# This machine's certificate store rejects some TLS chains (curl exit 60,
# winget 0x8a15005e), so verification is relaxed for these read-only calls.
CTX = ssl._create_unverified_context()


def api_key():
    if os.environ.get("BRAINTRUST_API_KEY"):
        return os.environ["BRAINTRUST_API_KEY"]
    with open(KEYFILE, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"\s*BRAINTRUST\w*\s*=\s*(\S+)", line)
            if m:
                return m.group(1)
    raise SystemExit("No Braintrust key: set BRAINTRUST_API_KEY or add it to API_keys.txt")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=CTX))


def call(method, path, body=None):
    for attempt in range(8):
        req = urllib.request.Request(
            API + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": "Bearer " + api_key(), "Content-Type": "application/json"})
        try:
            with _OPENER.open(req, timeout=180) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                # Large responses are handed off to a presigned URL; fetch it without our auth header.
                with urllib.request.urlopen(e.headers["Location"], context=CTX, timeout=180) as r:
                    return json.load(r)
            if e.code == 429:
                time.sleep(int(e.headers.get("Retry-After") or 0) or 5 * (attempt + 1))
                continue
            raise RuntimeError(f"Braintrust {method} {path}: HTTP {e.code}: {e.read()[:300]!r}")
    raise RuntimeError("Braintrust kept rate-limiting; try again in a minute")


def project_id(name):
    for p in call("GET", "/v1/project?limit=100")["objects"]:
        if p["name"] == name:
            return p["id"]
    raise SystemExit(f"No Braintrust project named {name!r}")


def fetch_logs(pid, page=200):
    rows, cursor = [], None
    while True:
        body = {"limit": page}
        if cursor:
            body["cursor"] = cursor
        r = call("POST", f"/v1/project_logs/{pid}/fetch", body)
        rows += r["events"]
        cursor = r.get("cursor")
        if not cursor or not r["events"]:
            return rows
