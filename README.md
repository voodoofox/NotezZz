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
tests/app.spec.ts          Playwright E2E suite (16 tests)
deploy-web.ps1             build + full FTPS deploy + live-asset verification
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

## Google OAuth

Client ID in `src/lib/googleConfig.ts` (public by design; PKCE, no secret).
Scope `drive.file` = only files/folders the app created. The consent screen
must either be published or list the account as a test user, otherwise Google
shows "Access blocked… has not completed the verification process".
