//! Dispatch a goal card: worktree, then (optionally) a child process.
//!
//! A process exiting 0 makes the task `checking`, never `done`. Completion
//! is judged by delivery verification in a later package.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::{self, TaskRecord};
use crate::runner::{
    append_log_line, forbidden_token, format_command, render_argv, write_goal_file, Clock,
    CommandSpec, OutputLine, ProcessRunner,
};
use crate::worktree::{self, WorktreeError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum DispatchError {
    NotAGitRepo,
    BranchExists { branch: String },
    PathExists { path: String },
    PathInsideProject { path: String },
    ForbiddenArgv { token: String },
    WorktreeVerifyFailed { detail: String },
    AgentNotFound { id: String },
    Io { detail: String },
    Db { detail: String },
    Git { detail: String },
}

impl std::fmt::Display for DispatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(s) => write!(f, "{s}"),
            Err(_) => write!(f, "dispatch failed"),
        }
    }
}

impl std::error::Error for DispatchError {}

impl From<WorktreeError> for DispatchError {
    fn from(e: WorktreeError) -> Self {
        match e {
            WorktreeError::NotAGitRepo => DispatchError::NotAGitRepo,
            WorktreeError::BranchExists { branch } => DispatchError::BranchExists { branch },
            WorktreeError::PathExists { path } => DispatchError::PathExists { path },
            WorktreeError::PathInsideProject { path } => DispatchError::PathInsideProject { path },
            WorktreeError::VerifyFailed { detail } => DispatchError::WorktreeVerifyFailed { detail },
            WorktreeError::Git { detail } => DispatchError::Git { detail },
            WorktreeError::Io { detail } => DispatchError::Io { detail },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentConfig {
    pub id: String,
    pub label: String,
    pub program: String,
    pub argv_template: Vec<String>,
    #[serde(default)]
    pub interactive: bool,
}

#[derive(Debug, Clone)]
pub struct DispatchRequest {
    pub task_id: String,
    pub workspace_id: String,
    pub part_id: String,
    pub wire_id: String,
    pub project_root: PathBuf,
    pub goal: Value,
    pub agent: AgentConfig,
    pub station: String, // kept on the request; occupancy is assigned by queue::claim_next
}

pub struct DispatchDeps<'a> {
    pub conn: &'a Connection,
    pub data_dir: &'a Path,
    pub clock: &'a dyn Clock,
}

#[derive(Debug, Clone)]
pub struct StartedDispatch {
    pub task: TaskRecord,
    pub spec: CommandSpec,
    pub interactive: bool,
}

pub fn state_after_exit(code: i32) -> &'static str {
    if code == 0 {
        "checking"
    } else {
        "failed"
    }
}

pub fn default_agents() -> Vec<AgentConfig> {
    vec![
        AgentConfig {
            id: "this-pc".into(),
            label: "This PC".into(),
            program: String::new(),
            argv_template: vec!["{{goal_path}}".into()],
            interactive: true,
        },
        AgentConfig {
            id: "agent-cli".into(),
            label: "agent CLI".into(),
            program: String::new(),
            argv_template: vec!["{{goal_path}}".into()],
            interactive: true,
        },
        AgentConfig {
            id: "station".into(),
            label: "named station".into(),
            program: String::new(),
            argv_template: vec![],
            interactive: true,
        },
    ]
}

pub fn agents_from_prefs(prefs: &Value) -> Vec<AgentConfig> {
    match prefs.get("agents").and_then(|v| v.as_array()) {
        Some(arr) if !arr.is_empty() => arr
            .iter()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect(),
        _ => default_agents(),
    }
}

pub fn agent_by_id(prefs: &Value, id: &str) -> Result<AgentConfig, DispatchError> {
    agents_from_prefs(prefs)
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| DispatchError::AgentNotFound { id: id.to_string() })
}

pub fn seal_goal(goal: &Value, task_id: &str, worktree_path: &Path, branch: &str) -> Value {
    let mut goal = goal.clone();
    if !goal.is_object() {
        goal = json!({});
    }
    if let Some(obj) = goal.as_object_mut() {
        obj.insert("task_id".into(), json!(task_id));
        obj.insert(
            "workspace".into(),
            json!({
                "worktree_path": worktree_path.to_string_lossy(),
                "branch": branch,
            }),
        );
        obj.insert(
            "authorization".into(),
            json!({
                "allow_push": false,
                "allow_deploy": false,
                "allow_spend": false,
            }),
        );
        obj.remove("progress");
    }
    goal
}

pub fn start_dispatch(
    req: &DispatchRequest,
    deps: &DispatchDeps<'_>,
) -> Result<StartedDispatch, DispatchError> {
    let branch = worktree::branch_name(&req.task_id);
    let worktree_path = worktree::planned_path(deps.data_dir, &req.task_id);

    let rendered = render_argv(
        &req.agent.argv_template,
        &[
            ("goal_path", ""), // filled after the file is written; check template first
            (
                "worktree_path",
                worktree_path.to_str().unwrap_or_default(),
            ),
            ("branch", &branch),
        ],
    );
    if let Some(token) = forbidden_token(&req.agent.program, &req.agent.argv_template)
        .or_else(|| forbidden_token(&req.agent.program, &rendered))
    {
        return Err(DispatchError::ForbiddenArgv { token });
    }

    let info = worktree::create(&req.project_root, &worktree_path, &branch, "HEAD")?;
    let goal = seal_goal(&req.goal, &req.task_id, &info.path, &info.branch);
    let goal_path = write_goal_file(deps.data_dir, &req.task_id, &goal).map_err(|e| {
        let _ = worktree::remove(&req.project_root, &info.path);
        DispatchError::Io {
            detail: e.to_string(),
        }
    })?;

    let goal_path_s = goal_path.to_string_lossy().into_owned();
    let args = render_argv(
        &req.agent.argv_template,
        &[
            ("goal_path", &goal_path_s),
            (
                "worktree_path",
                &info.path.to_string_lossy(),
            ),
            ("branch", &info.branch),
        ],
    );
    if let Some(token) = forbidden_token(&req.agent.program, &args) {
        let _ = worktree::remove(&req.project_root, &info.path);
        return Err(DispatchError::ForbiddenArgv { token });
    }

    let spec = CommandSpec {
        program: req.agent.program.clone(),
        args,
        cwd: info.path.clone(),
    };
    let command = format_command(&spec);
    let interactive = req.agent.interactive || req.agent.program.trim().is_empty();
    let now = deps.clock.now_rfc3339();
    // Always queued with no station. `queue::claim_next` is the only function
    // that assigns a station and moves the row to running / waiting_dispatch.
    let rec = TaskRecord {
        id: req.task_id.clone(),
        workspace_id: req.workspace_id.clone(),
        part_id: Some(req.part_id.clone()).filter(|s| !s.is_empty()),
        wire_id: Some(req.wire_id.clone()).filter(|s| !s.is_empty()),
        goal_json: goal,
        state: "queued".into(),
        station: None,
        worktree_path: Some(info.path.to_string_lossy().into_owned()),
        dispatched_at: Some(now),
        finished_at: None,
        result_json: Some(json!({
            "command": command,
            "argv": spec.args,
            "program": spec.program,
            "cwd": spec.cwd,
            "interactive": interactive,
            "requested_station": req.station,
        })),
    };
    if let Err(e) = db::put_task(deps.conn, &rec) {
        let _ = worktree::remove(&req.project_root, &info.path);
        return Err(DispatchError::Db {
            detail: e.to_string(),
        });
    }
    Ok(StartedDispatch {
        task: rec,
        spec,
        interactive,
    })
}

pub fn mark_running(
    conn: &Connection,
    task_id: &str,
    clock: &dyn Clock,
) -> Result<TaskRecord, DispatchError> {
    let mut rec = db::get_task(conn, task_id).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })?;
    rec.state = "running".into();
    if rec.dispatched_at.is_none() {
        rec.dispatched_at = Some(clock.now_rfc3339());
    }
    db::put_task(conn, &rec).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })?;
    Ok(rec)
}

pub fn apply_exit(
    conn: &Connection,
    task_id: &str,
    code: i32,
    clock: &dyn Clock,
) -> Result<TaskRecord, DispatchError> {
    let mut rec = db::get_task(conn, task_id).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })?;
    if rec.state == "paused" || rec.state == "abandoned" {
        return Ok(rec);
    }
    rec.state = state_after_exit(code).into();
    rec.finished_at = Some(clock.now_rfc3339());
    let mut result = rec.result_json.clone().unwrap_or_else(|| json!({}));
    if let Some(obj) = result.as_object_mut() {
        obj.insert("exit_code".into(), json!(code));
        obj.remove("progress");
    }
    rec.result_json = Some(result);
    db::put_task(conn, &rec).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })?;
    Ok(rec)
}

pub fn apply_spawn_failure(
    conn: &Connection,
    task_id: &str,
    detail: &str,
    clock: &dyn Clock,
) -> Result<TaskRecord, DispatchError> {
    let mut rec = db::get_task(conn, task_id).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })?;
    if rec.state == "paused" || rec.state == "abandoned" {
        return Ok(rec);
    }
    rec.state = "failed".into();
    rec.finished_at = Some(clock.now_rfc3339());
    let mut result = rec.result_json.clone().unwrap_or_else(|| json!({}));
    if let Some(obj) = result.as_object_mut() {
        obj.insert("error".into(), json!(detail));
    }
    rec.result_json = Some(result);
    db::put_task(conn, &rec).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })?;
    Ok(rec)
}

pub fn run_started(
    started: &StartedDispatch,
    deps: &DispatchDeps<'_>,
    runner: &dyn ProcessRunner,
    mut on_line: impl FnMut(OutputLine),
) -> Result<TaskRecord, DispatchError> {
    let rec = db::get_task(deps.conn, &started.task.id).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })?;
    match rec.state.as_str() {
        "queued" => return Ok(rec),
        "waiting_dispatch" => {
            let hint = OutputLine {
                stream: "stdout".into(),
                text: format!(
                    "interactive: run by hand\ncd {}\n{}",
                    started.spec.cwd.display(),
                    format_command(&started.spec)
                ),
            };
            let _ = append_log_line(deps.data_dir, &started.task.id, &hint);
            on_line(hint);
            return Ok(rec);
        }
        _ => {}
    }
    if started.interactive || rec.state == "waiting_dispatch" {
        let hint = OutputLine {
            stream: "stdout".into(),
            text: format!(
                "interactive: run by hand\ncd {}\n{}",
                started.spec.cwd.display(),
                format_command(&started.spec)
            ),
        };
        let _ = append_log_line(deps.data_dir, &started.task.id, &hint);
        on_line(hint);
        return Ok(rec);
    }
    let mut emit = |line: OutputLine| {
        let _ = append_log_line(deps.data_dir, &started.task.id, &line);
        on_line(line);
    };
    match runner.spawn(&started.spec, &mut emit) {
        Ok(status) => apply_exit(deps.conn, &started.task.id, status.code, deps.clock),
        Err(e) => apply_spawn_failure(deps.conn, &started.task.id, &e.to_string(), deps.clock),
    }
}

/// After the child exits: apply checking/failed, and on exit 0 verify
/// against done_criteria. `done` is only set by verification. The caller
/// runs `queue::claim_next` / `queue::drain` afterwards.
pub fn finish_process(
    conn: &Connection,
    data_dir: &Path,
    task_id: &str,
    code: i32,
    clock: &dyn Clock,
    proposal: Option<&Value>,
) -> Result<TaskRecord, DispatchError> {
    let rec = apply_exit(conn, task_id, code, clock)?;
    if rec.state == "checking" {
        crate::verify::verify_task(conn, data_dir, task_id, clock, proposal).map_err(|e| {
            DispatchError::Io {
                detail: e.to_string(),
            }
        })
    } else {
        Ok(rec)
    }
}

#[cfg(test)]
pub fn dispatch(
    req: &DispatchRequest,
    deps: &DispatchDeps<'_>,
    runner: &dyn ProcessRunner,
) -> Result<TaskRecord, DispatchError> {
    let started = start_dispatch(req, deps)?;
    let now = deps.clock.now_rfc3339();
    let _ = crate::queue::claim_next(deps.conn, &now).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })?;
    let rec = db::get_task(deps.conn, &started.task.id).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })?;
    let started = StartedDispatch {
        task: rec,
        spec: started.spec,
        interactive: started.interactive,
    };
    let rec = run_started(&started, deps, runner, |_| {})?;
    if rec.state == "checking" || rec.state == "failed" {
        if rec.state == "checking" {
            let _ = crate::verify::verify_task(
                deps.conn,
                deps.data_dir,
                &started.task.id,
                deps.clock,
                None,
            );
        }
        let _ = crate::queue::claim_next(deps.conn, &now);
    }
    db::get_task(deps.conn, &started.task.id).map_err(|e| DispatchError::Db {
        detail: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::{FrozenClock, ScriptedRunner};
    use crate::scanner::snapshot_tree;
    use crate::worktree::init_git_fixture;
    use std::fs;

    struct Harness {
        _tmp: tempfile::TempDir,
        conn: Connection,
        project: PathBuf,
        data: PathBuf,
        workspace_id: String,
        clock: FrozenClock,
    }

    fn harness() -> Harness {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        let data = tmp.path().join("data");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&data).unwrap();
        init_git_fixture(&project);
        let conn = db::open(&data.join("tinman.db")).unwrap();
        let ws = db::create_workspace(&conn, "fix", project.to_str().unwrap()).unwrap();
        Harness {
            _tmp: tmp,
            conn,
            project,
            data,
            workspace_id: ws.id,
            clock: FrozenClock("2026-09-09T00:00:00+00:00".into()),
        }
    }

    fn req(h: &Harness, task_id: &str, agent: AgentConfig) -> DispatchRequest {
        DispatchRequest {
            task_id: task_id.into(),
            workspace_id: h.workspace_id.clone(),
            part_id: "part-1".into(),
            wire_id: "wire-1".into(),
            project_root: h.project.clone(),
            goal: json!({
                "task_id": task_id,
                "project": { "name": "fix", "root": h.project },
                "target": { "slot": "left_leg", "part": "infra", "wire": "ci" },
                "user_intent_verbatim": ["do the thing"],
                "attachments": [],
                "facts": { "last_commit": "" },
                "framework_advice": {
                    "next_step": "write the test",
                    "entry_point": ".",
                    "shared_risk": "shared"
                },
                "done_criteria": ["a", "b", "c"],
                "assumptions": [],
                "workspace": { "worktree_path": "", "branch": "" },
                "delivery_format": "变更说明 + 自测结果 + 未完成项",
                "authorization": {
                    "allow_push": false,
                    "allow_deploy": false,
                    "allow_spend": false
                }
            }),
            agent,
            station: "This PC".into(),
        }
    }

    fn echo_agent() -> AgentConfig {
        AgentConfig {
            id: "this-pc".into(),
            label: "This PC".into(),
            program: "stub".into(),
            argv_template: vec!["{{goal_path}}".into()],
            interactive: false,
        }
    }

    fn deps<'a>(h: &'a Harness) -> DispatchDeps<'a> {
        DispatchDeps {
            conn: &h.conn,
            data_dir: &h.data,
            clock: &h.clock,
        }
    }

    fn task_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM task", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn c3_worktree_is_outside_the_scanned_tree() {
        let h = harness();
        let started = start_dispatch(&req(&h, "t_out1", echo_agent()), &deps(&h)).unwrap();
        let wt = PathBuf::from(started.task.worktree_path.as_ref().unwrap());
        let proj = h.project.canonicalize().unwrap();
        let wt_c = wt.canonicalize().unwrap();
        assert!(
            !wt_c.starts_with(&proj),
            "worktree {wt_c:?} is under project {proj:?}"
        );
        let list = crate::gitutil::git(&h.project, &["worktree", "list"]).unwrap();
        assert!(
            worktree::list_contains_path(&list, &wt),
            "git worktree list missing {wt:?}: {list}"
        );
        assert_eq!(started.task.goal_json["workspace"]["branch"], "tinman/t_out1");
    }

    #[test]
    fn c3_scanned_tree_is_byte_identical_after_dispatch() {
        let h = harness();
        let before = snapshot_tree(&h.project).unwrap();
        start_dispatch(&req(&h, "t_snap", echo_agent()), &deps(&h)).unwrap();
        let after = snapshot_tree(&h.project).unwrap();
        assert_eq!(
            before, after,
            "scanned tree mtime+size changed — dispatch must not write the project"
        );
    }

    #[test]
    fn c3_two_tasks_get_different_worktrees_and_branches() {
        let h = harness();
        let a = start_dispatch(&req(&h, "t_aaa", echo_agent()), &deps(&h)).unwrap();
        let b = start_dispatch(&req(&h, "t_bbb", echo_agent()), &deps(&h)).unwrap();
        assert_ne!(a.task.worktree_path, b.task.worktree_path);
        assert_ne!(
            a.task.goal_json["workspace"]["branch"],
            b.task.goal_json["workspace"]["branch"]
        );
        let dir_a = PathBuf::from(a.task.worktree_path.unwrap());
        let dir_b = PathBuf::from(b.task.worktree_path.unwrap());
        assert_ne!(dir_a, dir_b);
        assert!(dir_a.exists());
        assert!(dir_b.exists());
    }

    #[test]
    fn c3_dispatch_without_git_repo_is_typed_error_and_writes_no_task_row() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("notgit");
        let data = tmp.path().join("data");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&data).unwrap();
        fs::write(project.join("README.md"), "no git\n").unwrap();
        let conn = db::open(&data.join("tinman.db")).unwrap();
        let ws = db::create_workspace(&conn, "bare", project.to_str().unwrap()).unwrap();
        let clock = FrozenClock("2026-09-09T00:00:00+00:00".into());
        let h_like = DispatchRequest {
            task_id: "t_nogit".into(),
            workspace_id: ws.id.clone(),
            part_id: "p".into(),
            wire_id: "w".into(),
            project_root: project,
            goal: json!({"task_id": "t_nogit"}),
            agent: echo_agent(),
            station: "This PC".into(),
        };
        let err = start_dispatch(
            &h_like,
            &DispatchDeps {
                conn: &conn,
                data_dir: &data,
                clock: &clock,
            },
        )
        .unwrap_err();
        assert_eq!(err, DispatchError::NotAGitRepo);
        assert_eq!(task_count(&conn), 0);
    }

    #[test]
    fn c3_dispatch_refuses_a_command_whose_argv_contains_push() {
        let h = harness();
        let agent = AgentConfig {
            id: "this-pc".into(),
            label: "This PC".into(),
            program: "git".into(),
            argv_template: vec!["push".into(), "origin".into()],
            interactive: false,
        };
        let err = start_dispatch(&req(&h, "t_push", agent), &deps(&h)).unwrap_err();
        assert_eq!(
            err,
            DispatchError::ForbiddenArgv {
                token: "push".into()
            }
        );
        assert_eq!(task_count(&h.conn), 0);
        assert!(!worktree::planned_path(&h.data, "t_push").exists());
    }

    #[test]
    fn c5_exit_zero_is_checking_not_done() {
        let h = harness();
        let runner = ScriptedRunner::new(vec!["ok"], 0);
        let rec = dispatch(&req(&h, "t_chk", echo_agent()), &deps(&h), &runner).unwrap();
        assert_eq!(rec.state, "checking");
        assert_ne!(rec.state, "done");
        assert_eq!(rec.result_json.as_ref().unwrap()["exit_code"], 0);
        let loaded = db::get_task(&h.conn, "t_chk").unwrap();
        assert_eq!(loaded.state, "checking");
        assert_eq!(loaded.goal_json["task_id"], "t_chk");
    }

    #[test]
    fn branch_already_exists_is_typed_and_writes_no_task() {
        let h = harness();
        crate::gitutil::git(&h.project, &["branch", "tinman/t_dup"]).unwrap();
        let err = start_dispatch(&req(&h, "t_dup", echo_agent()), &deps(&h)).unwrap_err();
        assert_eq!(
            err,
            DispatchError::BranchExists {
                branch: "tinman/t_dup".into()
            }
        );
        assert_eq!(task_count(&h.conn), 0);
    }

    #[test]
    fn apply_exit_never_writes_done() {
        assert_eq!(state_after_exit(0), "checking");
        assert_eq!(state_after_exit(1), "failed");
        assert_eq!(state_after_exit(-1), "failed");
    }

    #[test]
    fn interactive_does_not_spawn() {
        let h = harness();
        let mut agent = echo_agent();
        agent.interactive = true;
        let runner = ScriptedRunner::new(vec!["should-not-run"], 0);
        let rec = dispatch(&req(&h, "t_int", agent), &deps(&h), &runner).unwrap();
        assert_eq!(rec.state, "waiting_dispatch");
        assert!(runner.spawned.lock().unwrap().is_empty());
    }
}
