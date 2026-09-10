//! Stations, queue claiming, dependency holding, crash recovery.
//!
//! The board is derived from the `task` table plus `station_count` in app
//! prefs (default 2). Occupancy is a function of task state: `running` and
//! `waiting_dispatch` hold a station; `queued`, `checking`, `done`, `failed`
//! do not. `claim_next` is the only function that assigns a free station to
//! a queued task.

use std::cmp::Ordering;
use std::collections::HashSet;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::{self, TaskRecord};
use crate::error::Result;
use crate::runner::Clock;

pub const DEFAULT_STATION_COUNT: usize = 2;
pub const CRASH_REASON: &str = "process did not survive app restart";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Station {
    pub id: String,
    pub label: String,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Board {
    pub station_count: usize,
    pub stations: Vec<Station>,
    pub queue: Vec<String>,
}

/// Hard ceiling on stations. Each occupied station is a child process, two
/// reader threads and a pipe pair, and the UI renders a card per station, so an
/// unbounded value out of prefs exhausts threads and file descriptors.
pub const MAX_STATION_COUNT: usize = 8;

pub fn station_count(prefs: &Value) -> usize {
    prefs
        .get("station_count")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .filter(|&n| n >= 1)
        .map(|n| n.min(MAX_STATION_COUNT))
        .unwrap_or(DEFAULT_STATION_COUNT)
}

pub fn occupies_station(state: &str) -> bool {
    matches!(state, "running" | "waiting_dispatch")
}

pub fn station_id(n: usize) -> String {
    n.to_string()
}

/// Contention keys for a task.
///
/// 1. `wire:<wire_id>` when the task targets a wire.
/// 2. `risk:<normalized shared_risk>` from `framework_advice.shared_risk`.
///
/// Empty / placeholder shared_risk strings are ignored so hand-filled cards
/// ("与相邻部位共用约定…") do not serialize the whole queue behind one key.
/// This is a heuristic: paraphrases of the same surface, unnamed shared
/// files, and two tasks that touch the same crate under different risk
/// strings will not collide.
pub fn contention_keys(task: &TaskRecord) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(w) = task
        .wire_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        keys.push(format!("wire:{w}"));
    }
    if let Some(risk) = normalize_shared_risk(shared_risk_of(task)) {
        keys.push(format!("risk:{risk}"));
    }
    keys
}

fn shared_risk_of(task: &TaskRecord) -> &str {
    task.goal_json
        .get("framework_advice")
        .and_then(|a| a.get("shared_risk"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

pub fn normalize_shared_risk(raw: &str) -> Option<String> {
    let t = raw
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if t.is_empty() {
        return None;
    }
    const IGNORE: &[&str] = &["none", "n/a", "na", "-", "无", "没有", "n.a.", "null"];
    if IGNORE.contains(&t.as_str()) {
        return None;
    }
    if t.contains("与相邻部位共用约定") {
        return None;
    }
    Some(t)
}

fn keys_overlap(a: &[String], b: &[String]) -> bool {
    a.iter().any(|k| b.iter().any(|o| o == k))
}

fn earlier(a: &TaskRecord, b: &TaskRecord) -> bool {
    match (&a.dispatched_at, &b.dispatched_at) {
        (Some(x), Some(y)) if x != y => x < y,
        (Some(_), None) => true,
        (None, Some(_)) => false,
        _ => a.id < b.id,
    }
}

/// A queued task is runnable unless an unfinished task already owns its
/// shared surface. `done` releases the surface. `failed` does not — the
/// owner never finished, so dependents stay queued.
pub fn is_runnable(task: &TaskRecord, all: &[TaskRecord]) -> bool {
    if task.state != "queued" {
        return false;
    }
    let keys = contention_keys(task);
    if keys.is_empty() {
        return true;
    }
    for other in all {
        if other.id == task.id || other.state == "done" || other.state == "abandoned" {
            continue;
        }
        if !keys_overlap(&keys, &contention_keys(other)) {
            continue;
        }
        if other.state != "queued" {
            return false;
        }
        if earlier(other, task) {
            return false;
        }
    }
    true
}

pub fn derive_board(tasks: &[TaskRecord], count: usize) -> Board {
    let n = count.max(1);
    let mut stations: Vec<Station> = (1..=n)
        .map(|i| Station {
            id: station_id(i),
            label: format!("工位 {i}"),
            task_id: None,
        })
        .collect();

    let occupying: Vec<&TaskRecord> = tasks
        .iter()
        .filter(|t| occupies_station(&t.state))
        .collect();
    let mut assigned: HashSet<String> = HashSet::new();

    for t in &occupying {
        if let Some(sid) = &t.station {
            if let Some(st) = stations
                .iter_mut()
                .find(|s| s.id == *sid && s.task_id.is_none())
            {
                st.task_id = Some(t.id.clone());
                assigned.insert(t.id.clone());
            }
        }
    }
    for t in occupying {
        if assigned.contains(&t.id) {
            continue;
        }
        if let Some(st) = stations.iter_mut().find(|s| s.task_id.is_none()) {
            st.task_id = Some(t.id.clone());
        }
    }

    let mut queued: Vec<&TaskRecord> = tasks.iter().filter(|t| t.state == "queued").collect();
    queued.sort_by(|a, b| match (earlier(a, b), earlier(b, a)) {
        (true, _) => Ordering::Less,
        (_, true) => Ordering::Greater,
        _ => Ordering::Equal,
    });

    Board {
        station_count: n,
        stations,
        queue: queued.into_iter().map(|t| t.id.clone()).collect(),
    }
}

pub fn board_from_db(conn: &Connection) -> Result<Board> {
    let prefs = db::get_app_prefs(conn)?;
    let tasks = db::list_all_tasks(conn)?;
    Ok(derive_board(&tasks, station_count(&prefs)))
}

fn is_interactive(task: &TaskRecord) -> bool {
    task.result_json
        .as_ref()
        .and_then(|v| v.get("interactive"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Find a free station, take the oldest runnable queued task, mark it
/// occupying that station. One caller: after a terminal transition and at
/// startup. Returns None when every station is busy or nothing is runnable.
pub fn claim_next(conn: &Connection, now: &str) -> Result<Option<TaskRecord>> {
    let prefs = db::get_app_prefs(conn)?;
    let count = station_count(&prefs);
    let all = db::list_all_tasks(conn)?;
    let board = derive_board(&all, count);
    let Some(free) = board.stations.iter().find(|s| s.task_id.is_none()) else {
        return Ok(None);
    };
    let free_id = free.id.clone();

    let mut queued: Vec<TaskRecord> = all
        .iter()
        .filter(|t| t.state == "queued")
        .cloned()
        .collect();
    queued.sort_by(|a, b| match (earlier(a, b), earlier(b, a)) {
        (true, _) => Ordering::Less,
        (_, true) => Ordering::Greater,
        _ => Ordering::Equal,
    });

    let Some(mut rec) = queued.into_iter().find(|t| is_runnable(t, &all)) else {
        return Ok(None);
    };
    rec.station = Some(free_id);
    rec.state = if is_interactive(&rec) {
        "waiting_dispatch".into()
    } else {
        "running".into()
    };
    if rec.dispatched_at.is_none() {
        rec.dispatched_at = Some(now.to_string());
    }
    db::put_task(conn, &rec)?;
    Ok(Some(rec))
}

/// Drain every free station. Stops when `claim_next` returns None.
pub fn drain(conn: &Connection, now: &str) -> Result<Vec<TaskRecord>> {
    let mut claimed = Vec::new();
    while let Some(rec) = claim_next(conn, now)? {
        claimed.push(rec);
    }
    Ok(claimed)
}

/// A `running` row did not survive the process that was running it.
/// Move it to `failed` with a recorded reason. Worktree is kept.
/// `waiting_dispatch` is left alone: no child was running.
pub fn recover_crashed(conn: &Connection, clock: &dyn Clock) -> Result<Vec<TaskRecord>> {
    let all = db::list_all_tasks(conn)?;
    let now = clock.now_rfc3339();
    let mut recovered = Vec::new();
    for mut rec in all {
        if rec.state != "running" {
            continue;
        }
        rec.state = "failed".into();
        rec.finished_at = Some(now.clone());
        let mut result = rec.result_json.clone().unwrap_or_else(|| json!({}));
        if let Some(obj) = result.as_object_mut() {
            obj.insert("error".into(), json!(CRASH_REASON));
            obj.insert("recovered".into(), json!(true));
        } else {
            result = json!({
                "error": CRASH_REASON,
                "recovered": true,
            });
        }
        rec.result_json = Some(result);
        db::put_task(conn, &rec)?;
        recovered.push(rec);
    }
    Ok(recovered)
}

pub fn can_pause(state: &str) -> bool {
    matches!(state, "queued" | "waiting_dispatch" | "running")
}

/// Stop the child (caller sends SIGTERM) and free the station.
/// The worktree is kept. A paused row does not occupy a station, so the
/// board cannot deadlock the way a stuck `checking` row would.
pub fn pause(conn: &Connection, task_id: &str, _clock: &dyn Clock) -> Result<TaskRecord> {
    let mut rec = db::get_task(conn, task_id)?;
    if !can_pause(&rec.state) {
        return Err(crate::error::AppError::msg(format!(
            "cannot pause task in state {}",
            rec.state
        )));
    }
    let was_running = rec.state == "running";
    rec.state = "paused".into();
    rec.station = None;
    let mut result = rec.result_json.clone().unwrap_or_else(|| json!({}));
    if let Some(obj) = result.as_object_mut() {
        obj.insert(
            "pause".into(),
            json!({
                "stopped_process": was_running,
                "station_released": true,
                "note": "child process sent SIGTERM if it was running; worktree kept"
            }),
        );
        obj.remove("progress");
    }
    rec.result_json = Some(result);
    db::put_task(conn, &rec)?;
    Ok(rec)
}

/// Return a paused task to `queued`. Caller runs `drain` afterwards.
pub fn resume(conn: &Connection, task_id: &str) -> Result<TaskRecord> {
    let mut rec = db::get_task(conn, task_id)?;
    if rec.state != "paused" {
        return Err(crate::error::AppError::msg(format!(
            "cannot resume task in state {}",
            rec.state
        )));
    }
    rec.state = "queued".into();
    rec.station = None;
    rec.finished_at = None;
    db::put_task(conn, &rec)?;
    Ok(rec)
}

/// Abandon a task, keep the worktree, free the station.
/// Removal of the worktree is a separate, explicit action.
pub fn abandon(conn: &Connection, task_id: &str, clock: &dyn Clock) -> Result<TaskRecord> {
    let mut rec = db::get_task(conn, task_id)?;
    if rec.state == "done" {
        return Err(crate::error::AppError::msg(
            "cannot abandon a done task",
        ));
    }
    rec.state = "abandoned".into();
    rec.station = None;
    rec.finished_at = Some(clock.now_rfc3339());
    let mut result = rec.result_json.clone().unwrap_or_else(|| json!({}));
    if let Some(obj) = result.as_object_mut() {
        obj.insert("abandoned".into(), json!(true));
        obj.insert("worktree_kept".into(), json!(true));
        obj.remove("progress");
    }
    rec.result_json = Some(result);
    db::put_task(conn, &rec)?;
    Ok(rec)
}

#[cfg(test)]
mod tests {

    #[test]
    fn station_count_is_clamped_to_the_ceiling() {
        assert_eq!(
            station_count(&serde_json::json!({ "station_count": 100_000 })),
            MAX_STATION_COUNT
        );
        assert_eq!(station_count(&serde_json::json!({ "station_count": 4 })), 4);
        assert_eq!(
            station_count(&serde_json::json!({ "station_count": 0 })),
            DEFAULT_STATION_COUNT
        );
    }
    use super::*;
    use crate::dispatch::{self, AgentConfig, DispatchDeps, DispatchRequest};
    use crate::runner::FrozenClock;
    use crate::worktree::{self, init_git_fixture};
    use std::path::PathBuf;

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
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&data).unwrap();
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

    fn echo_agent() -> AgentConfig {
        AgentConfig {
            id: "this-pc".into(),
            label: "This PC".into(),
            program: "stub".into(),
            argv_template: vec!["{{goal_path}}".into()],
            interactive: false,
        }
    }

    fn rec(
        h: &Harness,
        id: &str,
        state: &str,
        station: Option<&str>,
        dispatched: &str,
        wire: &str,
        risk: &str,
    ) -> TaskRecord {
        TaskRecord {
            id: id.into(),
            workspace_id: h.workspace_id.clone(),
            part_id: Some("part-1".into()),
            wire_id: Some(wire.into()),
            goal_json: json!({
                "task_id": id,
                "framework_advice": {
                    "next_step": "do",
                    "entry_point": ".",
                    "shared_risk": risk
                },
                "done_criteria": ["a", "b", "c"],
            }),
            state: state.into(),
            station: station.map(|s| s.into()),
            worktree_path: Some(format!("/tmp/wt/{id}")),
            dispatched_at: Some(dispatched.into()),
            finished_at: None,
            result_json: Some(json!({"interactive": false, "command": "stub"})),
        }
    }

    fn put(h: &Harness, t: TaskRecord) {
        db::put_task(&h.conn, &t).unwrap();
    }

    #[test]
    fn c1_default_station_count_is_two() {
        let h = harness();
        let prefs = db::get_app_prefs(&h.conn).unwrap();
        assert_eq!(station_count(&prefs), 2);
        assert_eq!(station_count(&json!({})), 2);
        let board = board_from_db(&h.conn).unwrap();
        assert_eq!(board.station_count, 2);
        assert_eq!(board.stations.len(), 2);
        assert_eq!(board.stations[0].id, "1");
        assert_eq!(board.stations[1].id, "2");
        assert!(board.stations.iter().all(|s| s.task_id.is_none()));
    }

    #[test]
    fn c1_third_task_queues_when_two_stations_are_busy() {
        let h = harness();
        put(
            &h,
            rec(
                &h,
                "t1",
                "running",
                Some("1"),
                "2026-09-09T00:00:01+00:00",
                "w-a",
                "alpha",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t2",
                "running",
                Some("2"),
                "2026-09-09T00:00:02+00:00",
                "w-b",
                "beta",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t3",
                "queued",
                None,
                "2026-09-09T00:00:03+00:00",
                "w-c",
                "gamma",
            ),
        );
        let claimed = claim_next(&h.conn, "2026-09-09T00:00:04+00:00").unwrap();
        assert!(claimed.is_none(), "no free station, third task must wait");
        let board = board_from_db(&h.conn).unwrap();
        assert_eq!(board.stations[0].task_id.as_deref(), Some("t1"));
        assert_eq!(board.stations[1].task_id.as_deref(), Some("t2"));
        assert_eq!(board.queue, vec!["t3".to_string()]);
        assert_eq!(db::get_task(&h.conn, "t3").unwrap().state, "queued");
    }

    #[test]
    fn c1_freed_station_claims_next_queued_task_without_user_action() {
        let h = harness();
        put(
            &h,
            rec(
                &h,
                "t1",
                "running",
                Some("1"),
                "2026-09-09T00:00:01+00:00",
                "w-a",
                "alpha",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t2",
                "running",
                Some("2"),
                "2026-09-09T00:00:02+00:00",
                "w-b",
                "beta",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t3",
                "queued",
                None,
                "2026-09-09T00:00:03+00:00",
                "w-c",
                "gamma",
            ),
        );

        let mut t1 = db::get_task(&h.conn, "t1").unwrap();
        t1.state = "failed".into();
        t1.finished_at = Some("2026-09-09T00:00:05+00:00".into());
        db::put_task(&h.conn, &t1).unwrap();

        let claimed = claim_next(&h.conn, "2026-09-09T00:00:06+00:00")
            .unwrap()
            .expect("freed station must claim t3");
        assert_eq!(claimed.id, "t3");
        assert_eq!(claimed.state, "running");
        assert_eq!(claimed.station.as_deref(), Some("1"));
        let board = board_from_db(&h.conn).unwrap();
        assert_eq!(board.stations[0].task_id.as_deref(), Some("t3"));
        assert_eq!(board.stations[1].task_id.as_deref(), Some("t2"));
        assert!(board.queue.is_empty());
    }

    #[test]
    fn c2_one_failure_leaves_other_tasks_untouched() {
        let h = harness();
        put(
            &h,
            rec(
                &h,
                "t_fail",
                "running",
                Some("1"),
                "2026-09-09T00:00:01+00:00",
                "w-a",
                "alpha",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t_keep",
                "running",
                Some("2"),
                "2026-09-09T00:00:02+00:00",
                "w-b",
                "beta",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t_wait",
                "queued",
                None,
                "2026-09-09T00:00:03+00:00",
                "w-c",
                "gamma",
            ),
        );

        let before_keep = db::get_task(&h.conn, "t_keep").unwrap();
        dispatch::apply_exit(&h.conn, "t_fail", 1, &h.clock).unwrap();
        let after_fail = db::get_task(&h.conn, "t_fail").unwrap();
        assert_eq!(after_fail.state, "failed");

        let after_keep = db::get_task(&h.conn, "t_keep").unwrap();
        assert_eq!(after_keep.state, before_keep.state);
        assert_eq!(after_keep.station, before_keep.station);
        assert_eq!(after_keep.goal_json, before_keep.goal_json);
        assert_eq!(after_keep.result_json, before_keep.result_json);

        let claimed = claim_next(&h.conn, "2026-09-09T00:00:07+00:00")
            .unwrap()
            .expect("queue still drains onto the freed station");
        assert_eq!(claimed.id, "t_wait");
        assert_eq!(claimed.state, "running");
        assert_eq!(db::get_task(&h.conn, "t_keep").unwrap().state, "running");
        assert_eq!(db::get_task(&h.conn, "t_fail").unwrap().state, "failed");
    }

    #[test]
    fn c2_failed_task_keeps_its_worktree() {
        let h = harness();
        let req = DispatchRequest {
            task_id: "t_keepwt".into(),
            workspace_id: h.workspace_id.clone(),
            part_id: "part-1".into(),
            wire_id: "w-a".into(),
            project_root: h.project.clone(),
            goal: json!({"task_id": "t_keepwt", "done_criteria": ["a", "b", "c"]}),
            agent: echo_agent(),
            station: "This PC".into(),
        };
        let deps = DispatchDeps {
            conn: &h.conn,
            data_dir: &h.data,
            clock: &h.clock,
        };
        let started = dispatch::start_dispatch(&req, &deps).unwrap();
        let path = PathBuf::from(started.task.worktree_path.as_ref().unwrap());
        assert!(path.exists());
        dispatch::apply_exit(&h.conn, "t_keepwt", 1, &h.clock).unwrap();
        assert!(
            path.exists(),
            "failure must not remove the worktree"
        );
        let list = crate::gitutil::git(&h.project, &["worktree", "list"]).unwrap();
        assert!(worktree::list_contains_path(&list, &path));
        assert_eq!(db::get_task(&h.conn, "t_keepwt").unwrap().state, "failed");
    }

    #[test]
    fn c5_stations_and_queue_rebuild_from_the_database() {
        let h = harness();
        put(
            &h,
            rec(
                &h,
                "t1",
                "running",
                Some("1"),
                "2026-09-09T00:00:01+00:00",
                "w-a",
                "alpha",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t2",
                "queued",
                None,
                "2026-09-09T00:00:02+00:00",
                "w-b",
                "beta",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t3",
                "failed",
                Some("1"),
                "2026-09-09T00:00:00+00:00",
                "w-c",
                "gamma",
            ),
        );
        let before = board_from_db(&h.conn).unwrap();
        assert_eq!(before.stations[0].task_id.as_deref(), Some("t1"));
        assert_eq!(before.stations[1].task_id, None);
        assert_eq!(before.queue, vec!["t2".to_string()]);

        let path = h.data.join("tinman.db");
        drop(h.conn);
        let conn2 = db::open(&path).unwrap();
        let after = board_from_db(&conn2).unwrap();
        assert_eq!(after.station_count, before.station_count);
        assert_eq!(after.stations, before.stations);
        assert_eq!(after.queue, before.queue);
        let listed = db::list_all_tasks(&conn2).unwrap();
        assert_eq!(listed.len(), 3);
        assert!(listed.iter().any(|t| t.id == "t3" && t.state == "failed"));
    }

    #[test]
    fn c5_task_left_running_by_a_crash_is_recovered_not_left_running() {
        let h = harness();
        put(
            &h,
            rec(
                &h,
                "t_run",
                "running",
                Some("1"),
                "2026-09-09T00:00:01+00:00",
                "w-a",
                "alpha",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t_wait",
                "waiting_dispatch",
                Some("2"),
                "2026-09-09T00:00:02+00:00",
                "w-b",
                "beta",
            ),
        );
        let recovered = recover_crashed(&h.conn, &h.clock).unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].id, "t_run");
        let run = db::get_task(&h.conn, "t_run").unwrap();
        assert_eq!(run.state, "failed");
        assert_ne!(run.state, "running");
        assert_eq!(
            run.result_json.as_ref().unwrap()["error"],
            CRASH_REASON
        );
        assert_eq!(run.result_json.as_ref().unwrap()["recovered"], true);
        let wait = db::get_task(&h.conn, "t_wait").unwrap();
        assert_eq!(wait.state, "waiting_dispatch");
        let board = board_from_db(&h.conn).unwrap();
        assert_eq!(board.stations[0].task_id, None);
        assert_eq!(board.stations[1].task_id.as_deref(), Some("t_wait"));
    }

    #[test]
    fn failed_owner_holds_shared_surface_so_dependent_stays_queued() {
        let h = harness();
        put(
            &h,
            rec(
                &h,
                "t_owner",
                "failed",
                Some("1"),
                "2026-09-09T00:00:01+00:00",
                "w-shared",
                "db.rs schema",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t_dep",
                "queued",
                None,
                "2026-09-09T00:00:02+00:00",
                "w-other",
                "db.rs schema",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t_free",
                "queued",
                None,
                "2026-09-09T00:00:03+00:00",
                "w-ui",
                "frontend",
            ),
        );
        let claimed = claim_next(&h.conn, "2026-09-09T00:00:04+00:00")
            .unwrap()
            .expect("independent task is runnable");
        assert_eq!(claimed.id, "t_free");
        assert_eq!(db::get_task(&h.conn, "t_dep").unwrap().state, "queued");
        let second = claim_next(&h.conn, "2026-09-09T00:00:05+00:00").unwrap();
        assert!(
            second.is_none(),
            "dependent of a failed shared_risk owner must stay queued, got {:?}",
            second.as_ref().map(|t| &t.id)
        );
        assert_eq!(db::get_task(&h.conn, "t_dep").unwrap().state, "queued");
    }

    #[test]
    fn configurable_station_count_from_prefs() {
        let h = harness();
        db::set_app_prefs(&h.conn, &json!({"station_count": 3})).unwrap();
        assert_eq!(station_count(&db::get_app_prefs(&h.conn).unwrap()), 3);
        put(
            &h,
            rec(
                &h,
                "t1",
                "queued",
                None,
                "2026-09-09T00:00:01+00:00",
                "w-a",
                "a",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t2",
                "queued",
                None,
                "2026-09-09T00:00:02+00:00",
                "w-b",
                "b",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t3",
                "queued",
                None,
                "2026-09-09T00:00:03+00:00",
                "w-c",
                "c",
            ),
        );
        let claimed = drain(&h.conn, "2026-09-09T00:00:04+00:00").unwrap();
        assert_eq!(claimed.len(), 3);
        let board = board_from_db(&h.conn).unwrap();
        assert_eq!(board.stations.len(), 3);
        assert!(board.queue.is_empty());
    }

    #[test]
    fn pause_frees_or_holds_its_station() {
        let h = harness();
        put(
            &h,
            rec(
                &h,
                "t1",
                "running",
                Some("1"),
                "2026-09-09T00:00:01+00:00",
                "w-a",
                "alpha",
            ),
        );
        put(
            &h,
            rec(
                &h,
                "t2",
                "queued",
                None,
                "2026-09-09T00:00:02+00:00",
                "w-b",
                "beta",
            ),
        );
        let paused = pause(&h.conn, "t1", &h.clock).unwrap();
        assert_eq!(paused.state, "paused");
        assert!(paused.station.is_none());
        assert!(!occupies_station("paused"));
        let claimed = claim_next(&h.conn, "2026-09-09T00:00:04+00:00")
            .unwrap()
            .expect("paused task must free its station");
        assert_eq!(claimed.id, "t2");
        assert_eq!(claimed.state, "running");
        let board = board_from_db(&h.conn).unwrap();
        assert_eq!(board.stations[0].task_id.as_deref(), Some("t2"));
        assert_eq!(db::get_task(&h.conn, "t1").unwrap().state, "paused");
    }

    #[test]
    fn c1_pause_resume_round_trip() {
        let h = harness();
        put(
            &h,
            rec(
                &h,
                "t1",
                "running",
                Some("1"),
                "2026-09-09T00:00:01+00:00",
                "w-a",
                "alpha",
            ),
        );
        pause(&h.conn, "t1", &h.clock).unwrap();
        assert_eq!(db::get_task(&h.conn, "t1").unwrap().state, "paused");
        resume(&h.conn, "t1").unwrap();
        assert_eq!(db::get_task(&h.conn, "t1").unwrap().state, "queued");
        let claimed = claim_next(&h.conn, "2026-09-09T00:00:05+00:00")
            .unwrap()
            .expect("resumed task is runnable");
        assert_eq!(claimed.id, "t1");
        assert_eq!(claimed.state, "running");
        assert_eq!(claimed.station.as_deref(), Some("1"));
    }

    #[test]
    fn abandon_keeps_worktree_on_disk() {
        let h = harness();
        let req = DispatchRequest {
            task_id: "t_abwt".into(),
            workspace_id: h.workspace_id.clone(),
            part_id: "part-1".into(),
            wire_id: "w-a".into(),
            project_root: h.project.clone(),
            goal: json!({"task_id": "t_abwt", "done_criteria": ["a", "b", "c"]}),
            agent: echo_agent(),
            station: "This PC".into(),
        };
        let deps = DispatchDeps {
            conn: &h.conn,
            data_dir: &h.data,
            clock: &h.clock,
        };
        let started = dispatch::start_dispatch(&req, &deps).unwrap();
        let path = PathBuf::from(started.task.worktree_path.as_ref().unwrap());
        assert!(path.exists());
        abandon(&h.conn, "t_abwt", &h.clock).unwrap();
        assert!(
            path.exists(),
            "abandon must not remove the worktree"
        );
        let list = crate::gitutil::git(&h.project, &["worktree", "list"]).unwrap();
        assert!(worktree::list_contains_path(&list, &path));
        let rec = db::get_task(&h.conn, "t_abwt").unwrap();
        assert_eq!(rec.state, "abandoned");
        assert!(rec.station.is_none());
        assert_eq!(rec.result_json.as_ref().unwrap()["worktree_kept"], true);
    }
}
