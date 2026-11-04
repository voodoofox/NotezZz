"""Send the Google Play build to a track of the Play listing.

The bundle is built and signed on this PC by scripts/build-play.sh; this
uploads it through the Google Play Developer API as a service account that
has release rights on the app in Play Console (Manage account > Users and
permissions). The key file never enters the repo: its path is read from
PLAY_SERVICE_ACCOUNT_FILE, else from the gitignored play.env next to
package.json (PLAY_SERVICE_ACCOUNT_FILE=<path>).

    python scripts/publish-play.py 0.44.0 ../releases/NotezZz-0.44.0-play.aab
    python scripts/publish-play.py 0.44.0 ../releases/NotezZz-0.44.0-play.aab --track production --rollout 0.2
    python scripts/publish-play.py --tracks          # a dry run: sign in, list the tracks, upload nothing

--track   alpha (the closed test, the default) or production.
--notes   the release notes: a file path or the text itself. Play keeps at
          most 500 characters per language; longer notes are cut at a line end.
--rollout a fraction of users for a staged production rollout (0.2 = 20%);
          without it the release goes to everyone at once.
"""

import argparse
import os
import sys
import time

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

PACKAGE = "com.flatvoxel.notezzz"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"
NOTES_LIMIT = 500


def key_file() -> str:
    path = os.environ.get("PLAY_SERVICE_ACCOUNT_FILE")
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "play.env")
    if not path and os.path.exists(env):
        for line in open(env, encoding="utf-8"):
            name, _, value = line.strip().partition("=")
            if name == "PLAY_SERVICE_ACCOUNT_FILE":
                path = value.strip().strip('"')
    if not path or not os.path.exists(path):
        sys.exit("no service account key: set PLAY_SERVICE_ACCOUNT_FILE or write play.env")
    return path


def service():
    creds = service_account.Credentials.from_service_account_file(key_file(), scopes=[SCOPE])
    return build("androidpublisher", "v3", credentials=creds, cache_discovery=False)


def trim_notes(text: str) -> str:
    text = text.strip()
    if len(text) <= NOTES_LIMIT:
        return text
    cut = text.rfind(chr(10), 0, NOTES_LIMIT - 1)
    return text[: cut if cut > 0 else NOTES_LIMIT - 1].rstrip() + chr(8230)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("version", nargs="?")
    ap.add_argument("aab", nargs="?")
    ap.add_argument("--track", default="alpha")
    ap.add_argument("--notes")
    ap.add_argument("--rollout", type=float)
    ap.add_argument("--tracks", action="store_true", help="dry run: list the tracks and stop")
    args = ap.parse_args()

    edits = service().edits()
    edit_id = edits.insert(packageName=PACKAGE, body={}).execute()["id"]
    try:
        if args.tracks or not args.aab:
            for t in edits.tracks().list(packageName=PACKAGE, editId=edit_id).execute().get("tracks", []):
                rel = t.get("releases", [{}])[0]
                print(f"{t['track']:12} {rel.get('status', '-'):10} {rel.get('name', '-')} codes={rel.get('versionCodes', [])}")
            return

        notes = ""
        if args.notes:
            notes = open(args.notes, encoding="utf-8").read() if os.path.exists(args.notes) else args.notes
        print("uploading", args.aab, os.path.getsize(args.aab), "bytes", flush=True)
        media = MediaFileUpload(args.aab, mimetype="application/octet-stream", resumable=True)
        bundle = edits.bundles().upload(packageName=PACKAGE, editId=edit_id, media_body=media).execute()
        code = bundle["versionCode"]
        print("bundle version code", code)

        release = {"name": args.version, "versionCodes": [str(code)], "status": "completed"}
        if args.rollout:
            release.update(status="inProgress", userFraction=args.rollout)
        if notes:
            release["releaseNotes"] = [{"language": "en-US", "text": trim_notes(notes)}]
        edits.tracks().update(packageName=PACKAGE, editId=edit_id, track=args.track, body={"releases": [release]}).execute()
        edits.validate(packageName=PACKAGE, editId=edit_id).execute()
        edits.commit(packageName=PACKAGE, editId=edit_id).execute()
        edit_id = None
        print(f"released {args.version} ({code}) to {args.track}" + (f", {args.rollout:.0%} of users" if args.rollout else ""))
    finally:
        if edit_id:
            edits.delete(packageName=PACKAGE, editId=edit_id).execute()


if __name__ == "__main__":
    try:
        main()
    except HttpError as e:
        sys.exit(f"Play API {e.resp.status}: {e.reason}")
