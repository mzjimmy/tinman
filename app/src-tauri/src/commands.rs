use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

// TODO(round2): LLM prefill of architecture map from facts.json
use crate::db::{self, MapProposal, WireRecord, WorkspaceRecord, WorkspaceSummary};
use crate::error::Result;
use crate::files::{self, FileNode};
use crate::gitutil::{self, GitChanges};
use crate::scanner::{self, Facts, ScanProgress};

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub data_dir: PathBuf,
}

fn facts_dir(data_dir: &std::path::Path, id: &str) -> PathBuf {
    data_dir.join("workspaces").join(id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_workspaces(state: State<AppState>) -> std::result::Result<Vec<WorkspaceSummary>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::list_workspaces(&db).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_workspace(
    state: State<AppState>,
    id: String,
) -> std::result::Result<WorkspaceRecord, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::get_workspace(&db, &id).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_workspace(
    state: State<AppState>,
    root_path: String,
    name: Option<String>,
) -> std::result::Result<WorkspaceRecord, String> {
    let path = PathBuf::from(&root_path);
    if !path.is_dir() {
        return Err(format!("not a directory: {root_path}"));
    }
    let name = name.unwrap_or_else(|| {
        path.file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "untitled".into())
    });
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::create_workspace(&db, &name, &root_path).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn scan_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> std::result::Result<Facts, String> {
    let (root, data_dir) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let ws = db::get_workspace(&db, &id).map_err(|e| e.to_string())?;
        (ws.root_path, state.data_dir.clone())
    };
    let out_dir = facts_dir(&data_dir, &id);
    let app2 = app.clone();
    let facts = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_and_write(std::path::Path::new(&root), &out_dir, |p: ScanProgress| {
            let _ = app2.emit("scan-progress", &p);
        })
        .map(|(facts, _)| facts)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut patch = serde_json::json!({
            "lastActivityAt": facts.git.last_commit_at,
            "lastScanAt": facts.scanned_at,
        });
        if let Some(obj) = patch.as_object_mut() {
            if let Some(branch) = &facts.git.branch {
                obj.insert("gitBranch".into(), Value::String(branch.clone()));
            }
        }
        let _ = db::merge_workspace_prefs(&db, &id, &patch);
    }
    Ok(facts)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_facts(state: State<AppState>, id: String) -> std::result::Result<Option<Facts>, String> {
    let dir = facts_dir(&state.data_dir, &id);
    scanner::read_facts(&dir).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn confirm_map(
    state: State<AppState>,
    id: String,
    proposal: MapProposal,
    name: Option<String>,
) -> std::result::Result<WorkspaceRecord, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::confirm_map(&db, &id, &proposal, name.as_deref()).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_prefs(
    state: State<AppState>,
    id: String,
    patch: Value,
) -> std::result::Result<Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::merge_workspace_prefs(&db, &id, &patch).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_app_prefs(state: State<AppState>) -> std::result::Result<Value, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::get_app_prefs(&db).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_app_prefs(state: State<AppState>, prefs: Value) -> std::result::Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::set_app_prefs(&db, &prefs).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_criterion_met(
    state: State<AppState>,
    wire_id: String,
    index: usize,
    met: bool,
    evidence: Option<String>,
) -> std::result::Result<WireRecord, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::set_criterion_met(&db, &wire_id, index, met, evidence).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn list_files(
    state: State<'_, AppState>,
    id: String,
) -> std::result::Result<FileNode, String> {
    let root = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db::get_workspace(&db, &id).map_err(|e| e.to_string())?.root_path
    };
    tauri::async_runtime::spawn_blocking(move || files::list_tree(std::path::Path::new(&root)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn git_changes(
    state: State<'_, AppState>,
    id: String,
) -> std::result::Result<GitChanges, String> {
    let root = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db::get_workspace(&db, &id).map_err(|e| e.to_string())?.root_path
    };
    tauri::async_runtime::spawn_blocking(move || gitutil::changes(std::path::Path::new(&root)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn rename_workspace(
    state: State<AppState>,
    id: String,
    name: String,
) -> std::result::Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::rename_workspace(&db, &id, &name).map_err(Into::into)
}

pub fn data_dir_from_app(app: &AppHandle) -> Result<PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| {
        crate::error::AppError::msg(format!("app data dir: {e}"))
    })?;
    std::fs::create_dir_all(dir.join("workspaces"))?;
    Ok(dir)
}
