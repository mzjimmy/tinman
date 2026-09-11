//! Resident rescan: keep facts (and therefore short-leg stall) fresh.
//!
//! Mapping and progress still belong to the architecture map. This loop never
//! flips criteria and never writes a progress number. It re-scans each imported
//! workspace, stores a tree fingerprint, and emits `facts-updated` so the UI
//! can refresh ranking and, when the top-level tree actually changed, offer a
//! drift draft for the user to confirm.

use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AppState;
use crate::db::{self, APP_PREFS_ID};
use crate::scanner::{self, Facts};

pub const DEFAULT_INTERVAL_SECS: u64 = 180;
pub const STARTUP_DELAY_SECS: u64 = 5;
pub const MIN_INTERVAL_SECS: u64 = 30;
pub const MAX_INTERVAL_SECS: u64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FactsUpdated {
    pub workspace_id: String,
    pub facts: Facts,
    pub fingerprint: String,
    pub previous_fingerprint: Option<String>,
    pub drift: bool,
    pub map_confirmed: bool,
}

pub fn interval_from_prefs(prefs: &Value) -> Duration {
    let n = prefs
        .get("watch_interval_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_INTERVAL_SECS);
    Duration::from_secs(n.clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS))
}

pub fn tick_workspace(
    workspace_id: &str,
    root: &Path,
    out_dir: &Path,
    previous_fingerprint: Option<&str>,
    map_confirmed: bool,
) -> crate::error::Result<FactsUpdated> {
    let (facts, _) = scanner::scan_and_write(root, out_dir, |_| {})?;
    let fingerprint = scanner::tree_fingerprint(&facts);
    let drift = previous_fingerprint
        .map(|prev| prev != fingerprint)
        .unwrap_or(false);
    Ok(FactsUpdated {
        workspace_id: workspace_id.to_string(),
        facts,
        fingerprint,
        previous_fingerprint: previous_fingerprint.map(str::to_string),
        drift,
        map_confirmed,
    })
}

pub fn run_loop(app: AppHandle) {
    thread::sleep(Duration::from_secs(STARTUP_DELAY_SECS));
    loop {
        let _ = tick_app(&app);
        let interval = read_interval(&app);
        thread::sleep(interval);
    }
}

fn read_interval(app: &AppHandle) -> Duration {
    let Some(state) = app.try_state::<AppState>() else {
        return Duration::from_secs(DEFAULT_INTERVAL_SECS);
    };
    let Ok(db) = state.db.lock() else {
        return Duration::from_secs(DEFAULT_INTERVAL_SECS);
    };
    match db::get_app_prefs(&db) {
        Ok(prefs) => interval_from_prefs(&prefs),
        Err(_) => Duration::from_secs(DEFAULT_INTERVAL_SECS),
    }
}

fn tick_app(app: &AppHandle) -> crate::error::Result<()> {
    let Some(state) = app.try_state::<AppState>() else {
        return Ok(());
    };
    let data_dir = state.data_dir.clone();
    let jobs = {
        let db = state.db.lock().map_err(|e| crate::error::AppError::msg(e.to_string()))?;
        let list = db::list_workspaces(&db)?;
        let mut jobs = Vec::new();
        for ws in list {
            if ws.id == APP_PREFS_ID {
                continue;
            }
            let rec = db::get_workspace(&db, &ws.id)?;
            let map_confirmed = rec
                .prefs
                .get("mapConfirmed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let previous = rec
                .prefs
                .get("treeFingerprint")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            jobs.push((rec.id, rec.root_path, previous, map_confirmed));
        }
        jobs
    };

    for (id, root, previous, map_confirmed) in jobs {
        let root_path = PathBuf::from(&root);
        if !root_path.is_dir() {
            continue;
        }
        let out_dir = data_dir.join("workspaces").join(&id);
        let updated = match tick_workspace(
            &id,
            &root_path,
            &out_dir,
            previous.as_deref(),
            map_confirmed,
        ) {
            Ok(u) => u,
            Err(_) => continue,
        };
        {
            let db = state.db.lock().map_err(|e| crate::error::AppError::msg(e.to_string()))?;
            let mut patch = json!({
                "lastScanAt": updated.facts.scanned_at,
                "treeFingerprint": updated.fingerprint,
            });
            if let Some(obj) = patch.as_object_mut() {
                if let Some(at) = &updated.facts.git.last_commit_at {
                    obj.insert("lastActivityAt".into(), Value::String(at.clone()));
                }
                if let Some(branch) = &updated.facts.git.branch {
                    obj.insert("gitBranch".into(), Value::String(branch.clone()));
                }
            }
            let _ = db::merge_workspace_prefs(&db, &id, &patch);
        }
        let _ = app.emit("facts-updated", &updated);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_tree(root: &Path, dirs: &[&str]) {
        fs::create_dir_all(root).unwrap();
        for d in dirs {
            fs::create_dir_all(root.join(d)).unwrap();
            fs::write(root.join(d).join("keep.txt"), "x\n").unwrap();
        }
    }

    #[test]
    fn fingerprint_changes_when_a_top_level_dir_appears() {
        let facts_a = Facts {
            root: "/tmp/a".into(),
            scanned_at: "t".into(),
            duration_ms: 1,
            file_count: 1,
            by_extension: Default::default(),
            loc_by_language: Default::default(),
            tree: vec![scanner::TreeEntry {
                name: "src".into(),
                kind: "dir".into(),
                files: 1,
            }],
            dependencies: vec![],
            entry_points: Default::default(),
            tests: scanner::TestFacts {
                files: vec![],
                pass: None,
                fail: None,
                note: String::new(),
            },
            git: Default::default(),
            markers: vec![],
            spec_docs: vec![],
            design_files: vec![],
            reference_images: vec![],
            routes: vec![],
            api_endpoints: vec![],
            pages: vec![],
        };
        let mut facts_b = facts_a.clone();
        facts_b.tree.push(scanner::TreeEntry {
            name: "demo".into(),
            kind: "dir".into(),
            files: 1,
        });
        assert_ne!(scanner::tree_fingerprint(&facts_a), scanner::tree_fingerprint(&facts_b));
        assert_eq!(scanner::tree_fingerprint(&facts_a), scanner::tree_fingerprint(&facts_a));
    }

    #[test]
    fn interval_is_clamped() {
        assert_eq!(
            interval_from_prefs(&json!({})),
            Duration::from_secs(DEFAULT_INTERVAL_SECS)
        );
        assert_eq!(
            interval_from_prefs(&json!({"watch_interval_secs": 1})),
            Duration::from_secs(MIN_INTERVAL_SECS)
        );
        assert_eq!(
            interval_from_prefs(&json!({"watch_interval_secs": 99_000})),
            Duration::from_secs(MAX_INTERVAL_SECS)
        );
    }

    #[test]
    fn first_scan_is_not_drift_and_adding_a_dir_is() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("proj");
        let data = tmp.path().join("data");
        write_tree(&root, &["src", "web"]);
        let first = tick_workspace("ws", &root, &data, None, false).unwrap();
        assert!(!first.drift);
        assert!(first.fingerprint.contains("src"));
        assert!(first.facts.tests.pass.is_none());

        fs::create_dir_all(root.join("demo")).unwrap();
        fs::write(root.join("demo").join("keep.txt"), "y\n").unwrap();
        let second = tick_workspace("ws", &root, &data, Some(&first.fingerprint), true).unwrap();
        assert!(second.drift);
        assert!(second.map_confirmed);
        assert_ne!(second.fingerprint, first.fingerprint);
    }
}
