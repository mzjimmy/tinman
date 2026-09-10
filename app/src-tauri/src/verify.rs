//! Delivery verification: done_criteria against evidence, then write-back.
//!
//! A process exiting 0 lands on `checking`. This module is the only path
//! that may move a task to `done`, and it does so only when every criterion
//! is met with a concrete evidence reference. The agent's own claim of
//! success is never evidence. Progress numbers are never written here;
//! fill height rises because `set_criterion_met` / `add_criterion` flip
//! criteria and `derived_progress` recomputes on read.

use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::{self, Criterion, TaskRecord, WireRecord};
use crate::error::{AppError, Result};
use crate::gitutil;
use crate::runner::{self, Clock};

const UNMET_REASON: &str = "no evidence in git diff, task log, or delivery";
const EMPTY_CRITERIA_REASON: &str = "no done_criteria to verify";
const PROPOSAL_UNGROUNDED: &str = "proposal evidence not found in git diff, task log, or delivery";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckedCriterion {
    pub text: String,
    pub met: bool,
    pub evidence: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Evidence {
    pub files: Vec<String>,
    pub log_lines: Vec<String>,
    pub delivery: String,
    pub commits: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaskSummary {
    pub try_it: String,
    pub built: Vec<String>,
    pub checked: Vec<CheckedCriterion>,
    pub still_wrong: Vec<CheckedCriterion>,
}

pub fn done_criteria_of(task: &TaskRecord) -> Vec<String> {
    task.goal_json
        .get("done_criteria")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::trim).filter(|s| !s.is_empty()))
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

pub fn collect_evidence(
    worktree: Option<&Path>,
    data_dir: &Path,
    task_id: &str,
    delivery: &str,
) -> Evidence {
    let mut files = Vec::new();
    let mut commits = Vec::new();
    if let Some(root) = worktree {
        if root.is_dir() {
            // Only files this task actually changed — not the history inherited
            // from the branch point. `git log --name-only -8` would list README.md
            // from `init` and count as evidence for work the agent never did.
            for args in [
                ["diff", "--name-only"].as_slice(),
                ["diff", "--cached", "--name-only"].as_slice(),
                ["ls-files", "--others", "--exclude-standard"].as_slice(),
                ["diff", "--name-only", "main...HEAD"].as_slice(),
                ["diff", "--name-only", "HEAD"].as_slice(),
            ] {
                if let Ok(out) = gitutil::git(root, args) {
                    push_lines(&mut files, &out);
                }
            }
            if let Ok(out) = gitutil::git(root, &["log", "--pretty=format:%h", "main..HEAD"]) {
                push_lines(&mut commits, &out);
            }
        }
    }
    let log_lines: Vec<String> = runner::read_log(data_dir, task_id)
        .into_iter()
        .map(|l| l.text)
        .collect();
    Evidence {
        files,
        log_lines,
        delivery: delivery.to_string(),
        commits,
    }
}

fn push_lines(out: &mut Vec<String>, raw: &str) {
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if !out.iter().any(|e| e == t) {
            out.push(t.to_string());
        }
    }
}

fn is_success_claim(s: &str) -> bool {
    let l = s.trim().to_lowercase();
    matches!(
        l.as_str(),
        "done"
            | "ok"
            | "success"
            | "completed"
            | "complete"
            | "finished"
            | "完成"
            | "已完成"
            | "all done"
            | "passed"
    ) || l.contains("all criteria met")
        || l.contains("全部完成")
        || l.contains("任务完成")
}

fn criterion_mentions_file(text: &str, file: &str) -> bool {
    if file.is_empty() {
        return false;
    }
    if text.contains(file) {
        return true;
    }
    if let Some(name) = Path::new(file).file_name().and_then(|s| s.to_str()) {
        if name.len() >= 3 && text.contains(name) {
            return true;
        }
    }
    false
}

fn shares_substance(criterion: &str, line: &str) -> bool {
    if is_success_claim(line) {
        return false;
    }
    let line_l = line.to_lowercase();
    tokens(criterion).iter().any(|tok| line_l.contains(tok))
}

fn tokens(text: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "the", "and", "for", "with", "that", "this", "from", "must", "have",
        "has", "are", "was", "were", "been", "will", "should", "into", "over",
        "under", "updated", "records", "change", "present", "exists",
    ];
    text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '.' && c != '-')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| s.len() >= 4 && !STOP.contains(&s.as_str()))
        .collect()
}

fn evidence_ref_in_index(reference: &str, ev: &Evidence) -> bool {
    let r = reference.trim();
    if r.is_empty() || is_success_claim(r) {
        return false;
    }
    let body = r
        .split_once(':')
        .map(|(_, rest)| rest.trim())
        .unwrap_or(r);
    if ev.files.iter().any(|f| f == body || body.ends_with(f) || f.ends_with(body) || r.contains(f)) {
        return true;
    }
    if ev.commits.iter().any(|c| r.contains(c) || body == c) {
        return true;
    }
    if ev.log_lines.iter().any(|l| l == body || r.contains(l) || l.contains(body)) {
        return !is_success_claim(body);
    }
    if !ev.delivery.is_empty() && ev.delivery.contains(body) && body.len() >= 4 {
        return ev.files.iter().any(|f| body.contains(f) || f.contains(body));
    }
    false
}

/// Characters of a matched line kept as grounding evidence. The row is stored
/// in SQLite and emitted to the UI, so it must not carry a 64 KiB log line.
const EVIDENCE_SNIPPET_CHARS: usize = 120;

fn ground(text: &str, ev: &Evidence) -> Option<String> {
    for f in &ev.files {
        if criterion_mentions_file(text, f) {
            return Some(format!("git:{f}"));
        }
    }
    for c in &ev.commits {
        if text.contains(c) {
            return Some(format!("commit:{c}"));
        }
    }
    for line in &ev.log_lines {
        if shares_substance(text, line) {
            // A snippet, not the whole line: a matched line can be as long as
            // the reader's cap, and this string is stored in SQLite and shipped
            // to the UI. Delivery evidence below was always capped; log
            // evidence was not.
            let snippet: String = line.chars().take(EVIDENCE_SNIPPET_CHARS).collect();
            return Some(format!("log:{snippet}"));
        }
    }
    if !ev.delivery.is_empty() && !is_success_claim(&ev.delivery) {
        for f in &ev.files {
            if ev.delivery.contains(f) && criterion_mentions_file(text, f) {
                return Some(format!("delivery:{f}"));
            }
        }
        for line in ev.delivery.lines() {
            if shares_substance(text, line) {
                let snippet: String = line.chars().take(EVIDENCE_SNIPPET_CHARS).collect();
                return Some(format!("delivery:{snippet}"));
            }
        }
    }
    None
}

fn proposal_items(proposal: Option<&Value>) -> Vec<(String, bool, String)> {
    let Some(v) = proposal else {
        return Vec::new();
    };
    let arr = v
        .get("criteria")
        .or_else(|| v.get("checked"))
        .or_else(|| v.get("done_criteria"))
        .and_then(|x| x.as_array());
    let Some(arr) = arr else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            if let Some(s) = item.as_str() {
                return Some((s.to_string(), false, String::new()));
            }
            let text = item.get("text").and_then(|t| t.as_str())?.to_string();
            let met = item.get("met").and_then(|m| m.as_bool()).unwrap_or(false);
            let evidence = item
                .get("evidence")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string();
            Some((text, met, evidence))
        })
        .collect()
}

pub fn check_criteria(
    criteria: &[String],
    ev: &Evidence,
    proposal: Option<&Value>,
) -> Vec<CheckedCriterion> {
    if criteria.is_empty() {
        return Vec::new();
    }
    let proposed = proposal_items(proposal);
    criteria
        .iter()
        .map(|text| {
            if let Some(evidence) = ground(text, ev) {
                return CheckedCriterion {
                    text: text.clone(),
                    met: true,
                    evidence,
                };
            }
            let hit = proposed.iter().find(|(t, _, _)| norm(t) == norm(text));
            if let Some((_, want_met, evid)) = hit {
                if *want_met && evidence_ref_in_index(evid, ev) {
                    return CheckedCriterion {
                        text: text.clone(),
                        met: true,
                        evidence: evid.clone(),
                    };
                }
                if *want_met {
                    return CheckedCriterion {
                        text: text.clone(),
                        met: false,
                        evidence: PROPOSAL_UNGROUNDED.into(),
                    };
                }
            }
            CheckedCriterion {
                text: text.clone(),
                met: false,
                evidence: UNMET_REASON.into(),
            }
        })
        .collect()
}

fn norm(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn all_met(checked: &[CheckedCriterion]) -> bool {
    !checked.is_empty() && checked.iter().all(|c| c.met)
}

pub fn summary_from(task: &TaskRecord, checked: &[CheckedCriterion], ev: &Evidence) -> TaskSummary {
    let try_it = task
        .worktree_path
        .clone()
        .unwrap_or_else(|| task.goal_json["workspace"]["worktree_path"].as_str().unwrap_or("").to_string());
    TaskSummary {
        try_it,
        built: ev.files.clone(),
        checked: checked.iter().filter(|c| c.met).cloned().collect(),
        still_wrong: checked.iter().filter(|c| !c.met).cloned().collect(),
    }
}

pub fn delivery_text(task: &TaskRecord, data_dir: &Path) -> String {
    if let Some(d) = task
        .result_json
        .as_ref()
        .and_then(|v| v.get("delivery"))
        .and_then(|v| v.as_str())
    {
        if !d.trim().is_empty() {
            return d.to_string();
        }
    }
    runner::read_log(data_dir, &task.id)
        .into_iter()
        .map(|l| l.text)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Write verified criteria onto the target wire through the existing
/// criteria path. Never assigns a progress number.
pub fn write_back(conn: &Connection, wire_id: &str, checked: &[CheckedCriterion]) -> Result<WireRecord> {
    if wire_id.trim().is_empty() {
        return Err(AppError::msg("task has no target wire"));
    }
    for c in checked {
        let wire = db::get_wire(conn, wire_id)?;
        if let Some(idx) = wire
            .criteria
            .iter()
            .position(|existing| norm(&existing.text) == norm(&c.text))
        {
            db::set_criterion_met(
                conn,
                wire_id,
                idx,
                c.met,
                Some(c.evidence.clone()),
            )?;
        } else {
            db::add_criterion(conn, wire_id, &c.text)?;
            let wire = db::get_wire(conn, wire_id)?;
            let idx = wire
                .criteria
                .iter()
                .rposition(|existing| norm(&existing.text) == norm(&c.text))
                .ok_or_else(|| AppError::msg("added criterion missing on read-back"))?;
            db::set_criterion_met(
                conn,
                wire_id,
                idx,
                c.met,
                Some(c.evidence.clone()),
            )?;
        }
    }
    db::get_wire(conn, wire_id)
}

fn persist_verdict(
    conn: &Connection,
    task: &TaskRecord,
    checked: &[CheckedCriterion],
    summary: &TaskSummary,
    clock: &dyn Clock,
) -> Result<TaskRecord> {
    let mut rec = task.clone();
    let done = all_met(checked);
    rec.state = if done { "done".into() } else { "checking".into() };
    if done && rec.finished_at.is_none() {
        rec.finished_at = Some(clock.now_rfc3339());
    }
    let mut result = rec.result_json.clone().unwrap_or_else(|| json!({}));
    if let Some(obj) = result.as_object_mut() {
        obj.insert(
            "verification".into(),
            json!({
                "criteria": checked,
                "all_met": done,
            }),
        );
        obj.insert("summary".into(), serde_json::to_value(summary)?);
        obj.remove("progress");
    }
    rec.result_json = Some(result);
    db::put_task(conn, &rec)?;
    Ok(rec)
}

/// Verify a task that has returned. Empty done_criteria stay `checking`.
/// LLM output may propose evidence; a proposal with no grounded reference
/// is unmet. With no proposal, deterministic matching is the whole verdict.
pub fn verify_task(
    conn: &Connection,
    data_dir: &Path,
    task_id: &str,
    clock: &dyn Clock,
    proposal: Option<&Value>,
) -> Result<TaskRecord> {
    let task = db::get_task(conn, task_id)?;
    let criteria = done_criteria_of(&task);
    let delivery = delivery_text(&task, data_dir);
    let wt = task.worktree_path.as_deref().map(Path::new);
    let ev = collect_evidence(wt, data_dir, task_id, &delivery);

    if criteria.is_empty() {
        let checked = vec![CheckedCriterion {
            text: EMPTY_CRITERIA_REASON.into(),
            met: false,
            evidence: EMPTY_CRITERIA_REASON.into(),
        }];
        let summary = summary_from(&task, &checked, &ev);
        return persist_verdict(conn, &task, &checked, &summary, clock);
    }

    let checked = check_criteria(&criteria, &ev, proposal);
    if let Some(wire_id) = task.wire_id.as_deref().filter(|s| !s.is_empty()) {
        if db::get_wire(conn, wire_id).is_ok() {
            write_back(conn, wire_id, &checked)?;
        }
    }
    let summary = summary_from(&task, &checked, &ev);
    persist_verdict(conn, &task, &checked, &summary, clock)
}

pub fn seed_criteria_on_wire(texts: &[&str]) -> Vec<Criterion> {
    texts
        .iter()
        .map(|t| Criterion {
            text: (*t).to_string(),
            met: false,
            evidence: String::new(),
        })
        .collect()
}

#[cfg(test)]
mod tests {

    /// N5: grounding evidence is persisted and emitted; a 64 KiB log line must
    /// not travel with it.
    #[test]
    fn log_evidence_is_stored_as_a_snippet_not_a_whole_line() {
        let ev = Evidence {
            files: Vec::new(),
            log_lines: vec![format!("refactor the parser {}", "x".repeat(50_000))],
            delivery: String::new(),
            commits: Vec::new(),
        };
        let got = ground("refactor the parser", &ev).expect("grounded in the log");
        assert!(got.starts_with("log:"));
        assert!(
            got.len() <= EVIDENCE_SNIPPET_CHARS + 8,
            "evidence carried {} bytes",
            got.len()
        );
    }
    use super::*;
    use crate::db::{self, MapProposal, ProposedPart, ProposedWire, ALL_SLOTS};
    use crate::dispatch::{self, AgentConfig, DispatchDeps, DispatchRequest};
    use crate::queue;
    use crate::runner::{FrozenClock, OutputLine, ScriptedRunner};
    use crate::worktree::init_git_fixture;
    use rusqlite::params;
    use std::fs;
    use std::path::PathBuf;

    const C_README: &str = "README.md records the change";
    const C_APP: &str = "src/app.rs exposes the entry";
    const C_TEST: &str = "the suite log contains test_ok";
    const C_LICENSE: &str = "LICENSE stays untouched";
    const C_GUIDE: &str = "docs/guide.md explains recovery";

    struct Harness {
        _tmp: tempfile::TempDir,
        conn: Connection,
        project: PathBuf,
        data: PathBuf,
        workspace_id: String,
        part_id: String,
        wire_id: String,
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
        let criteria = seed_criteria_on_wire(&[C_README, C_APP, C_TEST, C_LICENSE, C_GUIDE]);
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
                            criteria: criteria.clone(),
                        }]
                    } else {
                        vec![]
                    },
                })
                .collect(),
        };
        let loaded = db::confirm_map(&conn, &ws.id, &proposal, None).unwrap();
        let part = loaded.parts.iter().find(|p| p.slot == "head").unwrap();
        let wire = part.wires.first().unwrap();
        Harness {
            workspace_id: ws.id,
            part_id: part.id.clone(),
            wire_id: wire.id.clone(),
            _tmp: tmp,
            conn,
            project,
            data,
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

    fn goal(h: &Harness, task_id: &str, risk: &str) -> Value {
        json!({
            "task_id": task_id,
            "project": { "name": "fix", "root": h.project },
            "target": { "slot": "head", "part": "h", "wire": "algo" },
            "user_intent_verbatim": ["do the thing"],
            "attachments": [],
            "facts": { "last_commit": "" },
            "framework_advice": {
                "next_step": "write the test",
                "entry_point": "src/app.rs",
                "shared_risk": risk
            },
            "done_criteria": [C_README, C_APP, C_TEST, C_LICENSE, C_GUIDE],
            "assumptions": [],
            "workspace": { "worktree_path": "", "branch": "" },
            "delivery_format": "变更说明 + 自测结果 + 未完成项",
            "authorization": {
                "allow_push": false,
                "allow_deploy": false,
                "allow_spend": false
            }
        })
    }

    fn req(h: &Harness, task_id: &str, risk: &str, wire_id: &str) -> DispatchRequest {
        DispatchRequest {
            task_id: task_id.into(),
            workspace_id: h.workspace_id.clone(),
            part_id: h.part_id.clone(),
            wire_id: wire_id.into(),
            project_root: h.project.clone(),
            goal: goal(h, task_id, risk),
            agent: echo_agent(),
            station: "This PC".into(),
        }
    }

    fn deps<'a>(h: &'a Harness) -> DispatchDeps<'a> {
        DispatchDeps {
            conn: &h.conn,
            data_dir: &h.data,
            clock: &h.clock,
        }
    }

    fn start(h: &Harness, task_id: &str, risk: &str) -> TaskRecord {
        start_on_wire(h, task_id, risk, &h.wire_id)
    }

    fn start_on_wire(h: &Harness, task_id: &str, risk: &str, wire_id: &str) -> TaskRecord {
        dispatch::start_dispatch(&req(h, task_id, risk, wire_id), &deps(h))
            .unwrap()
            .task
    }

    fn plant_two_files(worktree: &Path) {
        fs::write(worktree.join("README.md"), "hello\nchanged\n").unwrap();
        fs::create_dir_all(worktree.join("src")).unwrap();
        fs::write(worktree.join("src/app.rs"), "pub fn entry() {}\n").unwrap();
    }

    fn log_line(h: &Harness, task_id: &str, text: &str) {
        runner::append_log_line(
            &h.data,
            task_id,
            &OutputLine {
                stream: "stdout".into(),
                text: text.into(),
            },
        )
        .unwrap();
    }

    #[test]
    fn c3_verification_marks_each_criterion_with_evidence_or_a_reason() {
        let h = harness();
        let rec = start(&h, "t_mark", "none");
        let wt = PathBuf::from(rec.worktree_path.as_ref().unwrap());
        plant_two_files(&wt);
        log_line(&h, "t_mark", "test_ok 3 passed");
        let rec = verify_task(&h.conn, &h.data, "t_mark", &h.clock, None).unwrap();
        let checked = rec.result_json.as_ref().unwrap()["verification"]["criteria"]
            .as_array()
            .cloned()
            .unwrap();
        assert_eq!(checked.len(), 5);
        let parsed: Vec<CheckedCriterion> = checked
            .iter()
            .map(|v| serde_json::from_value(v.clone()).unwrap())
            .collect();
        let readme = parsed.iter().find(|c| c.text == C_README).unwrap();
        assert!(readme.met, "{readme:?}");
        assert!(readme.evidence.contains("README.md"), "{}", readme.evidence);
        let app = parsed.iter().find(|c| c.text == C_APP).unwrap();
        assert!(app.met, "{app:?}");
        assert!(app.evidence.contains("src/app.rs"), "{}", app.evidence);
        let test = parsed.iter().find(|c| c.text == C_TEST).unwrap();
        assert!(test.met, "{test:?}");
        assert!(test.evidence.contains("test_ok"), "{}", test.evidence);
        let license = parsed.iter().find(|c| c.text == C_LICENSE).unwrap();
        assert!(!license.met);
        assert_eq!(license.evidence, UNMET_REASON);
        let guide = parsed.iter().find(|c| c.text == C_GUIDE).unwrap();
        assert!(!guide.met);
        assert_eq!(guide.evidence, UNMET_REASON);
    }

    #[test]
    fn c3_agent_claiming_success_with_no_evidence_does_not_reach_done() {
        let h = harness();
        let rec = start(&h, "t_boast", "none");
        log_line(&h, "t_boast", "done");
        log_line(&h, "t_boast", "all criteria met");
        let mut rec = rec;
        let mut result = rec.result_json.clone().unwrap_or_else(|| json!({}));
        if let Some(obj) = result.as_object_mut() {
            obj.insert("delivery".into(), json!("done. 完成. all criteria met."));
            obj.insert("exit_code".into(), json!(0));
        }
        rec.result_json = Some(result);
        rec.state = "checking".into();
        db::put_task(&h.conn, &rec).unwrap();

        let after = verify_task(&h.conn, &h.data, "t_boast", &h.clock, None).unwrap();
        assert_ne!(after.state, "done");
        assert_eq!(after.state, "checking");
        let checked = after.result_json.as_ref().unwrap()["verification"]["criteria"]
            .as_array()
            .unwrap();
        assert!(checked.iter().all(|c| c["met"] == false));
        assert_eq!(
            after.result_json.as_ref().unwrap()["verification"]["all_met"],
            false
        );
    }

    #[test]
    fn c3_all_criteria_met_reaches_done() {
        let h = harness();
        let rec = start(&h, "t_all", "none");
        let wt = PathBuf::from(rec.worktree_path.as_ref().unwrap());
        plant_two_files(&wt);
        fs::write(wt.join("LICENSE"), "keep\n").unwrap();
        fs::create_dir_all(wt.join("docs")).unwrap();
        fs::write(wt.join("docs/guide.md"), "recovery steps\n").unwrap();
        log_line(&h, "t_all", "suite log: test_ok");
        let after = verify_task(&h.conn, &h.data, "t_all", &h.clock, None).unwrap();
        assert_eq!(after.state, "done");
        assert_eq!(
            after.result_json.as_ref().unwrap()["verification"]["all_met"],
            true
        );
        let checked = after.result_json.as_ref().unwrap()["verification"]["criteria"]
            .as_array()
            .unwrap();
        assert_eq!(checked.len(), 5);
        assert!(checked.iter().all(|c| c["met"] == true));
    }

    #[test]
    fn c4_part_fill_rises_by_the_met_ratio_after_write_back() {
        let h = harness();
        let before = db::get_workspace(&h.conn, &h.workspace_id).unwrap();
        let part = before.parts.iter().find(|p| p.slot == "head").unwrap();
        assert_eq!(part.wires[0].progress, 0, "start from a known fill of 0");

        let rec = start(&h, "t_fill", "none");
        let wt = PathBuf::from(rec.worktree_path.as_ref().unwrap());
        plant_two_files(&wt);
        verify_task(&h.conn, &h.data, "t_fill", &h.clock, None).unwrap();

        let after = db::get_workspace(&h.conn, &h.workspace_id).unwrap();
        let part = after.parts.iter().find(|p| p.slot == "head").unwrap();
        assert_eq!(
            part.wires[0].progress, 40,
            "2 of 5 criteria met → derived fill 40"
        );
        let met: Vec<_> = part.wires[0]
            .criteria
            .iter()
            .filter(|c| c.met)
            .collect();
        assert_eq!(met.len(), 2);
        for c in met {
            assert!(!c.evidence.is_empty(), "met criterion needs evidence: {c:?}");
            assert!(
                c.evidence.starts_with("git:") || c.evidence.starts_with("log:"),
                "evidence must be a concrete reference, got {}",
                c.evidence
            );
        }
    }

    #[test]
    fn c4_no_path_sets_progress_directly() {
        let h = harness();
        let rec = start(&h, "t_noprop", "none");
        let wt = PathBuf::from(rec.worktree_path.as_ref().unwrap());
        plant_two_files(&wt);
        verify_task(&h.conn, &h.data, "t_noprop", &h.clock, None).unwrap();
        let wire_id = h.wire_id.clone();
        h.conn
            .execute("UPDATE wire SET progress = 99 WHERE id = ?1", params![wire_id])
            .unwrap();
        let again = db::get_wire(&h.conn, &wire_id).unwrap();
        assert_eq!(
            again.progress, 40,
            "verification path must not make the stored progress column sticky"
        );
    }

    #[test]
    fn c5_two_concurrent_tasks_have_independent_worktrees() {
        let h = harness();
        let a = start_on_wire(&h, "t_aaa", "surface-a", "wire-a");
        let b = start_on_wire(&h, "t_bbb", "surface-b", "wire-b");
        assert_ne!(a.worktree_path, b.worktree_path);
        let path_a = PathBuf::from(a.worktree_path.as_ref().unwrap());
        let path_b = PathBuf::from(b.worktree_path.as_ref().unwrap());
        assert_ne!(path_a, path_b);
        fs::write(path_a.join("only_a.txt"), "a\n").unwrap();
        fs::write(path_b.join("only_b.txt"), "b\n").unwrap();
        assert!(path_a.join("only_a.txt").exists());
        assert!(!path_a.join("only_b.txt").exists());
        assert!(path_b.join("only_b.txt").exists());
        assert!(!path_b.join("only_a.txt").exists());

        queue::drain(&h.conn, &h.clock.now_rfc3339()).unwrap();
        assert_eq!(db::get_task(&h.conn, "t_aaa").unwrap().state, "running");
        assert_eq!(db::get_task(&h.conn, "t_bbb").unwrap().state, "running");

        log_line(&h, "t_aaa", "test_ok a");
        plant_two_files(&path_a);
        let va = verify_task(&h.conn, &h.data, "t_aaa", &h.clock, None).unwrap();
        let vb = verify_task(&h.conn, &h.data, "t_bbb", &h.clock, None).unwrap();
        let a_files = va.result_json.as_ref().unwrap()["summary"]["built"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let b_files = vb.result_json.as_ref().unwrap()["summary"]["built"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let a_has_b = a_files.iter().any(|f| f.as_str() == Some("only_b.txt"));
        let b_has_a = b_files.iter().any(|f| f.as_str() == Some("only_a.txt"));
        assert!(!a_has_b, "A's combined check must not list B's file: {a_files:?}");
        assert!(!b_has_a, "B's combined check must not list A's file: {b_files:?}");
        assert_ne!(va.result_json, vb.result_json);
    }

    #[test]
    fn llm_proposal_without_grounded_evidence_is_unmet() {
        let h = harness();
        start(&h, "t_llm", "none");
        let proposal = json!({
            "criteria": [
                { "text": C_README, "met": true, "evidence": "" },
                { "text": C_APP, "met": true, "evidence": "the agent said so" },
                { "text": C_TEST, "met": true, "evidence": "done" },
                { "text": C_LICENSE, "met": false, "evidence": "missing" },
                { "text": C_GUIDE, "met": true, "evidence": "git:docs/guide.md" }
            ]
        });
        let after = verify_task(&h.conn, &h.data, "t_llm", &h.clock, Some(&proposal)).unwrap();
        assert_ne!(after.state, "done");
        let checked: Vec<CheckedCriterion> = serde_json::from_value(
            after.result_json.as_ref().unwrap()["verification"]["criteria"].clone(),
        )
        .unwrap();
        assert!(checked.iter().all(|c| !c.met), "{checked:?}");
    }

    #[test]
    fn dispatch_exit_zero_still_lands_on_checking_until_verify() {
        let h = harness();
        let runner = ScriptedRunner::new(vec!["ok"], 0);
        let rec = dispatch::dispatch(&req(&h, "t_chk2", "none", &h.wire_id), &deps(&h), &runner).unwrap();
        assert_ne!(rec.state, "done");
        assert!(rec.state == "checking" || rec.state == "queued" || rec.state == "running");
    }
}
