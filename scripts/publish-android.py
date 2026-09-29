"""Attach the signed Android APK to its GitHub release.

The release itself is created by .github/workflows/release.yml when a v* tag
is pushed; the APK is built and signed on this PC (the keystore never leaves
it) and added here. The Android app's update check looks for an asset named
*android*.apk on the latest release (src/lib/updater.ts).

    python scripts/publish-android.py 0.21.0 path/to/NotezZz-0.21.0-android-arm64.apk

Token: GITHUB_TOKEN, else the repo's git credential store file
(~/.git-credentials-notezzz). Waits up to 30 min for the release to appear.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = "voodoofox/NotezZz"


def token() -> str:
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"]
    line = open(os.path.expanduser("~/.git-credentials-notezzz"), encoding="utf-8").read().strip()
    return urllib.parse.unquote(line.split(":", 2)[2].split("@")[0])


def api(method: str, url: str, tok: str, data: bytes | None = None, ctype: str | None = None):
    headers = {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"}
    if ctype:
        headers["Content-Type"] = ctype
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=300) as r:
        body = r.read()
        return json.loads(body) if body else None


def main() -> None:
    version, apk = sys.argv[1], sys.argv[2]
    tok = token()
    tag = f"v{version}"
    release = None
    for _ in range(60):
        try:
            release = api("GET", f"https://api.github.com/repos/{REPO}/releases/tags/{tag}", tok)
            break
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            print(f"waiting for release {tag}...", flush=True)
            time.sleep(30)
    if not release:
        sys.exit(f"release {tag} never appeared")

    name = f"NotezZz-{version}-android-arm64.apk"
    for a in release.get("assets", []):
        if a["name"] == name:
            api("DELETE", f"https://api.github.com/repos/{REPO}/releases/assets/{a['id']}", tok)
    upload = release["upload_url"].split("{")[0] + "?name=" + urllib.parse.quote(name)
    data = open(apk, "rb").read()
    asset = api("POST", upload, tok, data, "application/vnd.android.package-archive")
    print("uploaded", asset["name"], asset["size"], "bytes")
    print(asset["browser_download_url"])


if __name__ == "__main__":
    main()
