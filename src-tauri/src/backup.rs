//! Daily local backup of the notes folder.
//!
//! Cheap insurance: the sync path has lost data more than once (a torn write
//! shipped by Drive, a conflict copy skipped as "stale", a silent fallback to
//! a second store). Once a day the whole notes dir — whichever one `notes_dir`
//! resolves to — is copied into `<app local data dir>\backups\YYYY-MM-DD\`,
//! and the 7 newest days are kept. Nothing here talks to Drive.

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

const KEEP_DAYS: usize = 7;

/// `<app local data dir>\backups`. Created on demand so the frontend can show
/// (and open) the folder before the first backup has run.
pub fn backups_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::local_dir(app)?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Frontend: where the daily backups live, for a "Backups" line in Settings.
#[tauri::command]
pub fn backups_dir(app: AppHandle) -> Result<String, String> {
    Ok(backups_root(&app)?.to_string_lossy().into_owned())
}

/// Today as `YYYY-MM-DD` in UTC (the local-vs-UTC hour hardly matters for a
/// daily snapshot, and it spares a chrono dependency). Civil-from-days after
/// Howard Hinnant's algorithm.
fn today() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    date_from_days((secs / 86_400) as i64)
}

fn date_from_days(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// A folder name of the exact shape this module writes. Anything else under
/// `backups/` (a user's own folder, a `.partial` left by a crash) is neither
/// counted nor pruned — except that a stale `.partial` is removed by the next
/// run for the same day, see `snapshot`.
fn is_date_dir(name: &str) -> bool {
    name.len() == 10
        && name
            .char_indices()
            .all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() })
}

/// Copy the regular files directly under `notes` into `<backups>/<day>/`, if
/// that folder doesn't exist yet, then keep only the `KEEP_DAYS` newest
/// date folders. Pure in the sense that tests can pass temp dirs.
///
/// The copy lands in `<day>.partial` and is renamed into place at the end, so
/// a crash mid-copy never leaves a folder that looks like a complete backup.
pub(crate) fn snapshot(notes: &Path, backups: &Path, day: &str) -> Result<(), String> {
    let target = backups.join(day);
    if target.is_dir() {
        return prune(backups);
    }
    let partial = backups.join(format!("{day}.partial"));
    if partial.exists() {
        fs::remove_dir_all(&partial).map_err(|e| format!("cannot clear {}: {e}", partial.display()))?;
    }
    fs::create_dir_all(&partial).map_err(|e| format!("cannot create {}: {e}", partial.display()))?;

    let entries = fs::read_dir(notes).map_err(|e| format!("cannot read {}: {e}", notes.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // .tmp is an in-flight write_atomic; copying it would snapshot a
        // half-written file under a name that will never be read back.
        if path.extension().and_then(|s| s.to_str()) == Some("tmp") {
            continue;
        }
        let Some(name) = path.file_name() else { continue };
        fs::copy(&path, partial.join(name))
            .map_err(|e| format!("cannot copy {}: {e}", path.display()))?;
    }
    fs::rename(&partial, &target)
        .map_err(|e| format!("cannot finalise {}: {e}", target.display()))?;
    prune(backups)
}

/// Delete every date folder older than the `KEEP_DAYS` newest. Date names
/// sort lexically in chronological order, so no parsing is needed.
fn prune(backups: &Path) -> Result<(), String> {
    let entries = fs::read_dir(backups).map_err(|e| format!("cannot read {}: {e}", backups.display()))?;
    let mut days: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.file_name().and_then(|n| n.to_str()).is_some_and(is_date_dir))
        .collect();
    days.sort();
    let stale = days.len().saturating_sub(KEEP_DAYS);
    for old in &days[..stale] {
        if let Err(e) = fs::remove_dir_all(old) {
            eprintln!("[notezzz] backup: cannot remove {}: {e}", old.display());
        }
    }
    Ok(())
}

fn run_once(app: &AppHandle) {
    // Resolved on every run, not once: the sync folder can be (re)configured
    // while the app is up, and an unmounted Drive is an error here just as
    // it is for the storage commands — skip, never back up the wrong folder.
    let notes = match crate::notes_dir(app) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[notezzz] backup skipped: {e}");
            return;
        }
    };
    let backups = match backups_root(app) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[notezzz] backup skipped: {e}");
            return;
        }
    };
    if let Err(e) = snapshot(&notes, &backups, &today()) {
        eprintln!("[notezzz] backup failed: {e}");
    }
}

/// Back up now, then once every 24 h for as long as the app runs.
pub fn start(app: AppHandle) {
    thread::spawn(move || loop {
        run_once(&app);
        thread::sleep(Duration::from_secs(24 * 60 * 60));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_from_days_matches_known_dates() {
        assert_eq!(date_from_days(0), "1970-01-01");
        assert_eq!(date_from_days(19_723), "2024-01-01");
        assert_eq!(date_from_days(20_000), "2024-10-04");
        assert_eq!(date_from_days(20_711), "2026-09-15");
    }

    #[test]
    fn is_date_dir_accepts_only_the_written_shape() {
        assert!(is_date_dir("2026-09-15"));
        assert!(!is_date_dir("2026-09-15.partial"));
        assert!(!is_date_dir("2026-9-15"));
        assert!(!is_date_dir("mine"));
    }

    #[test]
    fn snapshot_copies_once_per_day_and_skips_tmp() {
        let tmp = tempfile::tempdir().unwrap();
        let notes = tmp.path().join("notes");
        let backups = tmp.path().join("backups");
        fs::create_dir_all(&notes).unwrap();
        fs::create_dir_all(&backups).unwrap();
        fs::write(notes.join("a.json"), "{\"id\":\"a\"}").unwrap();
        fs::write(notes.join("a.json.bak"), "old").unwrap();
        fs::write(notes.join("b.json.tmp"), "half").unwrap();

        snapshot(&notes, &backups, "2026-09-15").unwrap();
        let day = backups.join("2026-09-15");
        assert_eq!(fs::read_to_string(day.join("a.json")).unwrap(), "{\"id\":\"a\"}");
        assert!(day.join("a.json.bak").is_file(), "parked losers are worth keeping too");
        assert!(!day.join("b.json.tmp").exists());
        assert!(!backups.join("2026-09-15.partial").exists());

        // Same day again: the existing folder is left alone.
        fs::write(notes.join("c.json"), "{\"id\":\"c\"}").unwrap();
        snapshot(&notes, &backups, "2026-09-15").unwrap();
        assert!(!day.join("c.json").exists());
    }

    #[test]
    fn snapshot_keeps_the_seven_newest_days() {
        let tmp = tempfile::tempdir().unwrap();
        let notes = tmp.path().join("notes");
        let backups = tmp.path().join("backups");
        fs::create_dir_all(&notes).unwrap();
        fs::create_dir_all(&backups).unwrap();
        for d in 1..=9 {
            fs::create_dir_all(backups.join(format!("2026-09-{d:02}"))).unwrap();
        }
        fs::create_dir_all(backups.join("keep-me")).unwrap();

        snapshot(&notes, &backups, "2026-09-10").unwrap();
        let mut names: Vec<String> = fs::read_dir(&backups)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "2026-09-04",
                "2026-09-05",
                "2026-09-06",
                "2026-09-07",
                "2026-09-08",
                "2026-09-09",
                "2026-09-10",
                "keep-me",
            ]
        );
    }
}
