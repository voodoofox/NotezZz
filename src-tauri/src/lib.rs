// NotezZz desktop core: file-based storage in the sync (Drive) folder, sticky
// note windows (transparent, always-on-top), system tray, and close-to-tray.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
mod gauth;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

// ----------------------------------------------------------------------------
// Storage paths
// ----------------------------------------------------------------------------

/// App-private folder (holds config.json and acts as fallback store).
fn local_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_local_data_dir()
        .expect("no app local data dir");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn config_file(app: &tauri::AppHandle) -> PathBuf {
    local_dir(app).join("config.json")
}

/// The user-chosen sync folder (a Google Drive folder), if set and present.
fn read_sync_folder(app: &tauri::AppHandle) -> Option<PathBuf> {
    let txt = fs::read_to_string(config_file(app)).ok()?;
    let v: Value = serde_json::from_str(&txt).ok()?;
    let p = v.get("syncFolder")?.as_str()?;
    Some(PathBuf::from(p))
}

/// Where notes + settings actually live: the sync folder if usable, else local.
fn base_dir(app: &tauri::AppHandle) -> PathBuf {
    match read_sync_folder(app) {
        Some(p) if p.is_dir() => p,
        _ => local_dir(app),
    }
}

fn notes_dir(app: &tauri::AppHandle) -> PathBuf {
    let d = base_dir(app).join("notes");
    let _ = fs::create_dir_all(&d);
    d
}

/// Keep only filesystem-safe characters from a note id.
fn safe_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

// ----------------------------------------------------------------------------
// Storage commands
// ----------------------------------------------------------------------------

#[tauri::command]
fn list_notes(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let dir = notes_dir(&app);
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            // Skip Google Drive conflict copies ("<id> (1).json") when the
            // canonical file exists — they resurrect stale content and would
            // collide on note id. Left on disk rather than deleted.
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if let Some(base) = stem.rsplit_once(" (").and_then(|(b, rest)| {
                    rest.strip_suffix(')').filter(|n| n.chars().all(|c| c.is_ascii_digit())).map(|_| b)
                }) {
                    if dir.join(format!("{base}.json")).exists() {
                        continue;
                    }
                }
            }
            if let Ok(txt) = fs::read_to_string(&path) {
                if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                    let deleted = v.get("deleted").and_then(Value::as_bool).unwrap_or(false);
                    if !deleted {
                        out.push(v);
                    }
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn save_note(app: tauri::AppHandle, note: Value) -> Result<(), String> {
    let id = note
        .get("id")
        .and_then(Value::as_str)
        .ok_or("note is missing an id")?;
    let path = notes_dir(&app).join(format!("{}.json", safe_id(id)));
    let txt = serde_json::to_string_pretty(&note).map_err(|e| e.to_string())?;
    fs::write(path, txt).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = notes_dir(&app).join(format!("{}.json", safe_id(&id)));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = base_dir(&app).join("settings.json");
    match fs::read_to_string(path) {
        Ok(txt) => serde_json::from_str(&txt).map(Some).map_err(|e| e.to_string()),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    let path = base_dir(&app).join("settings.json");
    let txt = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, txt).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_sync_folder(app: tauri::AppHandle) -> Option<String> {
    read_sync_folder(&app).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_sync_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let cfg = serde_json::json!({ "syncFolder": path });
    let txt = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(config_file(&app), txt).map_err(|e| e.to_string())
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
fn google_token(
    app: tauri::AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<String, String> {
    gauth::valid_access_token(&app, &client_id, &client_secret)
}

#[tauri::command]
fn google_account(app: tauri::AppHandle) -> Option<String> {
    gauth::load_tokens(&app).map(|t| t.email).filter(|e| !e.is_empty())
}

#[tauri::command]
fn google_sign_out(app: tauri::AppHandle) {
    gauth::clear_tokens(&app);
}

// Sticky note windows are created from the frontend via the WebviewWindow JS
// API (see src/lib/desktop.ts) — window creation from a Rust command deadlocks.

// ----------------------------------------------------------------------------
// App setup: tray, close-to-tray
// ----------------------------------------------------------------------------

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
        ])
        .setup(|app| {
            build_tray(app.handle())?;

            // Closing the main window hides it to the tray instead of quitting.
            if let Some(main) = app.get_webview_window("main") {
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
