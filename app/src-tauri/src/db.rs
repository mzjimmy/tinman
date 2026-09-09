use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::llm::CallLogEntry;

pub const APP_PREFS_ID: &str = "__tinman_app__";
pub const ALL_SLOTS: &[&str] = &[
    "head",
    "torso",
    "left_arm",
    "right_arm",
    "left_leg",
    "right_leg",
    "backpack",
];

const MIGRATION: &str = include_str!("../migrations/001_init.sql");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Criterion {
    pub text: String,
    pub met: bool,
    #[serde(default)]
    pub evidence: String,
}

/// Write shape for a wire. There is no `progress` field; the store derives it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WireInput {
    pub id: Option<String>,
    pub label: String,
    pub criteria: Vec<Criterion>,
    #[serde(default)]
    pub blocked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WireRecord {
    pub id: String,
    pub part_id: String,
    pub label: String,
    pub criteria: Vec<Criterion>,
    /// Derived from criteria on every read. Never accepted from a caller.
    pub progress: i64,
    pub status: String,
    pub evidence_json: Option<Value>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PartRecord {
    pub id: String,
    pub workspace_id: String,
    pub slot: String,
    pub label: String,
    pub weight: f64,
    pub planned_start: Option<String>,
    pub status: String,
    pub wires: Vec<WireRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub llm_profile_id: Option<String>,
    pub prefs: Value,
    pub parts: Vec<PartRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub llm_profile_id: Option<String>,
    pub prefs: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProposedWire {
    pub label: String,
    pub criteria: Vec<Criterion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProposedPart {
    pub slot: String,
    pub present: bool,
    pub label: String,
    pub weight: f64,
    #[serde(default)]
    pub planned_start: Option<String>,
    #[serde(default)]
    pub module_paths: Vec<String>,
    #[serde(default)]
    pub wires: Vec<ProposedWire>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MapProposal {
    pub parts: Vec<ProposedPart>,
}

pub fn open(path: &std::path::Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.execute_batch(MIGRATION)?;
    ensure_app_prefs(&conn)?;
    Ok(conn)
}

pub fn ensure_app_prefs(conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO workspace (id, name, root_path, created_at, llm_profile_id, prefs_json)
         VALUES (?1, 'Tinman', '', ?2, NULL, '{}')",
        params![APP_PREFS_ID, now()],
    )?;
    Ok(())
}

pub fn derived_progress(criteria: &[Criterion]) -> i64 {
    if criteria.is_empty() {
        return 0;
    }
    let met = criteria.iter().filter(|c| c.met).count();
    ((met as f64 / criteria.len() as f64) * 100.0).round() as i64
}

pub fn derived_wire_status(criteria: &[Criterion], blocked: bool) -> String {
    if blocked {
        return "blocked".into();
    }
    let p = derived_progress(criteria);
    if p >= 100 {
        "done".into()
    } else if p > 0 {
        "in_progress".into()
    } else {
        "pending".into()
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn parse_prefs(raw: String) -> Value {
    serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}))
}

pub fn create_workspace(conn: &Connection, name: &str, root_path: &str) -> Result<WorkspaceRecord> {
    let id = Uuid::new_v4().to_string();
    let created = now();
    let prefs = serde_json::json!({ "mapConfirmed": false });
    conn.execute(
        "INSERT INTO workspace (id, name, root_path, created_at, llm_profile_id, prefs_json)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
        params![id, name, root_path, created, prefs.to_string()],
    )?;
    get_workspace(conn, &id)
}

pub fn list_workspaces(conn: &Connection) -> Result<Vec<WorkspaceSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, root_path, created_at, llm_profile_id, prefs_json
         FROM workspace WHERE id != ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![APP_PREFS_ID], |row| {
        Ok(WorkspaceSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            root_path: row.get(2)?,
            created_at: row.get(3)?,
            llm_profile_id: row.get(4)?,
            prefs: parse_prefs(row.get(5)?),
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_workspace(conn: &Connection, id: &str) -> Result<WorkspaceRecord> {
    let mut stmt = conn.prepare(
        "SELECT id, name, root_path, created_at, llm_profile_id, prefs_json
         FROM workspace WHERE id = ?1",
    )?;
    let mut ws = stmt
        .query_row(params![id], |row| {
            Ok(WorkspaceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                llm_profile_id: row.get(4)?,
                prefs: parse_prefs(row.get(5)?),
                parts: Vec::new(),
            })
        })
        .optional()?
        .ok_or_else(|| AppError::msg(format!("workspace not found: {id}")))?;
    ws.parts = list_parts(conn, id)?;
    Ok(ws)
}

pub fn get_app_prefs(conn: &Connection) -> Result<Value> {
    let raw: String = conn.query_row(
        "SELECT prefs_json FROM workspace WHERE id = ?1",
        params![APP_PREFS_ID],
        |row| row.get(0),
    )?;
    Ok(parse_prefs(raw))
}

pub fn set_app_prefs(conn: &Connection, prefs: &Value) -> Result<()> {
    conn.execute(
        "UPDATE workspace SET prefs_json = ?1 WHERE id = ?2",
        params![prefs.to_string(), APP_PREFS_ID],
    )?;
    Ok(())
}

pub fn merge_workspace_prefs(conn: &Connection, id: &str, patch: &Value) -> Result<Value> {
    let mut current = get_workspace(conn, id)?.prefs;
    if let (Some(obj), Some(p)) = (current.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            obj.insert(k.clone(), v.clone());
        }
    } else {
        current = patch.clone();
    }
    conn.execute(
        "UPDATE workspace SET prefs_json = ?1 WHERE id = ?2",
        params![current.to_string(), id],
    )?;
    Ok(current)
}

pub fn rename_workspace(conn: &Connection, id: &str, name: &str) -> Result<()> {
    conn.execute(
        "UPDATE workspace SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    Ok(())
}

fn list_parts(conn: &Connection, workspace_id: &str) -> Result<Vec<PartRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, slot, label, weight, planned_start, status
         FROM part WHERE workspace_id = ?1",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
        Ok(PartRecord {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            slot: row.get(2)?,
            label: row.get(3)?,
            weight: row.get(4)?,
            planned_start: row.get(5)?,
            status: row.get(6)?,
            wires: Vec::new(),
        })
    })?;
    let mut parts = Vec::new();
    for r in rows {
        let mut part = r?;
        part.wires = list_wires(conn, &part.id)?;
        if part.status != "unmapped" && part.status != "blocked" {
            part.status = derived_part_status(&part);
        }
        parts.push(part);
    }
    parts.sort_by_key(|p| {
        ALL_SLOTS
            .iter()
            .position(|s| *s == p.slot)
            .unwrap_or(99)
    });
    Ok(parts)
}

fn derived_part_status(part: &PartRecord) -> String {
    if part.status == "unmapped" {
        return "unmapped".into();
    }
    if part.wires.is_empty() {
        return "pending".into();
    }
    if part.status == "blocked" || part.wires.iter().any(|w| w.status == "blocked") {
        return "blocked".into();
    }
    let total: i64 = part.wires.iter().map(|w| w.progress).sum();
    let avg = total / part.wires.len() as i64;
    if avg >= 100 {
        "done".into()
    } else if avg > 0 {
        "in_progress".into()
    } else {
        part.status.clone()
    }
}

fn list_wires(conn: &Connection, part_id: &str) -> Result<Vec<WireRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, part_id, label, criteria_json, progress, status, evidence_json, updated_at
         FROM wire WHERE part_id = ?1 ORDER BY updated_at ASC",
    )?;
    let rows = stmt.query_map(params![part_id], |row| {
        let criteria_raw: String = row.get(3)?;
        let stored_progress: i64 = row.get(4)?;
        let _ = stored_progress;
        let evidence_raw: Option<String> = row.get(6)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            criteria_raw,
            row.get::<_, String>(5)?,
            evidence_raw,
            row.get::<_, String>(7)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        let (id, part_id, label, criteria_raw, stored_status, evidence_raw, updated_at) = r?;
        let criteria: Vec<Criterion> = serde_json::from_str(&criteria_raw).unwrap_or_default();
        let progress = derived_progress(&criteria);
        let blocked = stored_status == "blocked";
        let status = derived_wire_status(&criteria, blocked);
        let evidence_json = evidence_raw.and_then(|s| serde_json::from_str(&s).ok());
        out.push(WireRecord {
            id,
            part_id,
            label,
            criteria,
            progress,
            status,
            evidence_json,
            updated_at,
        });
    }
    Ok(out)
}

/// Insert or replace a wire. Progress is computed here; `WireInput` has no progress field.
pub fn upsert_wire(conn: &Connection, part_id: &str, input: WireInput) -> Result<WireRecord> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let progress = derived_progress(&input.criteria);
    let status = derived_wire_status(&input.criteria, input.blocked);
    let criteria_json = serde_json::to_string(&input.criteria)?;
    let updated = now();
    conn.execute(
        "INSERT INTO wire (id, part_id, label, criteria_json, progress, status, evidence_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)
         ON CONFLICT(id) DO UPDATE SET
           part_id = excluded.part_id,
           label = excluded.label,
           criteria_json = excluded.criteria_json,
           progress = excluded.progress,
           status = excluded.status,
           updated_at = excluded.updated_at",
        params![id, part_id, input.label, criteria_json, progress, status, updated],
    )?;
    list_wires(conn, part_id)?
        .into_iter()
        .find(|w| w.id == id)
        .ok_or_else(|| AppError::msg("wire write failed"))
}

pub fn set_criterion_met(
    conn: &Connection,
    wire_id: &str,
    index: usize,
    met: bool,
    evidence: Option<String>,
) -> Result<WireRecord> {
    let (part_id, label, criteria_raw, status): (String, String, String, String) = conn.query_row(
        "SELECT part_id, label, criteria_json, status FROM wire WHERE id = ?1",
        params![wire_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let mut criteria: Vec<Criterion> = serde_json::from_str(&criteria_raw)?;
    let c = criteria
        .get_mut(index)
        .ok_or_else(|| AppError::msg("criterion index out of range"))?;
    c.met = met;
    if let Some(ev) = evidence {
        c.evidence = ev;
    }
    upsert_wire(
        conn,
        &part_id,
        WireInput {
            id: Some(wire_id.into()),
            label,
            criteria,
            blocked: status == "blocked",
        },
    )
}

pub fn add_criterion(conn: &Connection, wire_id: &str, text: &str) -> Result<WireRecord> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::msg("criterion text is empty"));
    }
    let (part_id, label, criteria_raw, status): (String, String, String, String) = conn.query_row(
        "SELECT part_id, label, criteria_json, status FROM wire WHERE id = ?1",
        params![wire_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let mut criteria: Vec<Criterion> = serde_json::from_str(&criteria_raw)?;
    criteria.push(Criterion {
        text: text.to_string(),
        met: false,
        evidence: String::new(),
    });
    upsert_wire(
        conn,
        &part_id,
        WireInput {
            id: Some(wire_id.into()),
            label,
            criteria,
            blocked: status == "blocked",
        },
    )
}

pub fn set_workspace_llm_profile(
    conn: &Connection,
    id: &str,
    profile_id: Option<&str>,
) -> Result<()> {
    let n = conn.execute(
        "UPDATE workspace SET llm_profile_id = ?1 WHERE id = ?2",
        params![profile_id, id],
    )?;
    if n == 0 {
        return Err(AppError::msg(format!("workspace not found: {id}")));
    }
    Ok(())
}

pub fn insert_llm_call(conn: &Connection, entry: &CallLogEntry) -> Result<()> {
    conn.execute(
        "INSERT INTO llm_call (
            id, workspace_id, purpose, provider_id, model,
            request_json, response_text, verdict, reject_reason,
            duration_ms, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            entry.id,
            entry.workspace_id,
            entry.purpose,
            entry.provider_id,
            entry.model,
            entry.request_json,
            entry.response_text,
            entry.verdict,
            entry.reject_reason,
            entry.duration_ms as i64,
            entry.created_at,
        ],
    )?;
    Ok(())
}

pub fn list_llm_calls(conn: &Connection, workspace_id: &str) -> Result<Vec<CallLogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, purpose, provider_id, model,
                request_json, response_text, verdict, reject_reason,
                duration_ms, created_at
         FROM llm_call WHERE workspace_id = ?1
         ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
        let duration: i64 = row.get(9)?;
        Ok(CallLogEntry {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            purpose: row.get(2)?,
            provider_id: row.get(3)?,
            model: row.get(4)?,
            request_json: row.get(5)?,
            response_text: row.get(6)?,
            verdict: row.get(7)?,
            reject_reason: row.get(8)?,
            duration_ms: duration.max(0) as u64,
            created_at: row.get(10)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskRecord {
    pub id: String,
    pub workspace_id: String,
    pub part_id: Option<String>,
    pub wire_id: Option<String>,
    pub goal_json: Value,
    pub state: String,
    pub station: Option<String>,
    pub worktree_path: Option<String>,
    pub dispatched_at: Option<String>,
    pub finished_at: Option<String>,
    pub result_json: Option<Value>,
}

pub fn put_task(conn: &Connection, rec: &TaskRecord) -> Result<()> {
    conn.execute(
        "INSERT INTO task (
            id, workspace_id, part_id, wire_id, goal_json, state, station,
            worktree_path, dispatched_at, finished_at, result_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            part_id = excluded.part_id,
            wire_id = excluded.wire_id,
            goal_json = excluded.goal_json,
            state = excluded.state,
            station = excluded.station,
            worktree_path = excluded.worktree_path,
            dispatched_at = excluded.dispatched_at,
            finished_at = excluded.finished_at,
            result_json = excluded.result_json",
        params![
            rec.id,
            rec.workspace_id,
            rec.part_id,
            rec.wire_id,
            rec.goal_json.to_string(),
            rec.state,
            rec.station,
            rec.worktree_path,
            rec.dispatched_at,
            rec.finished_at,
            rec.result_json.as_ref().map(|v| v.to_string()),
        ],
    )?;
    Ok(())
}

fn parse_task_row(
    id: String,
    workspace_id: String,
    part_id: Option<String>,
    wire_id: Option<String>,
    goal_raw: String,
    state: String,
    station: Option<String>,
    worktree_path: Option<String>,
    dispatched_at: Option<String>,
    finished_at: Option<String>,
    result_raw: Option<String>,
) -> TaskRecord {
    TaskRecord {
        id,
        workspace_id,
        part_id,
        wire_id,
        goal_json: serde_json::from_str(&goal_raw).unwrap_or(Value::Null),
        state,
        station,
        worktree_path,
        dispatched_at,
        finished_at,
        result_json: result_raw.and_then(|s| serde_json::from_str(&s).ok()),
    }
}

pub fn get_task(conn: &Connection, id: &str) -> Result<TaskRecord> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, part_id, wire_id, goal_json, state, station,
                worktree_path, dispatched_at, finished_at, result_json
         FROM task WHERE id = ?1",
    )?;
    stmt.query_row(params![id], |row| {
        Ok(parse_task_row(
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
            row.get(10)?,
        ))
    })
    .optional()?
    .ok_or_else(|| AppError::msg(format!("task not found: {id}")))
}

pub fn list_tasks(conn: &Connection, workspace_id: &str) -> Result<Vec<TaskRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, part_id, wire_id, goal_json, state, station,
                worktree_path, dispatched_at, finished_at, result_json
         FROM task WHERE workspace_id = ?1
         ORDER BY dispatched_at IS NULL, dispatched_at DESC, id DESC",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
        Ok(parse_task_row(
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
            row.get(10)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn list_all_tasks(conn: &Connection) -> Result<Vec<TaskRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, part_id, wire_id, goal_json, state, station,
                worktree_path, dispatched_at, finished_at, result_json
         FROM task
         ORDER BY dispatched_at IS NULL, dispatched_at ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(parse_task_row(
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
            row.get(10)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_wire(conn: &Connection, wire_id: &str) -> Result<WireRecord> {
    let part_id: String = conn
        .query_row(
            "SELECT part_id FROM wire WHERE id = ?1",
            params![wire_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::msg(format!("wire not found: {wire_id}")))?;
    list_wires(conn, &part_id)?
        .into_iter()
        .find(|w| w.id == wire_id)
        .ok_or_else(|| AppError::msg(format!("wire not found: {wire_id}")))
}

pub fn confirm_map(
    conn: &Connection,
    workspace_id: &str,
    proposal: &MapProposal,
    workspace_name: Option<&str>,
) -> Result<WorkspaceRecord> {
    if proposal.parts.len() != 7 {
        return Err(AppError::msg("architecture map must have exactly 7 slots"));
    }
    let mut seen = std::collections::BTreeSet::new();
    for p in &proposal.parts {
        if !ALL_SLOTS.contains(&p.slot.as_str()) {
            return Err(AppError::msg(format!("unknown slot {}", p.slot)));
        }
        if !seen.insert(&p.slot) {
            return Err(AppError::msg(format!("duplicate slot {}", p.slot)));
        }
        for w in &p.wires {
            let n = w.criteria.len();
            if n < 3 || n > 6 {
                return Err(AppError::msg(format!(
                    "wire '{}' must have 3–6 criteria, got {n}",
                    w.label
                )));
            }
        }
    }
    let tx = conn.unchecked_transaction()?;
    if let Some(name) = workspace_name {
        tx.execute(
            "UPDATE workspace SET name = ?1 WHERE id = ?2",
            params![name, workspace_id],
        )?;
    }
    tx.execute(
        "DELETE FROM part WHERE workspace_id = ?1",
        params![workspace_id],
    )?;
    let mut modules: serde_json::Map<String, Value> = serde_json::Map::new();
    for p in &proposal.parts {
        let id = Uuid::new_v4().to_string();
        let status = if p.present { "pending" } else { "unmapped" };
        let planned = p
            .planned_start
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        tx.execute(
            "INSERT INTO part (id, workspace_id, slot, label, weight, planned_start, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, workspace_id, p.slot, p.label, p.weight, planned, status],
        )?;
        if p.present {
            for w in &p.wires {
                let input = WireInput {
                    id: None,
                    label: w.label.clone(),
                    criteria: w.criteria.clone(),
                    blocked: false,
                };
                let progress = derived_progress(&input.criteria);
                let wstatus = derived_wire_status(&input.criteria, false);
                let wid = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO wire (id, part_id, label, criteria_json, progress, status, evidence_json, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)",
                    params![
                        wid,
                        id,
                        input.label,
                        serde_json::to_string(&input.criteria)?,
                        progress,
                        wstatus,
                        now()
                    ],
                )?;
            }
        }
        modules.insert(p.slot.clone(), Value::from(p.module_paths.clone()));
    }
    let mut prefs = get_workspace(&tx, workspace_id)?.prefs;
    if let Some(obj) = prefs.as_object_mut() {
        obj.insert("mapConfirmed".into(), Value::Bool(true));
        obj.insert("modulesBySlot".into(), Value::Object(modules));
        obj.remove("mapDraft");
    }
    tx.execute(
        "UPDATE workspace SET prefs_json = ?1 WHERE id = ?2",
        params![prefs.to_string(), workspace_id],
    )?;
    tx.commit()?;
    get_workspace(conn, workspace_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&dir.path().join("tinman.db")).unwrap();
        (dir, conn)
    }

    fn two_of_five() -> Vec<Criterion> {
        (0..5)
            .map(|i| Criterion {
                text: format!("c{i}"),
                met: i < 2,
                evidence: String::new(),
            })
            .collect()
    }

    #[test]
    fn wire_progress_is_derived_two_of_five_is_40() {
        assert_eq!(derived_progress(&two_of_five()), 40);
    }

    #[test]
    fn wire_input_json_has_no_progress_field() {
        let input = WireInput {
            id: None,
            label: "ci".into(),
            criteria: two_of_five(),
            blocked: false,
        };
        let v = serde_json::to_value(&input).unwrap();
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert!(!keys.iter().any(|k| k.contains("progress")), "{keys:?}");
        assert!(v.get("progress").is_none());
    }

    #[test]
    fn round_trip_workspace_parts_wires() {
        let (_dir, conn) = setup();
        let ws = create_workspace(&conn, "Demo", "/tmp/demo").unwrap();
        let proposal = MapProposal {
            parts: ALL_SLOTS
                .iter()
                .map(|slot| ProposedPart {
                    slot: (*slot).into(),
                    present: *slot == "torso" || *slot == "left_leg",
                    label: (*slot).into(),
                    weight: if *slot == "torso" { 3.0 } else { 2.0 },
                    planned_start: None,
                    module_paths: if *slot == "torso" {
                        vec!["src/".into()]
                    } else {
                        vec![]
                    },
                    wires: if *slot == "torso" {
                        vec![ProposedWire {
                            label: "core".into(),
                            criteria: two_of_five(),
                        }]
                    } else {
                        vec![]
                    },
                })
                .collect(),
        };
        confirm_map(&conn, &ws.id, &proposal, Some("Demo")).unwrap();

        let path = _dir.path().join("tinman.db");
        drop(conn);
        let conn2 = open(&path).unwrap();
        let loaded = get_workspace(&conn2, &ws.id).unwrap();
        assert_eq!(loaded.name, "Demo");
        assert_eq!(loaded.root_path, "/tmp/demo");
        assert_eq!(loaded.parts.len(), 7);
        let torso = loaded.parts.iter().find(|p| p.slot == "torso").unwrap();
        assert_eq!(torso.wires.len(), 1);
        assert_eq!(torso.wires[0].progress, 40);
        assert_eq!(torso.wires[0].criteria.iter().filter(|c| c.met).count(), 2);
        let backpack = loaded.parts.iter().find(|p| p.slot == "backpack").unwrap();
        assert_eq!(backpack.status, "unmapped");
        let leg = loaded.parts.iter().find(|p| p.slot == "left_leg").unwrap();
        assert_eq!(leg.status, "pending");
        assert!(leg.wires.is_empty());
        assert_eq!(loaded.prefs["mapConfirmed"], true);
    }

    #[test]
    fn stored_progress_column_is_ignored_on_read() {
        let (_dir, conn) = setup();
        let ws = create_workspace(&conn, "X", "/tmp/x").unwrap();
        let proposal = MapProposal {
            parts: ALL_SLOTS
                .iter()
                .map(|slot| ProposedPart {
                    slot: (*slot).into(),
                    present: *slot == "head",
                    label: "h".into(),
                    weight: 1.0,
                    planned_start: None,
                    module_paths: vec![],
                    wires: if *slot == "head" {
                        vec![ProposedWire {
                            label: "algo".into(),
                            criteria: two_of_five(),
                        }]
                    } else {
                        vec![]
                    },
                })
                .collect(),
        };
        confirm_map(&conn, &ws.id, &proposal, None).unwrap();
        let wire_id = get_workspace(&conn, &ws.id).unwrap().parts[0].wires[0].id.clone();
        conn.execute("UPDATE wire SET progress = 99 WHERE id = ?1", params![wire_id])
            .unwrap();
        let again = get_workspace(&conn, &ws.id).unwrap();
        let wire = again
            .parts
            .iter()
            .find(|p| p.slot == "head")
            .unwrap()
            .wires
            .first()
            .unwrap();
        assert_eq!(wire.progress, 40, "caller-supplied/SQL progress must not stick");
    }

    #[test]
    fn part_with_no_wires_is_pending() {
        let (_dir, conn) = setup();
        let ws = create_workspace(&conn, "X", "/tmp/x").unwrap();
        let proposal = MapProposal {
            parts: ALL_SLOTS
                .iter()
                .map(|slot| ProposedPart {
                    slot: (*slot).into(),
                    present: *slot == "torso",
                    label: "core".into(),
                    weight: 3.0,
                    planned_start: None,
                    module_paths: vec![],
                    wires: vec![],
                })
                .collect(),
        };
        let loaded = confirm_map(&conn, &ws.id, &proposal, None).unwrap();
        let torso = loaded.parts.iter().find(|p| p.slot == "torso").unwrap();
        assert_eq!(torso.status, "pending");
        assert!(torso.wires.is_empty());
    }

    #[test]
    fn add_criterion_recomputes_progress_from_criteria() {
        let (_dir, conn) = setup();
        let ws = create_workspace(&conn, "X", "/tmp/x").unwrap();
        let proposal = MapProposal {
            parts: ALL_SLOTS
                .iter()
                .map(|slot| ProposedPart {
                    slot: (*slot).into(),
                    present: *slot == "head",
                    label: "h".into(),
                    weight: 1.0,
                    planned_start: None,
                    module_paths: vec![],
                    wires: if *slot == "head" {
                        vec![ProposedWire {
                            label: "algo".into(),
                            criteria: two_of_five(),
                        }]
                    } else {
                        vec![]
                    },
                })
                .collect(),
        };
        confirm_map(&conn, &ws.id, &proposal, None).unwrap();
        let wire_id = get_workspace(&conn, &ws.id).unwrap().parts[0].wires[0]
            .id
            .clone();
        let before = get_workspace(&conn, &ws.id).unwrap().parts[0].wires[0].clone();
        assert_eq!(before.progress, 40);
        let after = add_criterion(&conn, &wire_id, "hand-filled from facts").unwrap();
        assert_eq!(after.criteria.len(), 6);
        assert_eq!(after.progress, 33);
        assert!(!after.criteria.last().unwrap().met);
    }

    #[test]
    fn c5_task_row_round_trips_through_every_state() {
        let (_dir, conn) = setup();
        let ws = create_workspace(&conn, "T", "/tmp/t").unwrap();
        let goal = serde_json::json!({
            "task_id": "t_c5",
            "project": { "name": "T", "root": "/tmp/t" },
            "target": { "slot": "left_leg", "part": "infra", "wire": "ci" },
            "user_intent_verbatim": ["keep this exactly"],
            "attachments": [],
            "facts": { "last_commit": "abc" },
            "framework_advice": {
                "next_step": "write the test",
                "entry_point": ".",
                "shared_risk": "shared"
            },
            "done_criteria": ["a", "b", "c"],
            "assumptions": ["hand-filled"],
            "workspace": { "worktree_path": "/tmp/data/worktrees/t_c5", "branch": "tinman/t_c5" },
            "delivery_format": "变更说明 + 自测结果 + 未完成项",
            "authorization": { "allow_push": false, "allow_deploy": false, "allow_spend": false }
        });
        let mut rec = TaskRecord {
            id: "t_c5".into(),
            workspace_id: ws.id.clone(),
            part_id: Some("p".into()),
            wire_id: Some("w".into()),
            goal_json: goal.clone(),
            state: "queued".into(),
            station: Some("This PC".into()),
            worktree_path: Some("/tmp/data/worktrees/t_c5".into()),
            dispatched_at: Some("2026-09-09T00:00:00+00:00".into()),
            finished_at: None,
            result_json: Some(serde_json::json!({"command": "stub /tmp/goal.json"})),
        };
        for state in [
            "queued",
            "waiting_dispatch",
            "running",
            "checking",
            "failed",
            "paused",
            "abandoned",
        ] {
            rec.state = state.into();
            put_task(&conn, &rec).unwrap();
            let loaded = get_task(&conn, "t_c5").unwrap();
            assert_eq!(loaded.goal_json, goal, "goal json drifted at state {state}");
            assert_eq!(loaded.state, state);
            assert_eq!(loaded.worktree_path.as_deref(), Some("/tmp/data/worktrees/t_c5"));
        }

        rec.state = crate::dispatch::state_after_exit(0).into();
        rec.finished_at = Some("2026-09-09T00:01:00+00:00".into());
        rec.result_json = Some(serde_json::json!({"exit_code": 0, "command": "stub"}));
        put_task(&conn, &rec).unwrap();
        let after_zero = get_task(&conn, "t_c5").unwrap();
        assert_eq!(after_zero.state, "checking");
        assert_ne!(after_zero.state, "done");
        assert_eq!(after_zero.result_json.as_ref().unwrap()["exit_code"], 0);
        assert_eq!(after_zero.goal_json, goal);

        rec.state = crate::dispatch::state_after_exit(1).into();
        put_task(&conn, &rec).unwrap();
        assert_eq!(get_task(&conn, "t_c5").unwrap().state, "failed");

        let listed = list_tasks(&conn, &ws.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "t_c5");
    }
}
