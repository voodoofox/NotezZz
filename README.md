# NotezZz

Fast sticky-notes app for Windows desktop + web, from one codebase.

- **Desktop** (Tauri v2): sticky notes pinned always-on-top with per-note
  transparency, system tray, close-to-tray, autostart, notes stored as files.
- **Web** (static SPA at <https://flatvoxel.com/NotezZz/>): same UI, notes sync
  to a private **NotezZz** folder in Google Drive (`drive.file` scope — the app
  can only see that folder), or offline localStorage mode without sign-in.
- **Font**: Sofia Sans Condensed (variable), default weight **324**; rich text
  via TipTap (bold / italic / underline / strike / lists / per-selection size).
- 9 color palettes, light/dark app theme.

## Stack

SvelteKit (adapter-static SPA) + Svelte 5 runes + TypeScript + TipTap v3,
wrapped by Tauri v2 (Rust) for the desktop build.

```
src/
  lib/
    store.svelte.ts        central reactive store (notes + settings + sync status)
    types.ts               Note/Settings data model (one JSON file per note)
    palettes.ts            color palettes
    storage/               backend interface + localStorage / Tauri-fs impls
    drive/                 Google auth (GIS token client) + Drive API backend
    desktop.ts             sticky windows, sync-folder helpers (no-op on web)
    components/            Sidebar, NotePane, Editor, Settings, SignIn
    editor/fontSize.ts     TipTap per-selection font-size extension
  routes/
    +page.svelte           main window (sign-in gate on web)
    sticky/+page.svelte    a pinned sticky window (desktop; id from window label)
src-tauri/                 Rust shell: fs storage commands, tray, autostart
tests/app.spec.ts          Playwright E2E suite (44 tests)
deploy-web.ps1             build + full FTPS deploy + live-asset verification
deploy-site.ps1            stamp version into site/, publish page + installer
deploy-lib.ps1             shared deploy helpers (deploy.env loader, FTPS upload)
deploy.env                 FTP credentials (gitignored; see Deploy)
```

## Storage model

One JSON file per note + `settings.json`. The same layout everywhere:

| Target  | Where |
|---------|-------|
| Desktop | local folder (Settings → Sync folder; default `%LOCALAPPDATA%\com.administrator.notezzz`) |
| Web (signed in) | `NotezZz` folder in Google Drive via API |
| Web (offline) | browser localStorage |

Desktop + web converge when the desktop sync folder points at the local mirror
of the same Drive folder (Google Drive for Desktop does the transport).

## Commands

| Command | What |
|---------|------|
| `npm run dev` | frontend only, in a browser (http://localhost:1420, add `?local` to skip sign-in) |
| `npm run tauri dev` | desktop app, dev mode (don't leave running for hours — HMR state accumulates) |
| `npm run tauri build` | Windows installers → `src-tauri/target/release/bundle/{nsis,msi}/` |
| `npm test` | Playwright E2E suite (uses system Chrome, auto-starts dev server) |
| `npm run check` | svelte-check / TypeScript |
| `powershell -ExecutionPolicy Bypass -File .\deploy-web.ps1` | build + deploy web to flatvoxel.com |
| `powershell -ExecutionPolicy Bypass -File .\deploy-site.ps1` | publish landing page + installer (after `tauri build`) |

## Deploy

Both deploy scripts read FTP credentials from `deploy.env` in the project root
(gitignored, never committed). It is plain `KEY=VALUE` lines:

```
FTP_USER=
FTP_PASS=
FTP_HOST=
```

The scripts refuse to run without it. Credentials are handed to curl through a
temporary netrc file (deleted afterwards), never on the command line.
`deploy-web.ps1` uploads everything under `_app/` first and `index.html` /
`version.json` last, so a visitor mid-upload keeps the old working build.

## Where secrets live

- `.env.local` — Google OAuth client secret, used by desktop builds only.
- `deploy.env` — FTP user / password / host for the deploy scripts.

Both are gitignored. Nothing else in the repo is secret (the OAuth client ID
is public by design).

## Hard-won gotchas (do not relearn these)

1. **Never sync TipTap ↔ state in a naive `$effect`** — ProseMirror's serialized
   HTML never string-equals the stored HTML, so effect → setContent → onUpdate
   loops until Svelte kills the whole reactive scheduler
   (`effect_update_depth_exceeded`) and every click in the app silently dies.
   `Editor.svelte` uses a non-reactive `syncedHtml` guard; keep it.
2. **Create Tauri windows from the frontend** (`new WebviewWindow(...)`), never
   from a Rust command — window creation on a command worker thread deadlocks
   silently. Needs `core:webview:allow-create-webview-window` capability.
3. **Web deploys must upload the whole `build/`** — hashed chunk names change
   every build; uploading only some files = white screen. `deploy-web.ps1`
   uploads everything and then verifies every referenced asset returns 200.
4. **Use Git's curl for FTPS** (`C:\Program Files\Git\mingw64\bin\curl.exe`):
   Windows System32 curl can't connect (exit 7). Use `--ftp-ssl-control`
   (full `--ssl-reqd` drops large files, exit 55) and treat exit 56 as success.
5. **Build the web bundle from PowerShell** (`$env:BASE_PATH='/NotezZz'`) —
   Git Bash mangles the leading-slash env value into a Windows path.
6. **Debounced saves need flushing** — `store.flush()` runs on
   `beforeunload`/`pagehide`/hidden in BOTH the main window and sticky windows
   (each webview has its own store instance).

## Content Security Policy

`src-tauri/tauri.conf.json` → `app.security.csp`. JSON has no comments, so
the rationale lives here. A wrong CSP is a white screen — change one
directive at a time and run the desktop app (dev AND a release build: Tauri
only rewrites the policy for bundled HTML, so the two behave differently).

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Everything not listed below must come from the app bundle (`tauri://localhost`, `http://tauri.localhost` on Windows). |
| `script-src` | `'self' 'unsafe-inline'` | `src/app.html` has an inline pre-paint theme script and SvelteKit emits an inline hydration script. For bundled HTML Tauri appends `sha256-…` hashes of those inline scripts, and browsers then IGNORE `'unsafe-inline'` (a hash or nonce disables it), so release builds are effectively hash-only. `'unsafe-inline'` is kept for the dev server, which serves unbundled HTML that Tauri does not hash. |
| `style-src` | `'self' 'unsafe-inline'` | Svelte scoped styles ship as files (`'self'`); `+layout.svelte` injects the `@font-face` block as an inline `<style>`. |
| `style-src-elem` | `'self' 'unsafe-inline'` | Tauri adds hashes/nonces to `style-src` for any `<style>` it finds in bundled HTML, which would silently disable `'unsafe-inline'` there. Browsers consult `style-src-elem` first for `<style>` elements, and Tauri leaves it untouched. |
| `style-src-attr` | `'unsafe-inline'` | Every `style="…"` attribute Svelte renders (note colours, `--tilt`, `display: contents` in app.html). Same reasoning as above: kept out of Tauri's reach. |
| `img-src` | `'self' data: blob:` | Pasted/dropped images are stored as base64 `data:` URLs inside the note; the editor previews with `blob:`. |
| `media-src` | `'self' data: blob:` | Audio clips, same storage model. |
| `font-src` | `'self' data:` | Sofia Sans Condensed is bundled; `data:` covers Vite inlining small assets. |
| `connect-src` | `'self' ipc: http://ipc.localhost …` | `ipc:` / `http://ipc.localhost` are Tauri's own command channel (the Windows one is the `http://` form) — without them every `invoke()` is blocked. The four Google hosts are Drive (`www.googleapis.com`), token refresh (`oauth2.googleapis.com`), userinfo (`openidconnect.googleapis.com`) and the GIS sign-in script's XHR (`accounts.google.com`). `ws://localhost:1420` is Vite HMR in `tauri dev`; loopback-only, harmless in release. |
| `object-src` | `'none'` | No plugins, ever. |
| `base-uri` | `'self'` | Blocks a `<base>` injection from redirecting relative asset URLs off-bundle. |

Not listed on purpose: `asset:` / `http://asset.localhost` (the app never reads
files through the asset protocol), `apis.google.com` and `frame-src` for the
Google Picker (web-only; the desktop app picks the sync folder with a native
dialog), and `'unsafe-eval'` (nothing needs it — if a dependency ever does, the
error is loud in the devtools console, not a white screen).

## Google OAuth

Client ID in `src/lib/googleConfig.ts` (public by design; PKCE, no secret).
Scope `drive.file` = only files/folders the app created. The consent screen
must either be published or list the account as a test user, otherwise Google
shows "Access blocked… has not completed the verification process".
