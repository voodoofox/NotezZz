//! Self-update, driven from Rust rather than the JS plugin API so the
//! manifest URL can be cache-busted. The site's front proxy caches by URL
//! and ignores request cache headers, so a fixed `latest.json` URL can keep
//! answering with the previous release long after a new one is published —
//! the same lesson version.json taught the web app.

use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const MANIFEST: &str = "https://flatvoxel.com/notezzz/latest.json";

#[derive(serde::Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
}

#[derive(serde::Serialize, Clone)]
struct Progress {
    done: u64,
    total: Option<u64>,
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let url = tauri::Url::parse(&format!("{MANIFEST}?ts={ts}")).map_err(|e| e.to_string())?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

/// Ask the site whether a newer build exists. `None` = up to date.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let up = updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(up.map(|u| UpdateInfo {
        version: u.version,
        body: u.body,
    }))
}

/// Download, verify against the baked-in public key, and run the installer.
/// On Windows the plugin exits the process once the installer starts; the
/// NSIS installer runs passively and relaunches the app. Progress is emitted
/// as `update-progress` for the UI.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let up = updater(&app)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Already up to date".to_string())?;
    let mut done: u64 = 0;
    let handle = app.clone();
    up.download_and_install(
        move |chunk, total| {
            done += chunk as u64;
            let _ = handle.emit("update-progress", Progress { done, total });
        },
        || {},
    )
    .await
    .map_err(|e| e.to_string())
}
