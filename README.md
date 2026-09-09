# Tinman

Robot-view multi-project workbench. The **desktop app** is [`app/`](app/) (Tauri v2). The canned React demo in [`demo/`](demo/) is a read-only reference for this round.

## Why Tauri v2 instead of Electron

Rust is already on the machine, the product spec prefers a small native sidecar, and a Tauri v2 bundle is ~10 MB against Electron’s ~150 MB. Scanning, git, and SQLite run off the UI thread in Rust. Electron would only have been the fallback if Tauri failed to build here.

## Desktop app

```bash
cd app
npm install
npm run tauri dev
```

```bash
cd app && npm test
cd app/src-tauri && CARGO_TARGET_DIR=/tmp/tinman-target cargo test
```

### If this checkout is on a slow or network mount

The `/Volumes/...` mount this repo lives on cannot do POSIX file locking, so cargo cannot take
its build lock inside the tree — hence `CARGO_TARGET_DIR` above, and
`app/src-tauri/.cargo/config.toml` disabling incremental compilation. `app/node_modules` is a
symlink to local disk for the same reason: installing there takes 3 seconds against 15 minutes
on the mount, and the front-end suite runs in 2 seconds instead of 5 minutes. To change a JS
dependency, edit `app/package.json`, install in the local-disk copy, and copy the lockfile back.
On an ordinary local checkout none of this applies — plain `cargo test` and `npm install` work.

## Demo (reference only)

```bash
cd demo
npm install
npm run dev
```

Visual reference: `robot-v2.html`.

## Rounds

- Round 1 (`REPORT-round1.md`) — read-only scan, SQLite store, robot and fleet views.
- Round 2 (`REPORT-round2.md`) — LLM layer with its validation gate, goal cards, worktree-isolated
  dispatch with a visible terminal, the station queue, and delivery verification that raises a
  part's fill only by flipping acceptance criteria.
