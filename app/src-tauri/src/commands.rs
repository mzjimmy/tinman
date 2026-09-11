use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{self, MapProposal, TaskRecord, WireRecord, WorkspaceRecord, WorkspaceSummary};
use crate::dispatch::{self, AgentConfig, DispatchRequest};
use crate::error::Result;
use crate::files::{self, FileNode};
use crate::gitutil::{self, GitChanges};
use crate::llm::{self, CallLogEntry, KeyStore, LlmCallResult};
use crate::queue;
use crate::runner::{self, Clock, LiveChildren, LiveClock, OutputLine, StdProcessRunner};
use crate::scanner::{self, Facts, ScanProgress};
use crate::worktree;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub data_dir: PathBuf,
    pub children: Arc<LiveChildren>,
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
            obj.insert(
                "treeFingerprint".into(),
                Value::String(crate::scanner::tree_fingerprint(&facts)),
            );
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

#[tauri::command(rename_all = "snake_case")]
pub async fn llm_call(
    state: State<'_, AppState>,
    workspace_id: String,
    purpose: String,
    input: Value,
) -> std::result::Result<LlmCallResult, String> {
    let (profile_id, profiles) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let ws = db::get_workspace(&db, &workspace_id).map_err(|e| e.to_string())?;
        let prefs = db::get_app_prefs(&db).map_err(|e| e.to_string())?;
        (ws.llm_profile_id, llm::profiles_from_prefs(&prefs))
    };
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let keys = llm::OsKeychain;
        let clock = llm::LiveClock;
        llm::call(
            &purpose,
            &input,
            &llm::CallDeps {
                workspace_id: &workspace_id,
                profile_id: profile_id.as_deref(),
                profiles: &profiles,
                keys: &keys,
                clock: &clock,
            },
            llm::HttpTransport::new,
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(entry) = &outcome.log {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db::insert_llm_call(&db, entry).map_err(|e| e.to_string())?;
    }
    outcome.result.map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_llm_calls(
    state: State<AppState>,
    workspace_id: String,
) -> std::result::Result<Vec<CallLogEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::list_llm_calls(&db, &workspace_id).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn add_criterion(
    state: State<AppState>,
    wire_id: String,
    text: String,
) -> std::result::Result<WireRecord, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::add_criterion(&db, &wire_id, &text).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_llm_key(key_ref: String, secret: String) -> std::result::Result<(), String> {
    llm::OsKeychain.set(&key_ref, &secret)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_workspace_llm_profile(
    state: State<AppState>,
    id: String,
    llm_profile_id: Option<String>,
) -> std::result::Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::set_workspace_llm_profile(&db, &id, llm_profile_id.as_deref()).map_err(Into::into)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct AppPaths {
    pub data_dir: String,
    pub worktrees_dir: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct TaskOutputEvent {
    pub task_id: String,
    pub stream: String,
    pub text: String,
}

#[tauri::command(rename_all = "snake_case")]
pub fn app_paths(state: State<AppState>) -> std::result::Result<AppPaths, String> {
    Ok(AppPaths {
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        worktrees_dir: state.data_dir.join("worktrees").to_string_lossy().into_owned(),
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_tasks(
    state: State<AppState>,
    workspace_id: String,
) -> std::result::Result<Vec<TaskRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let _ = queue::recover_crashed(&db, &LiveClock);
    db::list_tasks(&db, &workspace_id).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_task(state: State<AppState>, id: String) -> std::result::Result<TaskRecord, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db::get_task(&db, &id).map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
pub fn read_task_log(
    state: State<AppState>,
    task_id: String,
) -> std::result::Result<Vec<OutputLine>, String> {
    Ok(runner::read_log(&state.data_dir, &task_id))
}

#[tauri::command(rename_all = "snake_case")]
pub fn remove_worktree(
    state: State<AppState>,
    task_id: String,
) -> std::result::Result<(), String> {
    let (root, path) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let rec = db::get_task(&db, &task_id).map_err(|e| e.to_string())?;
        let ws = db::get_workspace(&db, &rec.workspace_id).map_err(|e| e.to_string())?;
        let path = rec
            .worktree_path
            .ok_or_else(|| "task has no worktree".to_string())?;
        (ws.root_path, path)
    };
    worktree::remove(std::path::Path::new(&root), std::path::Path::new(&path)).map_err(|e| e.to_string())
}

fn spec_from_record(rec: &TaskRecord, data_dir: &std::path::Path) -> runner::CommandSpec {
    let program = rec
        .result_json
        .as_ref()
        .and_then(|v| v.get("program"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let args = rec
        .result_json
        .as_ref()
        .and_then(|v| v.get("argv"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let cwd = rec
        .worktree_path
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir.to_path_buf());
    runner::CommandSpec { program, args, cwd }
}

fn try_verify_proposal(conn: &rusqlite::Connection, task: &TaskRecord) -> Option<Value> {
    let ws = db::get_workspace(conn, &task.workspace_id).ok()?;
    let prefs = db::get_app_prefs(conn).ok()?;
    let profiles = llm::profiles_from_prefs(&prefs);
    if profiles.is_empty() || ws.llm_profile_id.is_none() {
        return None;
    }
    let keys = llm::OsKeychain;
    let clock = llm::LiveClock;
    let input = serde_json::json!({
        "done_criteria": task.goal_json.get("done_criteria"),
        "delivery": task.result_json,
        "facts": task.goal_json.get("facts"),
    });
    let outcome = llm::call(
        "verify_delivery",
        &input,
        &llm::CallDeps {
            workspace_id: &task.workspace_id,
            profile_id: ws.llm_profile_id.as_deref(),
            profiles: &profiles,
            keys: &keys,
            clock: &clock,
        },
        llm::HttpTransport::new,
    );
    if let Some(entry) = &outcome.log {
        let _ = db::insert_llm_call(conn, entry);
    }
    match outcome.result.ok()? {
        llm::LlmCallResult::Available { output, .. } => Some(output),
        _ => None,
    }
}

fn write_interactive_hint(data_dir: &std::path::Path, rec: &TaskRecord) {
    let spec = spec_from_record(rec, data_dir);
    let hint = OutputLine {
        stream: "stdout".into(),
        text: format!(
            "interactive: run by hand\ncd {}\n{}",
            spec.cwd.display(),
            runner::format_command(&spec)
        ),
    };
    let _ = runner::append_log_line(data_dir, &rec.id, &hint);
}

fn spawn_claimed(app: AppHandle, data_dir: PathBuf, db_path: PathBuf, rec: TaskRecord) {
    if rec.state == "waiting_dispatch" {
        write_interactive_hint(&data_dir, &rec);
        let _ = app.emit("task-state", &rec);
        return;
    }
    if rec.state != "running" {
        let _ = app.emit("task-state", &rec);
        return;
    }
    let spec = spec_from_record(&rec, &data_dir);
    let task_id = rec.id.clone();
    let children = app.state::<AppState>().children.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runner = StdProcessRunner;
        let mut emit = |line: OutputLine| {
            let _ = runner::append_log_line(&data_dir, &task_id, &line);
            let _ = app.emit(
                "task-output",
                TaskOutputEvent {
                    task_id: task_id.clone(),
                    stream: line.stream,
                    text: line.text,
                },
            );
        };
        let outcome = runner.spawn_tracked(&spec, &task_id, &children, &mut emit);
        if let Ok(conn) = db::open(&db_path) {
            let clock = LiveClock;
            if let Ok(current) = db::get_task(&conn, &task_id) {
                if current.state == "paused" || current.state == "abandoned" {
                    let _ = app.emit("task-state", &current);
                    if let Ok(more) = queue::drain(&conn, &clock.now_rfc3339()) {
                        for next in more {
                            spawn_claimed(app.clone(), data_dir.clone(), db_path.clone(), next);
                        }
                    }
                    return;
                }
            }
            let finished = match &outcome {
                Ok(st) => {
                    let proposal = db::get_task(&conn, &task_id)
                        .ok()
                        .and_then(|t| try_verify_proposal(&conn, &t));
                    dispatch::finish_process(
                        &conn,
                        &data_dir,
                        &task_id,
                        st.code,
                        &clock,
                        proposal.as_ref(),
                    )
                }
                Err(e) => dispatch::apply_spawn_failure(&conn, &task_id, &e.to_string(), &clock),
            };
            if let Ok(rec) = finished {
                let _ = app.emit("task-state", &rec);
            }
            if let Ok(more) = queue::drain(&conn, &clock.now_rfc3339()) {
                for next in more {
                    spawn_claimed(app.clone(), data_dir.clone(), db_path.clone(), next);
                }
            }
        }
    });
}

/// Recover crashed `running` rows and claim free stations. Called at app
/// startup so a reopen drains the queue with no user action.
pub fn recover_and_drain(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let data_dir = state.data_dir.clone();
    let db_path = data_dir.join("tinman.db");
    let claimed = {
        let Ok(db) = state.db.lock() else {
            return;
        };
        let clock = LiveClock;
        let _ = queue::recover_crashed(&db, &clock);
        let checking: Vec<String> = db::list_all_tasks(&db)
            .unwrap_or_default()
            .into_iter()
            .filter(|t| t.state == "checking")
            .map(|t| t.id)
            .collect();
        for id in checking {
            let _ = crate::verify::verify_task(&db, &data_dir, &id, &clock, None);
        }
        queue::drain(&db, &clock.now_rfc3339()).unwrap_or_default()
    };
    for rec in claimed {
        spawn_claimed(app.clone(), data_dir.clone(), db_path.clone(), rec);
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn dispatch_task(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    part_id: String,
    wire_id: String,
    goal: Value,
    agent_id: String,
) -> std::result::Result<TaskRecord, String> {
    let (task, claimed, data_dir, db_path) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let ws = db::get_workspace(&db, &workspace_id).map_err(|e| e.to_string())?;
        let prefs = db::get_app_prefs(&db).map_err(|e| e.to_string())?;
        let agent: AgentConfig = dispatch::agent_by_id(&prefs, &agent_id).map_err(|e| e.to_string())?;
        let task_id = goal
            .get("task_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("t_{}", uuid::Uuid::new_v4().simple()));
        let req = DispatchRequest {
            task_id,
            workspace_id: workspace_id.clone(),
            part_id,
            wire_id,
            project_root: PathBuf::from(&ws.root_path),
            goal,
            station: agent.label.clone(),
            agent,
        };
        let data_dir = state.data_dir.clone();
        let db_path = data_dir.join("tinman.db");
        let clock = LiveClock;
        let started = dispatch::start_dispatch(
            &req,
            &dispatch::DispatchDeps {
                conn: &db,
                data_dir: &data_dir,
                clock: &clock,
            },
        )
        .map_err(|e| e.to_string())?;
        let claimed = queue::drain(&db, &clock.now_rfc3339()).map_err(|e| e.to_string())?;
        let task = db::get_task(&db, &started.task.id).map_err(|e| e.to_string())?;
        (task, claimed, data_dir, db_path)
    };

    for rec in claimed {
        spawn_claimed(app.clone(), data_dir.clone(), db_path.clone(), rec);
    }

    Ok(task)
}

#[tauri::command(rename_all = "snake_case")]
pub fn pause_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> std::result::Result<db::TaskRecord, String> {
    let clock = LiveClock;
    let (rec, claimed, data_dir, db_path) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let rec = queue::pause(&db, &task_id, &clock).map_err(|e| e.to_string())?;
        let claimed = queue::drain(&db, &clock.now_rfc3339()).map_err(|e| e.to_string())?;
        (
            rec,
            claimed,
            state.data_dir.clone(),
            state.data_dir.join("tinman.db"),
        )
    };
    state.children.kill(&task_id);
    let hint = runner::OutputLine {
        stream: "stdout".into(),
        text: "paused: child process sent SIGTERM if it was running; station released; worktree kept"
            .into(),
    };
    let _ = runner::append_log_line(&data_dir, &task_id, &hint);
    let _ = app.emit("task-state", &rec);
    for next in claimed {
        spawn_claimed(app.clone(), data_dir.clone(), db_path.clone(), next);
    }
    Ok(rec)
}

#[tauri::command(rename_all = "snake_case")]
pub fn resume_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> std::result::Result<db::TaskRecord, String> {
    let clock = LiveClock;
    let (rec, claimed, data_dir, db_path) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let rec = queue::resume(&db, &task_id).map_err(|e| e.to_string())?;
        let claimed = queue::drain(&db, &clock.now_rfc3339()).map_err(|e| e.to_string())?;
        (
            rec,
            claimed,
            state.data_dir.clone(),
            state.data_dir.join("tinman.db"),
        )
    };
    let _ = app.emit("task-state", &rec);
    for next in claimed {
        spawn_claimed(app.clone(), data_dir.clone(), db_path.clone(), next);
    }
    Ok(rec)
}

#[tauri::command(rename_all = "snake_case")]
pub fn abandon_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> std::result::Result<db::TaskRecord, String> {
    let clock = LiveClock;
    let (rec, claimed, data_dir, db_path) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let rec = queue::abandon(&db, &task_id, &clock).map_err(|e| e.to_string())?;
        let claimed = queue::drain(&db, &clock.now_rfc3339()).map_err(|e| e.to_string())?;
        (
            rec,
            claimed,
            state.data_dir.clone(),
            state.data_dir.join("tinman.db"),
        )
    };
    state.children.kill(&task_id);
    let hint = runner::OutputLine {
        stream: "stdout".into(),
        text: "abandoned: worktree kept; station released; process stopped if it was running"
            .into(),
    };
    let _ = runner::append_log_line(&data_dir, &task_id, &hint);
    let _ = app.emit("task-state", &rec);
    for next in claimed {
        spawn_claimed(app.clone(), data_dir.clone(), db_path.clone(), next);
    }
    Ok(rec)
}

pub fn data_dir_from_app(app: &AppHandle) -> Result<PathBuf> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| {
        crate::error::AppError::msg(format!("app data dir: {e}"))
    })?;
    std::fs::create_dir_all(dir.join("workspaces"))?;
    std::fs::create_dir_all(dir.join("worktrees"))?;
    std::fs::create_dir_all(dir.join("tasks"))?;
    Ok(dir)
}
