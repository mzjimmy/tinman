use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;

use crate::error::{AppError, Result};

/// Largest git stdout kept in memory. Enforced while READING the pipe — a
/// `Command::output()` would have allocated the whole diff before any clamp
/// could run, which made the previous version of this cap a lie.
pub const MAX_GIT_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

/// Stderr is a message, not data.
pub const MAX_GIT_STDERR_BYTES: usize = 64 * 1024;

/// Read at most `max` bytes, then drain the rest to keep the child from
/// blocking on a full pipe, counting what was dropped.
fn read_capped<R: Read>(mut reader: R, max: usize) -> String {
    let mut buf = Vec::new();
    let mut head = (&mut reader).take(max as u64 + 1);
    if head.read_to_end(&mut buf).is_err() {
        return String::from_utf8_lossy(&buf).into_owned();
    }
    if buf.len() <= max {
        return String::from_utf8_lossy(&buf).into_owned();
    }
    buf.truncate(max);
    // Keep draining so git is never blocked writing into a pipe nobody reads.
    let dropped = std::io::copy(&mut reader, &mut std::io::sink()).unwrap_or(0) + 1;
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    text.push_str(&format!(
        "\n… [git output truncated, {dropped} bytes dropped]"
    ));
    text
}

/// Run git with `--no-optional-locks` so status/diff never refresh the index.
pub fn git(root: &Path, args: &[&str]) -> Result<String> {
    git_with_cap(root, args, MAX_GIT_OUTPUT_BYTES)
}

fn git_with_cap(root: &Path, args: &[&str], max: usize) -> Result<String> {
    let mut child = Command::new("git")
        .current_dir(root)
        .arg("--no-optional-locks")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::msg("git stdout was not piped"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::msg("git stderr was not piped"))?;
    // Both pipes are drained concurrently: reading one to EOF while the other
    // fills its buffer would deadlock.
    let out_h = thread::spawn(move || read_capped(stdout, max));
    let err = read_capped(stderr, MAX_GIT_STDERR_BYTES);
    let out = out_h.join().unwrap_or_default();
    let status = child.wait()?;
    if !status.success() {
        return Err(AppError::msg(format!(
            "git {} failed: {}",
            args.join(" "),
            err.trim()
        )));
    }
    Ok(out)
}

pub fn git_ok(root: &Path, args: &[&str]) -> Option<String> {
    git(root, args).ok()
}

pub fn is_git_repo(root: &Path) -> bool {
    git(root, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

pub fn branch_exists(root: &Path, branch: &str) -> bool {
    git(
        root,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .is_ok()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct GitChanges {
    pub status: String,
    pub diff: String,
}

pub fn changes(root: &Path) -> Result<GitChanges> {
    if !is_git_repo(root) {
        return Ok(GitChanges {
            status: "(not a git repository)".into(),
            diff: String::new(),
        });
    }
    let status = git(root, &["status", "--porcelain=v1", "-uall"])?;
    let unstaged = git(root, &["diff", "--no-ext-diff"])?;
    let staged = git(root, &["diff", "--cached", "--no-ext-diff"])?;
    let mut diff = String::new();
    if !staged.trim().is_empty() {
        diff.push_str("# staged\n");
        diff.push_str(&staged);
        if !unstaged.trim().is_empty() {
            diff.push('\n');
        }
    }
    if !unstaged.trim().is_empty() {
        diff.push_str("# unstaged\n");
        diff.push_str(&unstaged);
    }
    Ok(GitChanges {
        status: if status.is_empty() {
            "(clean)".into()
        } else {
            status
        },
        diff,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_capped_bounds_and_marks() {
        let big = vec![b'd'; MAX_GIT_OUTPUT_BYTES + 4096];
        let got = read_capped(&big[..], MAX_GIT_OUTPUT_BYTES);
        assert!(got.len() <= MAX_GIT_OUTPUT_BYTES + 128, "kept {}", got.len());
        assert!(got.contains("truncated"));
        assert_eq!(read_capped(&b"clean\n"[..], MAX_GIT_OUTPUT_BYTES), "clean\n");
    }

    /// The cap has to hold on the real path, where git — not a Vec we already
    /// own — is producing the bytes.
    #[test]
    fn a_real_git_command_is_capped_while_reading_the_pipe() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for args in [
            vec!["init", "--quiet"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
        ] {
            let ok = Command::new("git")
                .current_dir(root)
                .args(&args)
                .output()
                .expect("git");
            assert!(ok.status.success(), "git {args:?}");
        }
        std::fs::write(root.join("big.txt"), "x".repeat(2 * 1024 * 1024)).unwrap();
        let got = git_with_cap(root, &["status", "--porcelain"], 32).unwrap();
        assert!(got.len() <= 32 + 128, "kept {} bytes", got.len());

        // and a genuinely large stdout: the untracked file's full diff
        Command::new("git")
            .current_dir(root)
            .args(["add", "big.txt"])
            .output()
            .unwrap();
        let diff = git_with_cap(root, &["diff", "--cached"], 4096).unwrap();
        assert!(diff.len() <= 4096 + 128, "kept {} bytes of diff", diff.len());
        assert!(diff.contains("truncated"), "no truncation marker");
    }
}
