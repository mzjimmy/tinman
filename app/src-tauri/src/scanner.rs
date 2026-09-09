use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Instant;

use ignore::WalkBuilder;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::gitutil::{git, git_ok, is_git_repo};

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

const CONTENT_MAX: u64 = 512 * 1024;
const MARKER_CAP: usize = 500;
const TREE_CAP: usize = 400;

static MARKER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(TODO|FIXME|HACK)\b").expect("marker regex"));

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScanProgress {
    pub files_seen: u64,
    pub phase: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TreeEntry {
    pub name: String,
    pub kind: String,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    pub path: String,
    pub kind: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct EntryPoints {
    pub npm_scripts: BTreeMap<String, String>,
    pub makefile_targets: Vec<String>,
    pub dockerfile: bool,
    pub readme_commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TestFacts {
    pub files: Vec<String>,
    pub pass: Option<u64>,
    pub fail: Option<u64>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct FileTouch {
    pub path: String,
    pub commits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct GitFacts {
    pub branch: Option<String>,
    pub last_commit_at: Option<String>,
    pub last_commit_subject: Option<String>,
    pub uncommitted: bool,
    pub top_files_30d: Vec<FileTouch>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Marker {
    pub kind: String,
    pub path: String,
    pub line: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Facts {
    pub root: String,
    pub scanned_at: String,
    pub duration_ms: u64,
    pub file_count: u64,
    pub by_extension: BTreeMap<String, u64>,
    pub loc_by_language: BTreeMap<String, u64>,
    pub tree: Vec<TreeEntry>,
    pub dependencies: Vec<Manifest>,
    pub entry_points: EntryPoints,
    pub tests: TestFacts,
    pub git: GitFacts,
    pub markers: Vec<Marker>,
    pub spec_docs: Vec<String>,
    pub design_files: Vec<String>,
    pub reference_images: Vec<String>,
    pub routes: Vec<String>,
    pub api_endpoints: Vec<String>,
    pub pages: Vec<String>,
}

pub fn scan(root: &Path, mut emit: impl FnMut(ScanProgress)) -> Result<Facts> {
    let root = fs::canonicalize(root)?;
    if !root.is_dir() {
        return Err(AppError::msg(format!(
            "not a directory: {}",
            root.display()
        )));
    }
    let started = Instant::now();
    emit(ScanProgress {
        files_seen: 0,
        phase: "walk".into(),
        message: format!("scanning {}", root.display()),
    });

    let mut file_count = 0u64;
    let mut by_extension: BTreeMap<String, u64> = BTreeMap::new();
    let mut loc_by_language: BTreeMap<String, u64> = BTreeMap::new();
    let mut top_counts: BTreeMap<String, (String, u64)> = BTreeMap::new();
    let mut markers = Vec::new();
    let mut test_files = Vec::new();
    let mut spec_docs = Vec::new();
    let mut design_files = Vec::new();
    let mut reference_images = Vec::new();
    let mut routes = Vec::new();
    let mut api_endpoints = Vec::new();
    let mut pages = Vec::new();
    let mut manifest_paths: Vec<(String, PathBuf)> = Vec::new();
    let mut dockerfile = false;
    let mut makefile: Option<PathBuf> = None;
    let mut readme: Option<PathBuf> = None;

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

    for dent in walker {
        let dent = match dent {
            Ok(d) => d,
            Err(_) => continue,
        };
        let path = dent.path();
        if path == root {
            continue;
        }
        let rel = match path.strip_prefix(&root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if dent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let meta = match path.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }

        file_count += 1;
        if file_count % 40 == 0 {
            emit(ScanProgress {
                files_seen: file_count,
                phase: "walk".into(),
                message: rel.clone(),
            });
        }

        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext.is_empty() {
            *by_extension.entry("(none)".into()).or_insert(0) += 1;
        } else {
            *by_extension.entry(ext.clone()).or_insert(0) += 1;
        }

        let top = rel.split('/').next().unwrap_or(&rel).to_string();
        let kind = if rel.contains('/') { "dir" } else { "file" };
        let entry = top_counts.entry(top.clone()).or_insert((kind.into(), 0));
        entry.1 += 1;
        if rel.contains('/') {
            entry.0 = "dir".into();
        }

        if let Some(lang) = language_of(&ext) {
            if should_count_loc(&name, &ext, meta.len()) {
                if let Ok(loc) = count_nonblank(path) {
                    *loc_by_language.entry(lang.into()).or_insert(0) += loc;
                }
            }
        }

        classify_special(
            &rel,
            &name,
            &ext,
            &mut spec_docs,
            &mut design_files,
            &mut reference_images,
            &mut routes,
            &mut api_endpoints,
            &mut pages,
        );

        if is_test_file(&rel, &name) {
            test_files.push(rel.clone());
        }

        match name.as_str() {
            "package.json" => manifest_paths.push(("package.json".into(), path.to_path_buf())),
            "requirements.txt" => {
                manifest_paths.push(("requirements.txt".into(), path.to_path_buf()))
            }
            "pyproject.toml" => manifest_paths.push(("pyproject.toml".into(), path.to_path_buf())),
            "Cargo.toml" => manifest_paths.push(("Cargo.toml".into(), path.to_path_buf())),
            "go.mod" => manifest_paths.push(("go.mod".into(), path.to_path_buf())),
            "Gemfile" => manifest_paths.push(("Gemfile".into(), path.to_path_buf())),
            "Makefile" | "makefile" => makefile = Some(path.to_path_buf()),
            "Dockerfile" => dockerfile = true,
            _ => {
                if name.starts_with("Dockerfile") {
                    dockerfile = true;
                }
            }
        }
        if name.eq_ignore_ascii_case("readme.md") && readme.is_none() {
            readme = Some(path.to_path_buf());
        }

        if should_scan_markers(&name, &ext, meta.len()) && markers.len() < MARKER_CAP {
            scan_markers(path, &rel, &mut markers);
        }
    }

    emit(ScanProgress {
        files_seen: file_count,
        phase: "manifests".into(),
        message: "parsing dependency manifests".into(),
    });

    let mut dependencies = Vec::new();
    let mut npm_scripts = BTreeMap::new();
    for (kind, path) in &manifest_paths {
        let rel = path
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        match parse_manifest(kind, path) {
            Ok(data) => {
                if kind == "package.json" {
                    if let Some(scripts) = data.get("scripts").and_then(|s| s.as_object()) {
                        for (k, v) in scripts {
                            if let Some(cmd) = v.as_str() {
                                npm_scripts
                                    .entry(k.clone())
                                    .or_insert_with(|| cmd.to_string());
                            }
                        }
                    }
                }
                dependencies.push(Manifest {
                    path: rel,
                    kind: kind.clone(),
                    data,
                });
            }
            Err(_) => {
                dependencies.push(Manifest {
                    path: rel,
                    kind: kind.clone(),
                    data: serde_json::json!({ "parse_error": true }),
                });
            }
        }
    }

    let makefile_targets = makefile
        .as_ref()
        .map(|p| parse_makefile_targets(p).unwrap_or_default())
        .unwrap_or_default();
    let readme_commands = readme
        .as_ref()
        .map(|p| parse_readme_commands(p).unwrap_or_default())
        .unwrap_or_default();

    emit(ScanProgress {
        files_seen: file_count,
        phase: "git".into(),
        message: "reading git metadata".into(),
    });
    let git = collect_git(&root);

    let mut tree: Vec<TreeEntry> = top_counts
        .into_iter()
        .map(|(name, (kind, files))| TreeEntry { name, kind, files })
        .collect();
    tree.sort_by(|a, b| b.files.cmp(&a.files).then(a.name.cmp(&b.name)));
    tree.truncate(TREE_CAP);
    test_files.sort();
    spec_docs.sort();
    spec_docs.dedup();
    design_files.sort();
    design_files.dedup();
    reference_images.sort();
    pages.sort();
    pages.dedup();
    routes.sort();
    routes.dedup();
    api_endpoints.sort();
    api_endpoints.dedup();

    let duration_ms = started.elapsed().as_millis() as u64;
    emit(ScanProgress {
        files_seen: file_count,
        phase: "done".into(),
        message: format!("done in {duration_ms} ms"),
    });

    Ok(Facts {
        root: root.to_string_lossy().into_owned(),
        scanned_at: chrono::Utc::now().to_rfc3339(),
        duration_ms,
        file_count,
        by_extension,
        loc_by_language,
        tree,
        dependencies,
        entry_points: EntryPoints {
            npm_scripts,
            makefile_targets,
            dockerfile,
            readme_commands,
        },
        tests: TestFacts {
            files: test_files,
            pass: None,
            fail: None,
            note: "existence only; tests were not executed".into(),
        },
        git,
        markers,
        spec_docs,
        design_files,
        reference_images,
        routes,
        api_endpoints,
        pages,
    })
}

pub fn write_facts(dir: &Path, facts: &Facts) -> Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let path = dir.join("facts.json");
    let tmp = dir.join("facts.json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(facts)?)?;
    fs::rename(&tmp, &path)?;
    Ok(path)
}

pub fn scan_and_write(
    root: &Path,
    out_dir: &Path,
    emit: impl FnMut(ScanProgress),
) -> Result<(Facts, PathBuf)> {
    let root_c = fs::canonicalize(root)?;
    let out_c = if out_dir.exists() {
        fs::canonicalize(out_dir).unwrap_or_else(|_| out_dir.to_path_buf())
    } else {
        fs::create_dir_all(out_dir)?;
        fs::canonicalize(out_dir)?
    };
    if out_c.starts_with(&root_c) {
        return Err(AppError::msg(
            "refusing to write facts.json inside the scanned project",
        ));
    }
    let facts = scan(root, emit)?;
    let path = write_facts(&out_c, &facts)?;
    Ok((facts, path))
}

pub fn read_facts(dir: &Path) -> Result<Option<Facts>> {
    let path = dir.join("facts.json");
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&text)?))
}

fn language_of(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "ts" | "tsx" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "rs" => "Rust",
        "py" => "Python",
        "go" => "Go",
        "rb" => "Ruby",
        "java" => "Java",
        "kt" => "Kotlin",
        "swift" => "Swift",
        "c" | "h" => "C",
        "cpp" | "cc" | "cxx" | "hpp" => "C++",
        "cs" => "C#",
        "php" => "PHP",
        "sh" | "bash" | "zsh" => "Shell",
        "css" => "CSS",
        "html" | "htm" => "HTML",
        "md" | "mdx" => "Markdown",
        "json" => "JSON",
        "toml" => "TOML",
        "yml" | "yaml" => "YAML",
        "sql" => "SQL",
        "vue" => "Vue",
        "svelte" => "Svelte",
        _ => return None,
    })
}

fn should_count_loc(name: &str, ext: &str, size: u64) -> bool {
    if size > CONTENT_MAX {
        return false;
    }
    if name.ends_with(".lock") || name.ends_with("-lock.json") || name.ends_with(".min.js") {
        return false;
    }
    !matches!(
        ext,
        "png" | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "ico"
            | "icns"
            | "woff"
            | "woff2"
            | "ttf"
            | "eot"
            | "pdf"
            | "zip"
            | "gz"
            | "bin"
            | "node"
    )
}

fn should_scan_markers(name: &str, ext: &str, size: u64) -> bool {
    should_count_loc(name, ext, size)
        && !matches!(ext, "json" | "lock" | "svg")
        && name != "package-lock.json"
}

fn count_nonblank(path: &Path) -> Result<u64> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut n = 0u64;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        if !line.trim().is_empty() {
            n += 1;
        }
    }
    Ok(n)
}

fn scan_markers(path: &Path, rel: &str, out: &mut Vec<Marker>) {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let mut limited = file.take(CONTENT_MAX);
    let mut buf = String::new();
    if limited.read_to_string(&mut buf).is_err() {
        return;
    }
    for (i, line) in buf.lines().enumerate() {
        if out.len() >= MARKER_CAP {
            break;
        }
        if let Some(cap) = MARKER_RE.captures(line) {
            out.push(Marker {
                kind: cap.get(1).map(|m| m.as_str()).unwrap_or("TODO").into(),
                path: rel.to_string(),
                line: (i + 1) as u64,
            });
        }
    }
}

fn classify_special(
    rel: &str,
    name: &str,
    ext: &str,
    spec_docs: &mut Vec<String>,
    design_files: &mut Vec<String>,
    reference_images: &mut Vec<String>,
    routes: &mut Vec<String>,
    api_endpoints: &mut Vec<String>,
    pages: &mut Vec<String>,
) {
    let lower = rel.to_ascii_lowercase();
    let nlower = name.to_ascii_lowercase();
    if nlower.ends_with(".md")
        && (nlower.contains("readme")
            || nlower.contains("spec")
            || nlower.contains("design")
            || nlower.starts_with("adr")
            || nlower == "assumptions.md"
            || nlower == "context.md"
            || lower.starts_with("docs/")
            || !rel.contains('/'))
    {
        spec_docs.push(rel.to_string());
    }
    if matches!(ext, "fig" | "sketch" | "xd")
        || lower.contains("/design/")
        || nlower.contains("figma")
    {
        design_files.push(rel.to_string());
    }
    if matches!(ext, "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg")
        && (lower.contains("/docs/")
            || lower.contains("/design/")
            || lower.contains("/refs/")
            || lower.contains("/assets/")
            || lower.contains("/public/"))
    {
        reference_images.push(rel.to_string());
    }

    // Framework-convention routes/pages. Empty when this does not match.
    if (lower.contains("/app/") && nlower.starts_with("page.") && matches!(ext, "tsx" | "jsx" | "js"))
        || (lower.contains("/pages/")
            && !lower.contains("/pages/api/")
            && matches!(ext, "tsx" | "jsx" | "js"))
    {
        pages.push(rel.to_string());
    }
    if lower.contains("/pages/api/") || lower.contains("/app/api/") {
        api_endpoints.push(rel.to_string());
    }
    if lower.contains("/src/routes/") || lower.contains("/src/pages/") {
        routes.push(rel.to_string());
    }
}

fn is_test_file(rel: &str, name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let r = rel.replace('\\', "/").to_ascii_lowercase();
    n.contains(".test.")
        || n.contains(".spec.")
        || n.ends_with("_test.go")
        || n.ends_with("_test.rs")
        || (n.starts_with("test_") && n.ends_with(".py"))
        || r.contains("/tests/")
        || r.contains("/__tests__/")
}

fn parse_manifest(kind: &str, path: &Path) -> Result<serde_json::Value> {
    let text = fs::read_to_string(path)?;
    match kind {
        "package.json" => Ok(serde_json::from_str(&text)?),
        "Cargo.toml" | "pyproject.toml" => {
            let v: toml::Value = toml::from_str(&text)?;
            Ok(toml_to_json(v))
        }
        "requirements.txt" => {
            let reqs: Vec<String> = text
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty() && !l.starts_with('#'))
                .map(|l| l.to_string())
                .collect();
            Ok(serde_json::json!({ "requirements": reqs }))
        }
        "go.mod" => {
            let module = text
                .lines()
                .find_map(|l| l.strip_prefix("module ").map(|s| s.trim().to_string()));
            Ok(serde_json::json!({ "module": module, "raw_head": text.lines().take(20).collect::<Vec<_>>() }))
        }
        "Gemfile" => {
            let gems: Vec<String> = text
                .lines()
                .filter(|l| l.trim_start().starts_with("gem "))
                .map(|l| l.trim().to_string())
                .collect();
            Ok(serde_json::json!({ "gems": gems }))
        }
        _ => Ok(serde_json::json!({ "raw": text.chars().take(400).collect::<String>() })),
    }
}

fn toml_to_json(v: toml::Value) -> serde_json::Value {
    serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
}

fn parse_makefile_targets(path: &Path) -> Result<Vec<String>> {
    let text = fs::read_to_string(path)?;
    let mut out = Vec::new();
    for line in text.lines() {
        if line.starts_with('\t') || line.starts_with('#') || line.starts_with('.') {
            continue;
        }
        if let Some((name, _)) = line.split_once(':') {
            let name = name.trim();
            if !name.is_empty() && !name.contains('=') && !name.contains(' ') {
                out.push(name.to_string());
            }
        }
    }
    out.truncate(80);
    Ok(out)
}

fn parse_readme_commands(path: &Path) -> Result<Vec<String>> {
    let text = fs::read_to_string(path)?;
    let mut out = Vec::new();
    let mut in_fence = false;
    let mut is_cmd = false;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("```") {
            if in_fence {
                in_fence = false;
                is_cmd = false;
            } else {
                in_fence = true;
                let lang = rest.trim().to_ascii_lowercase();
                is_cmd = lang.is_empty()
                    || matches!(
                        lang.as_str(),
                        "bash" | "sh" | "zsh" | "shell" | "console" | "powershell"
                    );
            }
            continue;
        }
        if in_fence && is_cmd {
            let t = line.trim();
            if t.is_empty() || t.starts_with('#') {
                continue;
            }
            let cmd = t.strip_prefix('$').unwrap_or(t).trim();
            if !cmd.is_empty() {
                out.push(cmd.to_string());
            }
        }
    }
    out.truncate(50);
    Ok(out)
}

fn collect_git(root: &Path) -> GitFacts {
    if !is_git_repo(root) {
        return GitFacts::default();
    }
    let branch = git_ok(root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let last_commit_at = git_ok(root, &["log", "-1", "--format=%cI"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let last_commit_subject = git_ok(root, &["log", "-1", "--format=%s"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let uncommitted = git_ok(root, &["status", "--porcelain=v1", "-uall"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    if let Ok(log) = git(root, &["log", "--since=30 days ago", "--name-only", "--pretty=format:"])
    {
        for line in log.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            *counts.entry(line.to_string()).or_insert(0) += 1;
        }
    }
    let mut top: Vec<FileTouch> = counts
        .into_iter()
        .map(|(path, commits)| FileTouch { path, commits })
        .collect();
    top.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.path.cmp(&b.path)));
    top.truncate(10);
    GitFacts {
        branch,
        last_commit_at,
        last_commit_subject,
        uncommitted,
        top_files_30d: top,
    }
}

#[cfg(test)]
pub fn snapshot_tree(root: &Path) -> Result<BTreeMap<String, (u64, u128)>> {
    let mut map = BTreeMap::new();
    let walker = WalkBuilder::new(root)
        .standard_filters(false)
        .hidden(false)
        .git_ignore(false)
        .git_exclude(false)
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|n| !SKIP_DIRS.contains(&n) && n != "target")
                .unwrap_or(true)
        })
        .build();
    for dent in walker.flatten() {
        let path = dent.path();
        if !path.is_file() {
            continue;
        }
        let rel = match path.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if rel.contains("/node_modules/")
            || rel.contains("/target/")
            || rel.starts_with(".git/")
            || rel.contains("/.git/")
        {
            continue;
        }
        if let Ok(meta) = path.metadata() {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            map.insert(rel, (meta.len(), mtime));
        }
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .expect("repo root")
    }

    #[test]
    fn scan_this_repo_under_10s_read_only_and_populated() {
        let root = repo_root();
        let before = snapshot_tree(&root).expect("snapshot before");
        let start = Instant::now();
        let facts = scan(&root, |_| {}).expect("scan");
        let elapsed = start.elapsed();
        let after = snapshot_tree(&root).expect("snapshot after");

        assert!(
            elapsed < Duration::from_secs(10),
            "scan took {elapsed:?}, limit 10s"
        );
        assert_eq!(
            before, after,
            "scanned tree mtime+size changed — scanner must be read-only"
        );

        assert!(facts.file_count > 0, "file_count");
        assert!(
            facts.loc_by_language.values().copied().sum::<u64>() > 0,
            "loc_by_language empty: {:?}",
            facts.loc_by_language
        );
        assert!(
            facts
                .dependencies
                .iter()
                .any(|d| d.kind == "package.json"),
            "package.json not detected: {:?}",
            facts.dependencies.iter().map(|d| &d.kind).collect::<Vec<_>>()
        );
        assert!(
            facts.git.branch.as_deref().is_some_and(|b| !b.is_empty()),
            "git branch missing: {:?}",
            facts.git
        );
        assert!(
            !facts.markers.is_empty(),
            "TODO/FIXME/HACK not detected"
        );
        assert!(facts.tests.pass.is_none() && facts.tests.fail.is_none());
    }

    #[test]
    fn facts_are_written_outside_the_scanned_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        fs::create_dir(&project).unwrap();
        fs::write(
            project.join("package.json"),
            r#"{"name":"fixture","scripts":{"test":"echo ok"}}"#,
        )
        .unwrap();
        fs::write(project.join("main.rs"), "// TODO(round2): LLM prefill\nfn main() {}\n").unwrap();
        let data = tmp.path().join("data");
        let before = snapshot_tree(&project).unwrap();
        let (facts, path) = scan_and_write(&project, &data, |_| {}).unwrap();
        let after = snapshot_tree(&project).unwrap();
        assert_eq!(before, after);
        let data_c = fs::canonicalize(&data).unwrap();
        assert!(
            path.starts_with(&data_c),
            "facts path {path:?} not under {data_c:?}"
        );
        assert!(!project.join("facts.json").exists());
        assert!(facts.markers.iter().any(|m| m.kind == "TODO"));
        assert!(facts
            .dependencies
            .iter()
            .any(|d| d.kind == "package.json"));
    }

    #[test]
    fn refuses_to_write_facts_inside_scan_root() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("proj");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("a.txt"), "hi\n").unwrap();
        let err = scan_and_write(&project, &project.join("nested"), |_| {}).unwrap_err();
        assert!(err.to_string().contains("refusing"));
    }
}
