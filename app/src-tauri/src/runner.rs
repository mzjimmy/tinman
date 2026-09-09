//! Child-process runner behind a trait so the suite stays hermetic.
//!
//! Production uses `StdProcessRunner`. Tests inject `ScriptedRunner`.
//! Launch refusal for push/deploy/publish lives here so dispatch cannot
//! "forget" to check.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};

pub trait Clock {
    fn now_rfc3339(&self) -> String;
}

pub struct LiveClock;

impl Clock for LiveClock {
    fn now_rfc3339(&self) -> String {
        chrono::Utc::now().to_rfc3339()
    }
}

#[cfg(test)]
pub struct FrozenClock(pub String);

#[cfg(test)]
impl Clock for FrozenClock {
    fn now_rfc3339(&self) -> String {
        self.0.clone()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputLine {
    pub stream: String,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExitStatus {
    pub code: i32,
    pub success: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunnerError {
    Spawn(String),
    Io(String),
}

impl std::fmt::Display for RunnerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunnerError::Spawn(s) | RunnerError::Io(s) => write!(f, "{s}"),
        }
    }
}

pub trait ProcessRunner {
    fn spawn(
        &self,
        spec: &CommandSpec,
        on_line: &mut dyn FnMut(OutputLine),
    ) -> Result<ExitStatus, RunnerError>;
}

const FORBIDDEN: &[&str] = &["push", "deploy", "publish"];

/// Returns the forbidden token if program or argv contain it.
pub fn forbidden_token(program: &str, args: &[String]) -> Option<String> {
    let mut all = Vec::with_capacity(args.len() + 1);
    all.push(program.to_string());
    all.extend(args.iter().cloned());
    for item in all {
        let lower = item.to_ascii_lowercase();
        for tok in FORBIDDEN {
            if lower.contains(tok) {
                return Some((*tok).to_string());
            }
        }
    }
    None
}

pub fn format_command(spec: &CommandSpec) -> String {
    let mut parts = Vec::with_capacity(spec.args.len() + 1);
    if !spec.program.is_empty() {
        parts.push(spec.program.clone());
    }
    parts.extend(spec.args.iter().cloned());
    parts.join(" ")
}

pub fn render_argv(template: &[String], vars: &[(&str, &str)]) -> Vec<String> {
    template
        .iter()
        .map(|item| {
            let mut out = item.clone();
            for (k, v) in vars {
                out = out.replace(&format!("{{{{{k}}}}}"), v);
            }
            out
        })
        .collect()
}

pub struct StdProcessRunner;

/// PIDs of in-flight agent children, keyed by task id. Pause/abandon send
/// SIGTERM here so the UI is not lying about a still-writing process.
#[derive(Default)]
pub struct LiveChildren {
    inner: Mutex<HashMap<String, u32>>,
}

impl LiveChildren {
    pub fn register(&self, task_id: &str, pid: u32) {
        if let Ok(mut g) = self.inner.lock() {
            g.insert(task_id.to_string(), pid);
        }
    }

    pub fn unregister(&self, task_id: &str) {
        if let Ok(mut g) = self.inner.lock() {
            g.remove(task_id);
        }
    }

    pub fn kill(&self, task_id: &str) -> bool {
        let pid = self
            .inner
            .lock()
            .ok()
            .and_then(|mut g| g.remove(task_id));
        match pid {
            Some(pid) => {
                terminate_pid(pid);
                true
            }
            None => false,
        }
    }
}

fn terminate_pid(pid: u32) {
    #[cfg(unix)]
    {
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        unsafe {
            let _ = kill(pid as i32, 15);
        }
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

fn spawn_std(
    spec: &CommandSpec,
    on_line: &mut dyn FnMut(OutputLine),
    track: Option<(&str, &LiveChildren)>,
) -> Result<ExitStatus, RunnerError> {
        let mut child = Command::new(&spec.program)
            .args(&spec.args)
            .current_dir(&spec.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| RunnerError::Spawn(e.to_string()))?;
        if let Some((id, reg)) = track {
            reg.register(id, child.id());
        }

        let stdout = child.stdout.take().ok_or_else(|| {
            RunnerError::Io("stdout was not piped".into())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            RunnerError::Io("stderr was not piped".into())
        })?;

        let (tx, rx) = mpsc::channel::<OutputLine>();
        let tx_err = tx.clone();
        let stdout_h = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx
                    .send(OutputLine {
                        stream: "stdout".into(),
                        text: line,
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        let stderr_h = thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if tx_err
                    .send(OutputLine {
                        stream: "stderr".into(),
                        text: line,
                    })
                    .is_err()
                {
                    break;
                }
            }
        });

        while let Ok(line) = rx.recv() {
            on_line(line);
        }
        let _ = stdout_h.join();
        let _ = stderr_h.join();

        let status = child.wait().map_err(|e| RunnerError::Io(e.to_string()))?;
        if let Some((id, reg)) = track {
            reg.unregister(id);
        }
        let code = status.code().unwrap_or(-1);
        Ok(ExitStatus {
            code,
            success: status.success(),
        })
}

impl ProcessRunner for StdProcessRunner {
    fn spawn(
        &self,
        spec: &CommandSpec,
        on_line: &mut dyn FnMut(OutputLine),
    ) -> Result<ExitStatus, RunnerError> {
        spawn_std(spec, on_line, None)
    }
}

impl StdProcessRunner {
    pub fn spawn_tracked(
        &self,
        spec: &CommandSpec,
        task_id: &str,
        children: &LiveChildren,
        on_line: &mut dyn FnMut(OutputLine),
    ) -> Result<ExitStatus, RunnerError> {
        spawn_std(spec, on_line, Some((task_id, children)))
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct ScriptedRunner {
    pub lines: Vec<OutputLine>,
    pub exit_code: i32,
    pub spawned: std::sync::Mutex<Vec<CommandSpec>>,
}

#[cfg(test)]
impl ScriptedRunner {
    pub fn new(lines: Vec<&str>, exit_code: i32) -> Self {
        Self {
            lines: lines
                .into_iter()
                .map(|t| OutputLine {
                    stream: "stdout".into(),
                    text: t.to_string(),
                })
                .collect(),
            exit_code,
            spawned: std::sync::Mutex::new(Vec::new()),
        }
    }
}

#[cfg(test)]
impl ProcessRunner for ScriptedRunner {
    fn spawn(
        &self,
        spec: &CommandSpec,
        on_line: &mut dyn FnMut(OutputLine),
    ) -> Result<ExitStatus, RunnerError> {
        self.spawned
            .lock()
            .expect("scripted runner")
            .push(spec.clone());
        for line in &self.lines {
            on_line(line.clone());
        }
        Ok(ExitStatus {
            code: self.exit_code,
            success: self.exit_code == 0,
        })
    }
}

pub fn append_log_line(data_dir: &Path, task_id: &str, line: &OutputLine) -> std::io::Result<()> {
    let dir = data_dir.join("tasks").join(task_id);
    std::fs::create_dir_all(&dir)?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("log.txt"))?;
    writeln!(f, "{}: {}", line.stream, line.text)?;
    Ok(())
}

pub fn read_log(data_dir: &Path, task_id: &str) -> Vec<OutputLine> {
    let path = data_dir.join("tasks").join(task_id).join("log.txt");
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines()
        .filter(|l| !l.is_empty())
        .map(|l| match l.split_once(": ") {
            Some((stream, text)) if stream == "stdout" || stream == "stderr" => OutputLine {
                stream: stream.to_string(),
                text: text.to_string(),
            },
            _ => OutputLine {
                stream: "stdout".into(),
                text: l.to_string(),
            },
        })
        .collect()
}

pub fn write_goal_file(data_dir: &Path, task_id: &str, goal: &serde_json::Value) -> std::io::Result<PathBuf> {
    let dir = data_dir.join("tasks").join(task_id);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("goal.json");
    std::fs::write(&path, serde_json::to_string_pretty(goal).unwrap_or_else(|_| goal.to_string()))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c4_runner_streams_lines_as_they_arrive() {
        let runner = ScriptedRunner::new(vec!["one", "two", "three"], 0);
        let spec = CommandSpec {
            program: "stub".into(),
            args: vec![],
            cwd: PathBuf::from("/tmp"),
        };
        let mut seen = Vec::new();
        let still_inside_spawn = std::sync::atomic::AtomicBool::new(true);
        let status = runner
            .spawn(&spec, &mut |line| {
                assert!(
                    still_inside_spawn.load(std::sync::atomic::Ordering::SeqCst),
                    "line {:?} arrived after spawn returned",
                    line.text
                );
                seen.push(line.text);
            })
            .unwrap();
        still_inside_spawn.store(false, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(seen, ["one", "two", "three"]);
        assert_eq!(status.code, 0);
        assert!(status.success);
        assert_eq!(runner.spawned.lock().unwrap().len(), 1);
    }

    #[test]
    fn forbidden_token_detects_push_deploy_publish() {
        assert_eq!(
            forbidden_token("git", &["push".into(), "origin".into()]).as_deref(),
            Some("push")
        );
        assert_eq!(
            forbidden_token("deploy-cli", &[]).as_deref(),
            Some("deploy")
        );
        assert_eq!(
            forbidden_token("npm", &["publish".into()]).as_deref(),
            Some("publish")
        );
        assert_eq!(forbidden_token("sh", &["-c".into(), "echo hi".into()]), None);
    }
}
