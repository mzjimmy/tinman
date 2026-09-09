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
cd app/src-tauri && cargo test
```

## Demo (reference only)

```bash
cd demo
npm install
npm run dev
```

Visual reference: `robot-v2.html`.
