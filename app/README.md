# Tinman (desktop)

Local read-only workbench. Round 1: scan a folder, confirm a 7-slot architecture map, watch short-leg ranking.

## Why Tauri v2, not Electron

The shell is a thin native WebView plus a Rust sidecar. A Tauri v2 bundle is ~10 MB; Electron ships Chromium and lands around ~150 MB. Repo scanning, git status, and SQLite all belong in-process on the Rust side so the UI thread never walks the tree. If Tauri had been unworkable here we would have fallen back to Electron and recorded the exact error — it was not.

## Run

```bash
cd app
npm install
npm run tauri dev
```

SQLite and `facts.json` live in the OS app-data directory (`~/Library/Application Support/dev.tinman.workbench` on macOS), never inside the scanned project.

## Test

```bash
cd app
npm test
cd src-tauri && cargo test
```

The canned React demo remains at `../demo/` as a visual/domain reference and is not used at runtime.
