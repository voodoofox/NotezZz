//! Unit tests for the file-level storage logic in lib.rs. Everything runs on
//! a tempdir; nothing here needs a Tauri app handle.

use std::fs;
use std::path::Path;

use serde_json::{json, Value};

use crate::{list_notes_in, safe_id, write_atomic};

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

fn note(id: &str, updated_at: u64, text: &str) -> String {
    json!({ "id": id, "updatedAt": updated_at, "text": text }).to_string()
}

fn ids(notes: &[Value]) -> Vec<String> {
    let mut v: Vec<String> = notes
        .iter()
        .map(|n| n["id"].as_str().unwrap().to_string())
        .collect();
    v.sort();
    v
}

// --- write_atomic -----------------------------------------------------------

#[test]
fn write_atomic_replaces_target_and_leaves_no_tmp() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("n.json");
    fs::write(&path, "old").unwrap();

    write_atomic(&path, "new content").unwrap();

    assert_eq!(fs::read_to_string(&path).unwrap(), "new content");
    assert_eq!(names(dir.path()), vec!["n.json"], "no n.json.tmp left behind");
}

#[test]
fn write_atomic_creates_a_missing_target() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fresh.json");

    write_atomic(&path, "{}").unwrap();

    assert_eq!(fs::read_to_string(&path).unwrap(), "{}");
    assert_eq!(names(dir.path()), vec!["fresh.json"]);
}

#[test]
fn write_atomic_fails_cleanly_when_the_directory_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nope").join("n.json");

    let err = write_atomic(&path, "x").unwrap_err();

    assert!(err.starts_with("cannot write"), "{err}");
    assert!(!path.exists());
}

// --- safe_id ----------------------------------------------------------------

#[test]
fn safe_id_keeps_only_filesystem_safe_characters() {
    assert_eq!(safe_id("abc-123_XYZ").unwrap(), "abc-123_XYZ");
    assert_eq!(safe_id("../etc/passwd").unwrap(), "etcpasswd");
    assert_eq!(safe_id("a b:c*d?e").unwrap(), "abcde");
    assert_eq!(safe_id("ünïcödé-1").unwrap(), "ncd-1");
}

#[test]
fn safe_id_rejects_an_id_with_nothing_left() {
    assert!(safe_id("").is_err());
    assert!(safe_id("../").is_err());
    assert!(safe_id("   ").is_err());
    assert!(safe_id("日本語").is_err());
}

// --- list_notes_in: Drive conflict copies -----------------------------------

#[test]
fn newer_canonical_wins_and_conflict_copy_is_parked() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("n1.json"), note("n1", 200, "newer")).unwrap();
    fs::write(dir.path().join("n1 (1).json"), note("n1", 100, "older")).unwrap();

    let out = list_notes_in(dir.path()).unwrap();

    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["text"], "newer");
    assert_eq!(names(dir.path()), vec!["n1 (1).json.bak", "n1.json"]);
    let kept: Value = serde_json::from_str(&fs::read_to_string(dir.path().join("n1.json")).unwrap()).unwrap();
    assert_eq!(kept["text"], "newer");
}

#[test]
fn newer_conflict_copy_wins_and_is_promoted_to_canonical() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("n1.json"), note("n1", 100, "older")).unwrap();
    fs::write(dir.path().join("n1 (1).json"), note("n1", 200, "newer")).unwrap();

    let out = list_notes_in(dir.path()).unwrap();

    assert_eq!(out.len(), 1);
    assert_eq!(out[0]["text"], "newer");
    // The stale canonical file is parked as .bak, the copy takes its name.
    assert_eq!(names(dir.path()), vec!["n1.json", "n1.json.bak"]);
    let kept: Value = serde_json::from_str(&fs::read_to_string(dir.path().join("n1.json")).unwrap()).unwrap();
    assert_eq!(kept["text"], "newer");
    let parked: Value =
        serde_json::from_str(&fs::read_to_string(dir.path().join("n1.json.bak")).unwrap()).unwrap();
    assert_eq!(parked["text"], "older");
}

#[test]
fn tie_goes_to_the_canonical_file() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("n1.json"), note("n1", 100, "canonical")).unwrap();
    fs::write(dir.path().join("n1 (1).json"), note("n1", 100, "copy")).unwrap();

    let out = list_notes_in(dir.path()).unwrap();

    assert_eq!(out[0]["text"], "canonical");
    assert_eq!(names(dir.path()), vec!["n1 (1).json.bak", "n1.json"]);
}

#[test]
fn a_lone_conflict_copy_is_promoted() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("n1 (1).json"), note("n1", 100, "only copy")).unwrap();

    let out = list_notes_in(dir.path()).unwrap();

    assert_eq!(out[0]["text"], "only copy");
    assert_eq!(names(dir.path()), vec!["n1.json"]);
}

#[test]
fn parking_never_overwrites_an_existing_bak() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("n1.json"), note("n1", 200, "newer")).unwrap();
    fs::write(dir.path().join("n1 (1).json"), note("n1", 100, "older")).unwrap();
    fs::write(dir.path().join("n1 (1).json.bak"), "earlier loser").unwrap();

    list_notes_in(dir.path()).unwrap();

    assert_eq!(
        names(dir.path()),
        vec!["n1 (1).json.1.bak", "n1 (1).json.bak", "n1.json"]
    );
    assert_eq!(fs::read_to_string(dir.path().join("n1 (1).json.bak")).unwrap(), "earlier loser");
}

#[test]
fn deleted_notes_are_not_listed_but_still_resolved() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("n1.json"), json!({ "id": "n1", "updatedAt": 1 }).to_string()).unwrap();
    fs::write(
        dir.path().join("n1 (1).json"),
        json!({ "id": "n1", "updatedAt": 2, "deleted": true }).to_string(),
    )
    .unwrap();

    let out = list_notes_in(dir.path()).unwrap();

    assert!(out.is_empty(), "the newest copy is a tombstone");
    assert_eq!(names(dir.path()), vec!["n1.json", "n1.json.bak"]);
}

// --- list_notes_in: unreadable files ----------------------------------------

#[test]
fn corrupt_file_is_skipped_and_others_are_returned() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("good.json"), note("good", 1, "ok")).unwrap();
    fs::write(dir.path().join("torn.json"), "{\"id\": \"torn\", \"upd").unwrap();
    fs::write(dir.path().join("noid.json"), "{\"text\": \"no id field\"}").unwrap();
    fs::write(dir.path().join("also.json"), note("also", 1, "ok")).unwrap();

    let out = list_notes_in(dir.path()).unwrap();

    assert_eq!(ids(&out), vec!["also", "good"]);
    // Skipped, not touched: the corrupt file may still be salvageable by hand.
    assert_eq!(names(dir.path()), vec!["also.json", "good.json", "noid.json", "torn.json"]);
}

#[test]
fn non_json_files_are_ignored() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("n1.json"), note("n1", 1, "ok")).unwrap();
    fs::write(dir.path().join("n1.json.tmp"), "in flight").unwrap();
    fs::write(dir.path().join("n1.json.bak"), "parked").unwrap();
    fs::write(dir.path().join("desktop.ini"), "").unwrap();

    let out = list_notes_in(dir.path()).unwrap();

    assert_eq!(ids(&out), vec!["n1"]);
    assert_eq!(names(dir.path()), vec!["desktop.ini", "n1.json", "n1.json.bak", "n1.json.tmp"]);
}

#[test]
fn missing_directory_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let err = list_notes_in(&dir.path().join("absent")).unwrap_err();
    assert!(err.starts_with("cannot read"), "{err}");
}
