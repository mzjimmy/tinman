use std::path::Path;
use std::process::Command;

use crate::error::{AppError, Result};

/// Run git with `--no-optional-locks` so status/diff never refresh the index.
pub fn git(root: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .current_dir(root)
        .arg("--no-optional-locks")
        .args(args)
        .output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::msg(format!(
            "git {} failed: {}",
            args.join(" "),
            err.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
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
