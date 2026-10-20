"""Wait for the Mac CI build of a commit, fetch its .dmg artifact and attach it
to the GitHub release as NotezZz-<ver>-mac.dmg and NotezZz-Mac.dmg.

    python scripts/publish-mac.py <version> <full mac-branch sha> <download-dir>

Run after the mac branch (rebased onto the release commit) is pushed; the
Mac job on GitHub Actions (.github/workflows/mac.yml on that branch) builds the
.dmg as a run artifact. The sha must be the full 40 characters (the runs API
filter ignores a short one). Token as in publish-android.py.
"""
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPO = "voodoofox/NotezZz"


def token() -> str:
    line = open(os.path.expanduser("~/.git-credentials-notezzz"), encoding="utf-8").read().strip()
    return urllib.parse.unquote(line.split(":", 2)[2].split("@")[0])


def api(method, url, tok, data=None, ctype=None, raw=False):
    headers = {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"}
    if ctype:
        headers["Content-Type"] = ctype
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=600) as r:
        body = r.read()
        if raw:
            return body
        return json.loads(body) if body else None


def main():
    version, sha, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    tok = token()
    base = f"https://api.github.com/repos/{REPO}"

    run = None
    for _ in range(120):
        runs = api("GET", f"{base}/actions/runs?branch=mac&head_sha={sha}&per_page=5", tok)["workflow_runs"]
        runs = [r for r in runs if r["name"] == "Mac test build"]
        if runs and runs[0]["status"] == "completed":
            run = runs[0]
            break
        print("mac run:", runs[0]["status"] if runs else "not started", flush=True)
        time.sleep(30)
    if not run:
        sys.exit("mac run never finished")
    if run["conclusion"] != "success":
        sys.exit(f"mac run {run['id']} ended with {run['conclusion']}: {run['html_url']}")

    arts = api("GET", f"{base}/actions/runs/{run['id']}/artifacts", tok)["artifacts"]
    art = next(a for a in arts if a["name"] == "NotezZz-mac")
    # The artifact URL redirects to blob storage, which rejects the GitHub
    # token: take the redirect ourselves and fetch the target without it.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    req = urllib.request.Request(art["archive_download_url"], headers={"Authorization": f"Bearer {tok}"})
    try:
        urllib.request.build_opener(NoRedirect).open(req, timeout=60)
        sys.exit("expected a redirect for the artifact")
    except urllib.error.HTTPError as e:
        if e.code not in (301, 302, 303, 307):
            raise
        target = e.headers["Location"]
    with urllib.request.urlopen(target, timeout=600) as r:
        blob = r.read()
    os.makedirs(outdir, exist_ok=True)
    z = zipfile.ZipFile(io.BytesIO(blob))
    dmg_name = next(n for n in z.namelist() if n.endswith(".dmg"))
    dmg_path = os.path.join(outdir, f"NotezZz-{version}-mac.dmg")
    with open(dmg_path, "wb") as f:
        f.write(z.read(dmg_name))
    print("dmg:", dmg_name, os.path.getsize(dmg_path), "bytes ->", dmg_path, flush=True)

    release = None
    for _ in range(60):
        try:
            release = api("GET", f"{base}/releases/tags/v{version}", tok)
            break
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            print("waiting for release...", flush=True)
            time.sleep(30)
    if not release:
        sys.exit("release never appeared")

    data = open(dmg_path, "rb").read()
    for name in (f"NotezZz-{version}-mac.dmg", "NotezZz-Mac.dmg"):
        for a in release.get("assets", []):
            if a["name"] == name:
                api("DELETE", f"{base}/releases/assets/{a['id']}", tok)
        upload = release["upload_url"].split("{")[0] + "?name=" + urllib.parse.quote(name)
        asset = api("POST", upload, tok, data, "application/x-apple-diskimage")
        print("uploaded", asset["name"], asset["size"], "bytes", asset["browser_download_url"], flush=True)


if __name__ == "__main__":
    main()
