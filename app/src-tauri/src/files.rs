use std::fs;
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};

use crate::error::Result;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    ".oa",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
];

const NODE_CAP: usize = 4000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FileNode>,
}

pub fn list_tree(root: &Path) -> Result<FileNode> {
    let root = fs::canonicalize(root)?;
    let mut root_node = FileNode {
        name: root
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.to_string_lossy().into_owned()),
        path: ".".into(),
        kind: "dir".into(),
        children: Vec::new(),
    };

    let walker = WalkBuilder::new(&root)
        .standard_filters(true)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|n| !SKIP_DIRS.contains(&n))
                .unwrap_or(true)
        })
        .build();

    let mut files: Vec<(PathBuf, bool)> = Vec::new();
    for dent in walker.flatten() {
        let path = dent.path();
        if path == root {
            continue;
        }
        let is_dir = dent.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if let Ok(rel) = path.strip_prefix(&root) {
            files.push((rel.to_path_buf(), is_dir));
        }
        if files.len() >= NODE_CAP {
            break;
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    for (rel, is_dir) in files {
        insert_node(&mut root_node, &rel, is_dir);
    }
    Ok(root_node)
}

fn insert_node(root: &mut FileNode, rel: &Path, is_dir: bool) {
    let mut cur = root;
    let comps: Vec<_> = rel.iter().collect();
    for (i, comp) in comps.iter().enumerate() {
        let name = comp.to_string_lossy().into_owned();
        let last = i + 1 == comps.len();
        let kind = if last && !is_dir { "file" } else { "dir" };
        let path = rel
            .iter()
            .take(i + 1)
            .collect::<PathBuf>()
            .to_string_lossy()
            .replace('\\', "/");
        if let Some(idx) = cur.children.iter().position(|c| c.name == name) {
            cur = &mut cur.children[idx];
            continue;
        }
        cur.children.push(FileNode {
            name: name.clone(),
            path,
            kind: kind.into(),
            children: Vec::new(),
        });
        let idx = cur.children.len() - 1;
        cur = &mut cur.children[idx];
    }
}
