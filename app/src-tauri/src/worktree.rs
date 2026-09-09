//! Independent git worktrees for dispatched tasks.
//!
//! Worktrees live under the app-data directory, never inside the scanned
//! project tree. Creation is verified with `git worktree list`. Removal is
//! always explicit.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::gitutil::{self, git};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum WorktreeError {
    NotAGitRepo,
    BranchExists { branch: String },
    PathExists { path: String },
    PathInsideProject { path: String },
    VerifyFailed { detail: String },
    Git { detail: String },
    Io { detail: String },
}

impl std::fmt::Display for WorktreeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(s) => write!(f, "{s}"),
            Err(_) => write!(f, "worktree error"),
        }
    }
}

impl std::error::Error for WorktreeError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeInfo {
    pub path: PathBuf,
    pub branch: String,
}

pub fn planned_path(data_dir: &Path, task_id: &str) -> PathBuf {
    data_dir.join("worktrees").join(task_id)
}

pub fn branch_name(task_id: &str) -> String {
    format!("tinman/{task_id}")
}

/// True when `path` would land inside `root` after canonicalisation.
pub fn is_path_inside(path: &Path, root: &Path) -> bool {
    let root_canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    let resolved = if let Ok(c) = abs.canonicalize() {
        c
    } else if let Some(parent) = abs.parent() {
        match parent.canonicalize() {
            Ok(p) => p.join(abs.file_name().unwrap_or_default()),
            Err(_) => abs,
        }
    } else {
        abs
    };
    resolved.starts_with(&root_canon)
}

pub fn create(
    project_root: &Path,
    worktree_path: &Path,
    branch: &str,
    base: &str,
) -> Result<WorktreeInfo, WorktreeError> {
    if !gitutil::is_git_repo(project_root) {
        return Err(WorktreeError::NotAGitRepo);
    }
    if is_path_inside(worktree_path, project_root) {
        return Err(WorktreeError::PathInsideProject {
            path: worktree_path.display().to_string(),
        });
    }
    if gitutil::branch_exists(project_root, branch) {
        return Err(WorktreeError::BranchExists {
            branch: branch.to_string(),
        });
    }
    if worktree_path.exists() {
        return Err(WorktreeError::PathExists {
            path: worktree_path.display().to_string(),
        });
    }
    if let Some(parent) = worktree_path.parent() {
        fs::create_dir_all(parent).map_err(|e| WorktreeError::Io {
            detail: e.to_string(),
        })?;
    }
    let path_s = worktree_path.to_str().ok_or_else(|| WorktreeError::Io {
        detail: "worktree path is not utf-8".into(),
    })?;
    git(
        project_root,
        &["worktree", "add", "-b", branch, path_s, base],
    )
    .map_err(|e| WorktreeError::Git {
        detail: e.to_string(),
    })?;

    let list = git(project_root, &["worktree", "list", "--porcelain"]).map_err(|e| {
        WorktreeError::Git {
            detail: e.to_string(),
        }
    })?;
    if !list_contains_path(&list, worktree_path) {
        let _ = remove(project_root, worktree_path);
        return Err(WorktreeError::VerifyFailed {
            detail: format!("git worktree list did not include {path_s}"),
        });
    }
    Ok(WorktreeInfo {
        path: worktree_path.to_path_buf(),
        branch: branch.to_string(),
    })
}

pub fn remove(project_root: &Path, worktree_path: &Path) -> Result<(), WorktreeError> {
    let path_s = worktree_path.to_str().ok_or_else(|| WorktreeError::Io {
        detail: "worktree path is not utf-8".into(),
    })?;
    git(project_root, &["worktree", "remove", "--force", path_s]).map_err(|e| {
        WorktreeError::Git {
            detail: e.to_string(),
        }
    })?;
    Ok(())
}

pub fn list_contains_path(porcelain_or_plain: &str, path: &Path) -> bool {
    let candidates = path_candidates(path);
    porcelain_or_plain.lines().any(|line| {
        let listed = line
            .strip_prefix("worktree ")
            .unwrap_or_else(|| line.split_whitespace().next().unwrap_or(""));
        if listed.is_empty() {
            return false;
        }
        let listed_path = Path::new(listed);
        candidates.iter().any(|c| c == listed_path)
            || path_candidates(listed_path)
                .iter()
                .any(|c| candidates.iter().any(|x| x == c))
    })
}

fn path_candidates(path: &Path) -> Vec<PathBuf> {
    let mut out = vec![path.to_path_buf()];
    if let Ok(c) = path.canonicalize() {
        if !out.contains(&c) {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
pub fn init_git_fixture(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    let run = |args: &[&str]| {
        let out = std::process::Command::new("git")
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .args(args)
            .output()
            .expect("git");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    };
    run(&["init", "-b", "main"]);
    run(&["config", "user.email", "tinman@test"]);
    run(&["config", "user.name", "tinman"]);
    fs::write(dir.join("README.md"), "hello\n").unwrap();
    run(&["add", "README.md"]);
    run(&["-c", "commit.gpgsign=false", "commit", "-m", "init"]);
}
