// NotezZz desktop core: file-based storage in the sync (Drive) folder, sticky
// note windows (transparent, always-on-top), system tray, and close-to-tray.

use std::collections::HashMap;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde_json::Value;
mod backup;
mod fullscreen;
mod gauth;
#[cfg(test)]
mod tests;
mod updates;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

// ----------------------------------------------------------------------------
// Storage paths
// ----------------------------------------------------------------------------

/// App-private folder (holds config.json and acts as fallback store).
/// Errors reach the command boundary instead of panicking: an unwritable
/// profile dir used to take the whole process down on first launch.
fn local_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("no app local data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(local_dir(app)?.join("config.json"))
}

/// The user-chosen sync folder (a Google Drive folder), if one is configured.
/// Presence on disk is NOT checked here — see `base_dir`.
fn read_sync_folder(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let Ok(txt) = fs::read_to_string(config_file(app)?) else {
        return Ok(None);
    };
    let v: Value = match serde_json::from_str(&txt) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    Ok(v.get("syncFolder").and_then(Value::as_str).map(PathBuf::from))
}

/// Where notes + settings actually live: the configured sync folder, else the
/// local app dir. A configured folder that is missing is an ERROR, not a
/// fallback: falling back silently (while Drive was unmounted or the drive
/// letter changed) sent edits into a second, local store, and the two copies
/// diverged until notes turned up "missing" on the other device. The message
/// is shown verbatim by the Sidebar's sync-error strip, with a Reconnect button.
fn base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    match read_sync_folder(app)? {
        Some(p) if p.is_dir() => Ok(p),
        Some(p) => Err(format!("Sync folder unavailable: {}", p.display())),
        None => local_dir(app),
    }
}

fn notes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let d = base_dir(app)?.join("notes");
    fs::create_dir_all(&d).map_err(|e| format!("cannot create {}: {e}", d.display()))?;
    Ok(d)
}

/// Keep only filesystem-safe characters from a note id. An id with nothing
/// left after sanitising used to map to a bare ".json" that every such note
/// then shared (and overwrote) — refuse it instead.
fn safe_id(id: &str) -> Result<String, String> {
    let s: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if s.is_empty() {
        return Err(format!("note id {id:?} has no filesystem-safe characters"));
    }
    Ok(s)
}

/// Write `<name>.tmp` beside the target, flush it, then rename it over the
/// target. A plain `fs::write` truncates first and fills afterwards; Drive
/// Desktop picked up that window and shipped a half-written JSON to every
/// other device, where it then failed to parse. Rename is atomic on NTFS and
/// POSIX, so readers see either the old file or the complete new one.
pub(crate) fn write_atomic(path: &Path, data: &str) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("bad target path {}", path.display()))?;
    let tmp = path.with_file_name(format!("{name}.tmp"));
    let write = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data.as_bytes())?;
        f.sync_all()
    };
    write().map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("cannot replace {}: {e}", path.display())
    })
}

// ----------------------------------------------------------------------------
// Storage commands
// ----------------------------------------------------------------------------

/// First free `<name>.bak`, `<name>.1.bak`, ... beside `path`. Losers of a
/// conflict are parked, never deleted — the "stale" copy has more than once
/// turned out to hold the only copy of an edit.
fn bak_path(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("note.json");
    let first = path.with_file_name(format!("{name}.bak"));
    if !first.exists() {
        return first;
    }
    (1..)
        .map(|n| path.with_file_name(format!("{name}.{n}.bak")))
        .find(|p| !p.exists())
        .unwrap()
}

fn updated_at(v: &Value) -> u64 {
    v.get("updatedAt").and_then(Value::as_u64).unwrap_or(0)
}

fn list_notes_blocking(app: &tauri::AppHandle) -> Result<Vec<Value>, String> {
    list_notes_in(&notes_dir(app)?)
}

/// Read every note in `dir`, resolving Drive conflict copies on the way
/// (see below). Takes a plain path so tests can run it on a temp dir.
fn list_notes_in(dir: &Path) -> Result<Vec<Value>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;

    // Every parsed file, grouped by the note id INSIDE the file (not the file
    // name): a Drive conflict copy "<id> (1).json" carries the same id.
    let mut by_id: HashMap<String, Vec<(PathBuf, Value)>> = HashMap::new();
    // Unreadable files are skipped so one bad file cannot sink the whole
    // list, but they are no longer skipped silently: a note that "vanished"
    // took a day to trace back to a corrupt file nobody had been told about.
    let mut unreadable: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue; // .tmp (in-flight write), .bak (parked loser), etc.
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string();
        let parsed = fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|txt| serde_json::from_str::<Value>(&txt).map_err(|e| e.to_string()));
        match parsed {
            Ok(v) => match v.get("id").and_then(Value::as_str) {
                Some(id) => by_id.entry(id.to_string()).or_default().push((path, v)),
                None => unreadable.push(format!("{name}: no \"id\" field")),
            },
            Err(e) => unreadable.push(format!("{name}: {e}")),
        }
    }

    if !unreadable.is_empty() {
        eprintln!(
            "[notezzz] list_notes: skipped {} unreadable note file(s) in {}:\n  {}",
            unreadable.len(),
            dir.display(),
            unreadable.join("\n  ")
        );
    }

    let mut out = Vec::new();
    for (id, mut copies) in by_id {
        let canonical = match safe_id(&id) {
            Ok(s) => dir.join(format!("{s}.json")),
            Err(e) => {
                eprintln!("[notezzz] list_notes: {e}");
                continue;
            }
        };
        // Drive conflict copies: the "(1)" copy used to be skipped whenever
        // the canonical file existed, but it is frequently the NEWER edit
        // from the other device. Keep the copy with the highest updatedAt
        // (ties go to the canonical file), park every loser as .bak, and
        // promote the winner to "<id>.json" so save/delete keep addressing it.
        copies.sort_by_key(|(p, v)| (std::cmp::Reverse(updated_at(v)), *p != canonical));
        let (winner_path, winner) = copies.swap_remove(0);
        for (loser, _) in copies {
            let bak = bak_path(&loser);
            if let Err(e) = fs::rename(&loser, &bak) {
                eprintln!("[notezzz] list_notes: cannot park {} as {}: {e}", loser.display(), bak.display());
            }
        }
        if winner_path != canonical {
            if let Err(e) = fs::rename(&winner_path, &canonical) {
                eprintln!(
                    "[notezzz] list_notes: cannot promote {} to {}: {e}",
                    winner_path.display(),
                    canonical.display()
                );
            }
        }
        let deleted = winner.get("deleted").and_then(Value::as_bool).unwrap_or(false);
        if !deleted {
            out.push(winner);
        }
    }
    Ok(out)
}

#[tauri::command]
async fn list_notes(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    // Directory scan + parsing every note ran on the main thread and froze
    // every window (stickies included) for the duration on a large or slow
    // (Drive-backed) folder. Same pattern as google_sign_in.
    tauri::async_runtime::spawn_blocking(move || list_notes_blocking(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn save_note(app: tauri::AppHandle, note: Value) -> Result<(), String> {
    let id = note
        .get("id")
        .and_then(Value::as_str)
        .ok_or("note is missing an id")?;
    let path = notes_dir(&app)?.join(format!("{}.json", safe_id(id)?));
    let txt = serde_json::to_string_pretty(&note).map_err(|e| e.to_string())?;
    write_atomic(&path, &txt)
}

#[tauri::command]
fn delete_note(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = notes_dir(&app)?.join(format!("{}.json", safe_id(&id)?));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = base_dir(&app)?.join("settings.json");
    match fs::read_to_string(path) {
        Ok(txt) => serde_json::from_str(&txt).map(Some).map_err(|e| e.to_string()),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    let path = base_dir(&app)?.join("settings.json");
    let txt = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    write_atomic(&path, &txt)
}

#[tauri::command]
fn get_sync_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(read_sync_folder(&app)?.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn set_sync_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // Refuse up front: once configured, a missing folder is a hard error for
    // every storage command (see base_dir), so never configure one blindly.
    if !Path::new(&path).is_dir() {
        return Err(format!("Sync folder unavailable: {path}"));
    }
    let cfg = serde_json::json!({ "syncFolder": path });
    let txt = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    write_atomic(&config_file(&app)?, &txt)
}

// ----------------------------------------------------------------------------
// Google sign-in (desktop): the frontend supplies the OAuth client from
// googleConfig so both apps share one identity, and gets back access tokens.
// ----------------------------------------------------------------------------

#[tauri::command]
async fn google_sign_in(
    app: tauri::AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<String, String> {
    // Blocking browser round-trip — keep it off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        gauth::sign_in(&app, &client_id, &client_secret).map(|t| t.email)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn google_token(
    app: tauri::AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<String, String> {
    // The refresh is a network round-trip to Google; done synchronously it
    // held the main thread and every window went "Not Responding" until the
    // request finished (or, before timeouts, forever on a stalled connection).
    tauri::async_runtime::spawn_blocking(move || {
        gauth::valid_access_token(&app, &client_id, &client_secret)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Signed-in account, or None when no tokens are stored. The email may be ""
/// when the userinfo lookup failed at sign-in (gauth::sign_in keeps the
/// tokens regardless) — still Some, because "signed in" means tokens exist.
/// desktopAuth.ts substitutes a placeholder label for the empty string.
#[tauri::command]
fn google_account(app: tauri::AppHandle) -> Option<String> {
    gauth::load_tokens(&app).map(|t| t.email)
}

#[tauri::command]
fn google_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    gauth::clear_tokens(&app)
}

// Sticky note windows are created from the frontend via the WebviewWindow JS
// API (see src/lib/desktop.ts) — window creation from a Rust command deadlocks.

// ----------------------------------------------------------------------------
// App setup: tray, close-to-tray
// ----------------------------------------------------------------------------

/// Move the calling window to (x, y) over `ms` with an ease-in-out quart
/// curve. Done here rather than per-frame from JS: each JS frame was an IPC
/// round-trip, which throttled the motion until it read as linear.
#[tauri::command]
async fn slide_window(window: tauri::Window, x: i32, y: i32, ms: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let from = window.outer_position().map_err(|e| e.to_string())?;
        let start = std::time::Instant::now();
        let total = ms.max(1) as f64 / 1000.0;
        loop {
            let t = (start.elapsed().as_secs_f64() / total).min(1.0);
            // Ease-in-out quint: barely moves for the first stretch, snaps
            // through the middle, settles softly.
            let k = if t < 0.5 { 16.0 * t.powi(5) } else { 1.0 - (-2.0 * t + 2.0).powi(5) / 2.0 };
            let nx = from.x as f64 + (x as f64 - from.x as f64) * k;
            let ny = from.y as f64 + (y as f64 - from.y as f64) * k;
            window
                .set_position(tauri::PhysicalPosition::new(nx.round() as i32, ny.round() as i32))
                .map_err(|e| e.to_string())?;
            if t >= 1.0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(6));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Delete WebView2's service-worker store for this app before the webview
/// exists. A worker registered by an earlier build (0.17.0 shipped one by
/// accident) kept serving that build's shell to the main window through every
/// update. Runs on each start: cheap, and no desktop build should ever have a
/// worker again. The path mirrors Tauri's app-local-data dir for this identifier.
fn remove_stale_service_worker() {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else { return };
    let dir = PathBuf::from(local)
        .join("com.administrator.notezzz")
        .join("EBWebView")
        .join("Default")
        .join("Service Worker");
    if dir.is_dir() {
        match fs::remove_dir_all(&dir) {
            Ok(()) => eprintln!("[NotezZz] removed stale service worker at {}", dir.display()),
            Err(e) => eprintln!("[NotezZz] could not remove service worker dir: {e}"),
        }
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open NotezZz", true, None::<&str>)?;
    let new = MenuItem::with_id(app, "new", "New note", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &new, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("NotezZz")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "new" => {
                show_main(app);
                let _ = app.emit("tray-new-note", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    remove_stale_service_worker();

    let mut builder = tauri::Builder::default();

    // single-instance MUST be registered first (desktop only).
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Registered here, but no shortcut is bound in Rust: the frontend
        // registers CommandOrControl+Shift+N through the JS API (it also owns
        // the "place the new sticky at the cursor" part).
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Self-update: the app checks latest.json on the site (signed with the
        // key in updater.env) so users stop re-downloading installers.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            list_notes,
            save_note,
            delete_note,
            load_settings,
            save_settings,
            get_sync_folder,
            set_sync_folder,
            google_sign_in,
            google_token,
            google_account,
            google_sign_out,
            updates::check_update,
            updates::install_update,
            backup::backups_dir,
            slide_window,
        ])
        .setup(|app| {
            build_tray(app.handle())?;
            // Stickies step aside for fullscreen video/games (see fullscreen.rs).
            fullscreen::watch(app.handle().clone());
            // Daily copy of the notes folder into the local app dir (see backup.rs).
            backup::start(app.handle().clone());

            // Closing the main window hides it to the tray instead of quitting.
            if let Some(main) = app.get_webview_window("main") {
                // WebView2 keeps the app's own pages in its HTTP cache across
                // updates. After an update the main window kept loading the
                // PREVIOUS build's index.html and chunks from cache while sticky
                // windows, which load a different path, got the new build — two
                // versions in one process, and "the pattern doesn't show in the
                // main window". A version in the query makes every build a new
                // cache key. The window is created hidden so the stale page never
                // paints; it is shown here once it points at the right URL.
                if let Ok(mut url) = main.url() {
                    if url.scheme() != "about" {
                        url.set_query(Some(&format!("v={}", env!("CARGO_PKG_VERSION"))));
                        let _ = main.navigate(url);
                    }
                }
                let _ = main.show();
                let main_clone = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_clone.hide();
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
