//! Child-process runner behind a trait so the suite stays hermetic.
//!
//! Production uses `StdProcessRunner`. Tests inject `ScriptedRunner`.
//! Launch refusal for push/deploy/publish lives here so dispatch cannot
//! "forget" to check.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
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

/// Bounds on everything a child process can make us hold in memory.
///
/// A dispatched agent CLI is untrusted input in the only sense that matters
/// here: it decides how much it writes and whether it ever writes a newline.
/// Without these, one `cat` of a minified bundle grew a single `String` until
/// the process aborted (release builds set `panic = "abort"`).

/// Longest single logical line kept from a child's stdout/stderr. The rest of
/// an over-long line is counted and dropped, not buffered.
pub const MAX_LINE_BYTES: usize = 64 * 1024;

/// Pending lines allowed between the reader threads and the disk+IPC consumer.
/// Bounded so a child that outruns the consumer blocks on its own pipe instead
/// of growing our heap. Sized against MAX_LINE_BYTES so the worst case queue is
/// ~8 MiB rather than a line count that says nothing about bytes.
pub const CHANNEL_CAPACITY: usize = 128;

/// Size cap for a task's `log.txt`. Past this the file is rotated, keeping the
/// most recent half.
pub const LOG_MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Lines returned by `read_log`. The file stays the full record on disk; every
/// in-memory consumer (the UI, delivery verification) gets a bounded tail.
pub const LOG_TAIL_LINES: usize = 5_000;

/// Bytes of the log tail `read_log` will read off disk before splitting lines.
pub const LOG_TAIL_BYTES: u64 = 4 * 1024 * 1024;

/// Line iterator with a maximum line length, and no early stop on invalid
/// UTF-8. `BufRead::lines()` has neither: it grows one String until a newline
/// (N1), and `map_while(Result::ok)` stopped the reader at the first non-UTF-8
/// byte, which left the child blocked on a full pipe forever.
pub struct BoundedLines<R: BufRead> {
    inner: R,
    max: usize,
}

impl<R: BufRead> BoundedLines<R> {
    pub fn new(inner: R, max: usize) -> Self {
        Self { inner, max: max.max(1) }
    }

    /// Consume the remainder of an over-long line without keeping it.
    fn discard_rest_of_line(&mut self) -> u64 {
        let mut dropped = 0u64;
        let mut scratch = Vec::with_capacity(8 * 1024);
        loop {
            scratch.clear();
            let n = match self
                .inner
                .by_ref()
                .take(8 * 1024)
                .read_until(b'\n', &mut scratch)
            {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            dropped += n as u64;
            if scratch.last() == Some(&b'\n') {
                break;
            }
        }
        dropped
    }
}

impl<R: BufRead> Iterator for BoundedLines<R> {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        let mut buf: Vec<u8> = Vec::new();
        let read = match self
            .inner
            .by_ref()
            .take(self.max as u64)
            .read_until(b'\n', &mut buf)
        {
            Ok(0) => return None,
            Ok(n) => n,
            // An IO error on the pipe ends the stream; it must not be mistaken
            // for "keep reading forever".
            Err(_) => return None,
        };
        let hit_cap = read >= self.max && !buf.ends_with(b"\n");
        while matches!(buf.last(), Some(b'\n') | Some(b'\r')) {
            buf.pop();
        }
        let mut text = String::from_utf8_lossy(&buf).into_owned();
        if hit_cap {
            let dropped = self.discard_rest_of_line();
            text.push_str(&format!("… [line truncated, {dropped} more bytes dropped]"));
        }
        Some(text)
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

    /// Remove the registration only if it is still the pid we registered. A
    /// pause+resume can start a second child for the same task id before the
    /// first has been reaped, and the first one's guard must not erase the
    /// second one's pid.
    pub fn unregister_pid(&self, task_id: &str, pid: u32) {
        if let Ok(mut g) = self.inner.lock() {
            if g.get(task_id).copied() == Some(pid) {
                g.remove(task_id);
            }
        }
    }

    pub fn is_live(&self, task_id: &str) -> bool {
        self.inner
            .lock()
            .map(|g| g.contains_key(task_id))
            .unwrap_or(false)
    }

    pub fn pid_of(&self, task_id: &str) -> Option<u32> {
        self.inner.lock().ok().and_then(|g| g.get(task_id).copied())
    }

    /// Signal the child but keep it registered: it is not gone until `wait()`
    /// returns and the guard drops. Removing it here let pause free a station
    /// while the old child was still writing into the same task log.
    ///
    /// SIGTERM alone was also a lie when a child ignores it, so escalate — but
    /// only while this task's pid is still one we have not reaped, so a pid the
    /// OS has already recycled onto someone else's process is never signalled.
    pub fn kill(self: &Arc<Self>, task_id: &str) -> bool {
        let Some(pid) = self.pid_of(task_id) else {
            return false;
        };
        terminate_pid(pid);
        let me = Arc::clone(self);
        let id = task_id.to_string();
        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_secs(SIGKILL_DEADLINE_SECS));
            if me.pid_of(&id) == Some(pid) {
                force_kill_pid(pid);
            }
        });
        true
    }
}

/// Keeps a child's pid registered for exactly as long as the child is being
/// waited on — including the error paths, where `?` used to skip `unregister`.
pub struct ChildGuard<'a> {
    children: &'a LiveChildren,
    task_id: String,
    pid: u32,
}

impl<'a> ChildGuard<'a> {
    pub fn new(children: &'a LiveChildren, task_id: &str, pid: u32) -> Self {
        children.register(task_id, pid);
        Self { children, task_id: task_id.to_string(), pid }
    }
}

impl Drop for ChildGuard<'_> {
    fn drop(&mut self) {
        self.children.unregister_pid(&self.task_id, self.pid);
    }
}

/// Seconds a child gets to exit on SIGTERM before it is killed outright.
const SIGKILL_DEADLINE_SECS: u64 = 2;

#[cfg(unix)]
fn signal_pid(pid: u32, sig: i32) {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe {
        let _ = kill(pid as i32, sig);
    }
}

/// SIGKILL. Only ever called for a pid we have not yet reaped.
fn force_kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        signal_pid(pid, 9);
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

fn terminate_pid(pid: u32) {
    #[cfg(unix)]
    {
        signal_pid(pid, 15);
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
        let _guard = track.map(|(id, reg)| ChildGuard::new(reg, id, child.id()));

        let stdout = child.stdout.take().ok_or_else(|| {
            RunnerError::Io("stdout was not piped".into())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            RunnerError::Io("stderr was not piped".into())
        })?;

        // Bounded: when the consumer (per-line disk append + IPC emit) falls
        // behind, the reader threads block, the OS pipe fills, and the child
        // stops writing. An unbounded channel instead grew our heap at the
        // child's pace.
        let (tx, rx) = mpsc::sync_channel::<OutputLine>(CHANNEL_CAPACITY);
        let tx_err = tx.clone();
        let stdout_h = thread::spawn(move || {
            for line in BoundedLines::new(BufReader::new(stdout), MAX_LINE_BYTES) {
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
            for line in BoundedLines::new(BufReader::new(stderr), MAX_LINE_BYTES) {
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

        // `?` here used to skip the unregister below; ChildGuard now covers
        // every exit path, including this one.
        let status = child.wait().map_err(|e| RunnerError::Io(e.to_string()))?;
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
        // A pause that frees the station before the old child is reaped could
        // otherwise start a second child for the same task: two processes
        // appending to one log, only one of them killable.
        if children.is_live(task_id) {
            return Err(RunnerError::Spawn(format!(
                "task {task_id} still has a live child; not starting a second one"
            )));
        }
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

/// Serializes every writer of every task log. The consumer thread appends per
/// line while a pause/abandon hint can be appended from a command thread, and
/// rotation rewrites the file — without this, rotation could truncate the file
/// out from under an appender.
static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn append_log_line(data_dir: &Path, task_id: &str, line: &OutputLine) -> std::io::Result<()> {
    let dir = data_dir.join("tasks").join(task_id);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("log.txt");
    let _held = LOG_WRITE_LOCK.lock();
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    writeln!(f, "{}: {}", line.stream, line.text)?;
    if f.metadata().map(|m| m.len()).unwrap_or(0) > LOG_MAX_BYTES {
        drop(f);
        rotate_log(&path)?;
    }
    Ok(())
}

/// Keep the most recent half of an over-long log. Bounded work (it copies at
/// most `LOG_MAX_BYTES / 2`) and it happens rarely, so the per-line cost of a
/// chatty child stays a single append.
fn rotate_log(path: &Path) -> std::io::Result<()> {
    let keep = LOG_MAX_BYTES / 2;
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    if len <= keep {
        return Ok(());
    }
    f.seek(SeekFrom::Start(len - keep))?;
    let mut tail = Vec::with_capacity(keep as usize);
    f.read_to_end(&mut tail)?;
    drop(f);
    // Drop the partial first line so the tail starts on a record boundary.
    if let Some(pos) = tail.iter().position(|b| *b == b'\n') {
        tail.drain(..=pos);
    }
    // Write a sibling and rename over the original. Truncating in place meant a
    // failure here (disk full is exactly when a 32 MiB log happens) left the
    // task with an empty or half-written log.
    let tmp = path.with_extension("txt.rotating");
    {
        let mut out = std::fs::File::create(&tmp)?;
        writeln!(
            out,
            "stdout: [log rotated: earlier output dropped, keeping the last {} MiB]",
            keep / (1024 * 1024)
        )?;
        out.write_all(&tail)?;
        out.sync_all()?;
    }
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Bounded tail of a task's log. Every in-memory consumer goes through here:
/// the UI over IPC, and delivery verification, which reads it twice at child
/// exit. Reading the whole file was a memory cliff proportional to how chatty
/// the agent had been.
pub fn read_log(data_dir: &Path, task_id: &str) -> Vec<OutputLine> {
    let path = data_dir.join("tasks").join(task_id).join("log.txt");
    let text = match read_tail(&path, LOG_TAIL_BYTES) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let mut lines: Vec<OutputLine> = text.lines()
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
        .map(|l| OutputLine {
            stream: l.stream,
            text: clamp_text(l.text),
        })
        .collect();
    if lines.len() > LOG_TAIL_LINES {
        lines.drain(..lines.len() - LOG_TAIL_LINES);
    }
    lines
}

fn clamp_text(text: String) -> String {
    if text.len() <= MAX_LINE_BYTES {
        return text;
    }
    let mut cut = MAX_LINE_BYTES;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    let dropped = text.len() - cut;
    format!("{}… [truncated {dropped} bytes]", &text[..cut])
}

/// Read at most `max` bytes from the end of a file, dropping the partial first
/// line so callers never see a half record.
fn read_tail(path: &Path, max: u64) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    if len > max {
        f.seek(SeekFrom::Start(len - max))?;
    }
    let mut buf = Vec::with_capacity(max.min(len) as usize);
    f.take(max).read_to_end(&mut buf)?;
    if len > max {
        // Drop the partial first record. If the tail holds no newline at all —
        // a log written before line lengths were bounded — keep it rather than
        // returning nothing; clamp_text bounds it downstream.
        match buf.iter().position(|b| *b == b'\n') {
            // Dropping the partial record would leave nothing: the window holds
            // one record longer than itself, so keep it (clamped downstream).
            Some(pos) if pos + 1 >= buf.len() => {}
            Some(pos) => {
                buf.drain(..=pos);
            }
            None => {}
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
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

    /// N1: one newline-free stream must not grow a String without bound.
    /// This is the cleanest single-cause process abort (release profile is
    /// panic="abort", so an allocation failure is not recoverable).
    #[test]
    fn bounded_lines_caps_a_newline_free_flood() {
        let blob = "a".repeat(4 * 1024 * 1024);
        let lines: Vec<String> = BoundedLines::new(std::io::Cursor::new(blob), 1024).collect();
        assert_eq!(lines.len(), 1, "a newline-free blob is one logical line");
        assert!(
            lines[0].len() < 1024 + 128,
            "kept {} bytes of a 4 MiB newline-free line",
            lines[0].len()
        );
        assert!(lines[0].contains("truncated"), "truncation must be visible: {}", lines[0]);
    }

    #[test]
    fn bounded_lines_passes_ordinary_lines_through_unchanged() {
        let lines: Vec<String> =
            BoundedLines::new(std::io::Cursor::new("one\ntwo\r\nthree\n"), MAX_LINE_BYTES)
                .collect();
        assert_eq!(lines, ["one", "two", "three"]);
    }

    /// map_while(Result::ok) used to stop the reader at the first non-UTF-8
    /// byte: the pipe then fills and the child blocks forever. A hang, not a
    /// leak, but the same input causes it.
    #[test]
    fn bounded_lines_survives_invalid_utf8_instead_of_stopping() {
        let mut raw: Vec<u8> = b"before\n".to_vec();
        raw.extend_from_slice(&[0xff, 0xfe, b'x']);
        raw.extend_from_slice(b"\nafter\n");
        let lines: Vec<String> =
            BoundedLines::new(std::io::Cursor::new(raw), MAX_LINE_BYTES).collect();
        assert_eq!(lines.len(), 3, "reader kept going past invalid utf-8: {lines:?}");
        assert_eq!(lines[0], "before");
        assert_eq!(lines[2], "after");
    }

    /// N5/N6: read_log is called twice at child exit by verify.rs and once per
    /// task by the UI. It must return a bounded tail, never the whole file.
    #[test]
    fn read_log_returns_a_bounded_tail() {
        let dir = tempfile::tempdir().unwrap();
        let total = LOG_TAIL_LINES + 2_000;
        for i in 0..total {
            append_log_line(
                dir.path(),
                "t1",
                &OutputLine { stream: "stdout".into(), text: format!("line {i}") },
            )
            .unwrap();
        }
        let got = read_log(dir.path(), "t1");
        assert!(
            got.len() <= LOG_TAIL_LINES,
            "read_log returned {} lines, cap is {LOG_TAIL_LINES}",
            got.len()
        );
        assert_eq!(
            got.last().map(|l| l.text.clone()).unwrap(),
            format!("line {}", total - 1),
            "the tail must be the newest lines"
        );
    }

    #[test]
    fn read_log_clamps_a_single_huge_line() {
        let dir = tempfile::tempdir().unwrap();
        append_log_line(
            dir.path(),
            "t2",
            &OutputLine { stream: "stdout".into(), text: "z".repeat(3 * 1024 * 1024) },
        )
        .unwrap();
        let got = read_log(dir.path(), "t2");
        assert_eq!(got.len(), 1);
        assert!(
            got[0].text.len() <= MAX_LINE_BYTES + 128,
            "kept {} bytes",
            got[0].text.len()
        );
    }

    /// N4: log.txt had no rotation, so a 4 GB dump became a 4 GB file.
    #[test]
    fn append_log_line_rotates_instead_of_growing_forever() {
        let dir = tempfile::tempdir().unwrap();
        let chunk = OutputLine { stream: "stdout".into(), text: "q".repeat(64 * 1024) };
        let mut wrote = 0u64;
        while wrote < LOG_MAX_BYTES + 4 * 1024 * 1024 {
            append_log_line(dir.path(), "t3", &chunk).unwrap();
            wrote += 64 * 1024;
        }
        let size = std::fs::metadata(dir.path().join("tasks/t3/log.txt")).unwrap().len();
        assert!(
            size <= LOG_MAX_BYTES,
            "log grew to {size} bytes, cap is {LOG_MAX_BYTES}"
        );
        // rotation keeps the tail readable
        assert!(!read_log(dir.path(), "t3").is_empty());
    }

    /// N9: kill() removed the pid before the child was known dead, so pause
    /// freed a station while the old child kept writing. The registration now
    /// lives until wait() returns, via a drop guard.
    #[test]
    fn child_registration_survives_kill_and_ends_with_the_guard() {
        let children = Arc::new(LiveChildren::default());
        {
            let _guard = ChildGuard::new(&children, "task-a", 424242);
            assert!(children.is_live("task-a"));
            assert!(children.kill("task-a"), "kill reports it had a live child");
            assert!(
                children.is_live("task-a"),
                "still registered: the child is signalled, not yet reaped"
            );
        }
        assert!(!children.is_live("task-a"), "guard drop unregisters");
        // The deferred SIGKILL checks exactly this: once the pid is gone from
        // the map it has been reaped, so escalating could hit a recycled pid.
        assert_eq!(children.pid_of("task-a"), None);
    }

    /// D2: rotation used to truncate in place, so a failure — or a concurrent
    /// pause hint — could leave the task with an empty log.
    #[test]
    fn rotation_keeps_the_newest_records_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let chunk = OutputLine { stream: "stdout".into(), text: "q".repeat(64 * 1024) };
        let mut wrote = 0u64;
        while wrote < LOG_MAX_BYTES + 1024 * 1024 {
            append_log_line(dir.path(), "t8", &chunk).unwrap();
            wrote += 64 * 1024;
        }
        append_log_line(
            dir.path(),
            "t8",
            &OutputLine { stream: "stdout".into(), text: "the newest line".into() },
        )
        .unwrap();
        let got = read_log(dir.path(), "t8");
        assert_eq!(
            got.last().map(|l| l.text.as_str()),
            Some("the newest line"),
            "rotation lost the newest record"
        );
        let tasks = dir.path().join("tasks").join("t8");
        let leftovers: Vec<_> = std::fs::read_dir(&tasks)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n != "log.txt")
            .collect();
        assert!(leftovers.is_empty(), "rotation left {leftovers:?} behind");
    }

    /// D3: a second child for the same task id must not have its registration
    /// erased by the first child's guard.
    #[test]
    fn a_second_childs_registration_outlives_the_first_guard() {
        let children = Arc::new(LiveChildren::default());
        let first = ChildGuard::new(&children, "task-b", 1111);
        {
            let _second = ChildGuard::new(&children, "task-b", 2222);
            drop(first);
            assert_eq!(
                children.pid_of("task-b"),
                Some(2222),
                "the first guard erased the second child's pid"
            );
        }
        assert_eq!(children.pid_of("task-b"), None);
    }

    #[test]
    fn spawn_tracked_refuses_a_second_child_for_one_task() {
        let children = Arc::new(LiveChildren::default());
        let _guard = ChildGuard::new(&children, "task-c", 4321);
        let spec = CommandSpec {
            program: "sh".into(),
            args: vec!["-c".into(), "echo hi".into()],
            cwd: PathBuf::from("/tmp"),
        };
        let err = StdProcessRunner
            .spawn_tracked(&spec, "task-c", &children, &mut |_| {})
            .expect_err("a second child for one task must be refused");
        assert!(format!("{err}").contains("live child"), "{err}");
    }

    /// A log written before line lengths were bounded can hold one line longer
    /// than the tail window. That must still read back as something.
    #[test]
    fn read_log_of_one_line_longer_than_the_tail_window_is_not_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tasks").join("t9");
        std::fs::create_dir_all(&path).unwrap();
        let mut giant = "stdout: ".to_string();
        giant.push_str(&"g".repeat((LOG_TAIL_BYTES as usize) + 1024));
        giant.push('\n');
        std::fs::write(path.join("log.txt"), giant).unwrap();
        let got = read_log(dir.path(), "t9");
        assert!(!got.is_empty(), "a single over-long line read back as nothing");
        assert!(got[0].text.len() <= MAX_LINE_BYTES + 128);
    }

    /// The crash path, end to end, with a real child and a real pipe: a child
    /// that dumps megabytes without ever writing a newline.
    #[cfg(unix)]
    #[test]
    fn real_child_dumping_without_newlines_stays_bounded() {
        let runner = StdProcessRunner;
        let spec = CommandSpec {
            program: "sh".into(),
            args: vec![
                "-c".into(),
                "head -c 3000000 /dev/zero | tr '\\0' 'a'".into(),
            ],
            cwd: PathBuf::from("/tmp"),
        };
        let mut total = 0usize;
        let mut worst = 0usize;
        let status = runner
            .spawn(&spec, &mut |line| {
                worst = worst.max(line.text.len());
                total += line.text.len();
            })
            .expect("spawn");
        assert!(status.success);
        assert!(
            worst <= MAX_LINE_BYTES + 128,
            "one line held {worst} bytes of a 3 MB newline-free dump"
        );
        assert!(
            total <= MAX_LINE_BYTES + 128,
            "held {total} bytes total from a single logical line"
        );
    }

    /// Backpressure must not lose or reorder lines, and must not deadlock:
    /// the bounded channel is only safe because the consumer always drains.
    #[cfg(unix)]
    #[test]
    fn real_child_line_flood_arrives_complete_and_in_order_under_backpressure() {
        let n = CHANNEL_CAPACITY * 6;
        let runner = StdProcessRunner;
        let spec = CommandSpec {
            program: "sh".into(),
            args: vec!["-c".into(), format!("seq 1 {n}")],
            cwd: PathBuf::from("/tmp"),
        };
        let mut seen = 0usize;
        runner
            .spawn(&spec, &mut |line| {
                seen += 1;
                assert_eq!(line.text, seen.to_string(), "line {seen} out of order");
                // Force the queue to fill: a slow consumer is the real case
                // (disk append + IPC emit per line).
                if seen % 500 == 0 {
                    thread::sleep(std::time::Duration::from_millis(5));
                }
            })
            .expect("spawn");
        assert_eq!(seen, n, "lost lines under backpressure");
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
