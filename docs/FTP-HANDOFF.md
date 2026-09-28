# FTP handoff: publishing to the flatvoxel.com host

For any agent or person who needs to upload to the shared host. No
credentials in here; they live in `deploy.env` (gitignored) as
`FTP_USER`, `FTP_PASS`, `FTP_HOST`. Everything below was learned the hard
way; each rule has a reason.

## Use the scripts, not raw commands

Two scripts do all publishing and already encode every quirk below:

| script | publishes |
|---|---|
| `deploy-web.ps1` | the web app (PWA) build to `…/www/NotezZz/` |
| `deploy-site.ps1` | the marketing site + installer + updater manifest to `…/www/notezzz/` (optional since 0.18.12; GitHub Pages and Releases are the primary homes) |

Run from the project root in **PowerShell**, not Git Bash:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-web.ps1
```

Both dot-source `deploy-lib.ps1`, which holds the three helpers:
`Read-DeployEnv` (loads and validates `deploy.env`), `New-CurlNetrc`
(writes a temporary netrc), `Send-FtpFile` (one upload with retries).
If you need a one-off upload, call `Send-FtpFile` rather than inventing a
curl line.

## The rules, and why

1. **Use Git's curl, never the Windows one.** PowerShell resolves `curl` to
   `C:\Windows\System32\curl.exe`, which cannot connect to this host (exit
   7). The scripts pin `C:\Program Files\Git\mingw64\bin\curl.exe`.

2. **TLS on the control channel only: `--ftp-ssl-control`.** Full
   `--ssl-reqd` (encrypted data channel) drops large files on Windows
   Schannel with exit 55. Control-only works reliably.

3. **`-k` is required.** The host presents a certificate chain from an
   untrusted root (`SEC_E_UNTRUSTED_ROOT`). Without `-k` every connection
   fails at the handshake. The proper fix would be `--cacert` pinning of
   the host's chain; nobody has done that yet.

4. **Treat curl exit 56 as success.** Schannel misses the TLS close-notify
   after the file has already landed. The scripts accept 0 and 56 and
   verify the upload afterwards (see 8).

5. **Credentials go through a temp netrc, never the URL or command line.**
   `New-CurlNetrc` writes `machine <host> login "<user>" password "<pass>"`
   to a random-named file, `--netrc-file` points curl at it, and the
   scripts delete it in a `finally`. A password in the URL shows up in
   process lists.

6. **Remote paths are relative to the FTP sub-user's home, which is the
   account root, not the site root.** Upload to
   `domains/flatvoxel.com/htdocs/www/<dir>/…`. Uploading to `/` puts files
   somewhere no web server serves. `--ftp-create-dirs` creates missing
   directories.

7. **Upload order matters for the web app.** `deploy-web.ps1` sends
   everything under `_app/` first and `index.html`, `manifest.webmanifest`,
   `version.json` last, so a visitor who loads mid-upload gets a complete
   old build rather than a new index pointing at chunks that aren't there
   yet (that was a white screen).

8. **Verify after uploading.** `deploy-web.ps1` fetches each published
   asset over HTTPS and expects 200; `deploy-site.ps1` compares the served
   installer's `Content-Length` with the local file. Don't skip this: a
   partial upload looks like success at the FTP level.

9. **The host's front proxy caches by URL and ignores cache headers.**
   Anything the browser re-requests under a fixed name (`version.json`,
   `latest.json`, `service-worker.js`) must be requested with a per-build
   query string, or the proxy keeps serving the old one for days
   (observed: `age: 411178`). `.htaccess` sets `no-cache` on those files,
   which the proxy ignores; the query string is what actually works.

10. **Apache `.htaccess` blocks apply in order, later wins.** The
    always-revalidate `FilesMatch` must come after the immutable `.js` rule
    or `service-worker.js` ships as immutable.

11. **PowerShell 5.1 pitfalls inside the scripts.** Keep `.ps1` files pure
    ASCII (build characters like `·` from code points); read and write
    text with `[System.IO.File]::ReadAllText/WriteAllText` and
    `UTF8Encoding($false)`, never `Get-Content`/`Set-Content`, which
    double-encode UTF-8; run native commands whose stderr you don't control
    through `cmd /c "… 2>&1"` and check `$LASTEXITCODE`, because under
    `$ErrorActionPreference = 'Stop'` a single stderr line (a Vite
    warning) aborts the script.

## Testing a connection without touching production

A harmless HTTPS HEAD proves the curl binary and netrc flag work:

```powershell
& 'C:\Program Files\Git\mingw64\bin\curl.exe' --netrc-file <tmp> -sI https://flatvoxel.com/
```

An anonymous `--ftp-ssl-control` probe without `-k` shows the certificate
error described in rule 3; that is expected.

## What is served from where today

| what | where |
|---|---|
| web app (PWA) | flatvoxel.com/NotezZz/ via `deploy-web.ps1` |
| site, privacy, terms | GitHub Pages (`pages.yml`); flatvoxel copy optional |
| installer + `latest.json` | GitHub Releases (`release.yml`); flatvoxel copy optional |

If the FTP password is ever rotated, only `deploy.env` changes.
