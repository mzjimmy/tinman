# REPORT — round 1

## 1. Files changed

Root:

- `.gitignore` — ignore `app/node_modules`, `app/dist`, `app/src-tauri/target`.
- `README.md` — point at `app/`, state Tauri-over-Electron.
- `REPORT-round1.md` — this file.
- `demo/` and `robot-v2.html` — not modified.

`app/` (new Tauri v2 workbench):

- `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `README.md`, `.gitignore` — scaffold + vitest.
- `src/domain/types.ts`, `progress.ts`, `shortLeg.ts`, `dispatch.ts` — ported domain maths/vocabulary.
- `src/domain/proposal.ts`, `fixtures.ts` — architecture-map proposal object; test fixtures replacing canned demo data.
- `src/domain/*.test.ts` — ported four demo suites, plus C3/C4 extras (2/5=40, no direct progress API, stalled 1.2, lagging 20pp).
- `src/robot/geometry.ts`, `src/components/RobotSvg.tsx` — ported SVG; unconfirmed path shows no progress figures.
- `src/components/{AppShell,FleetView,RobotView,PartPanel,MapSheet,RightPanel,TaskView}.tsx` — five-region shell, map sheet, real right-bar panels.
- `src/hooks/useAppState.ts`, `src/lib/{api,mapWorkspace,relativeTime}.ts` — Tauri IPC + SQLite-backed store.
- `src/index.css` — demo palette as CSS variables; dark default; one `prefers-color-scheme: light` query.
- `src-tauri/Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, `migrations/001_init.sql` — Tauri v2 + single migration.
- `src-tauri/src/{lib,commands,db,scanner,gitutil,files,error}.rs` — scan, SQLite, git, file tree, native menu.
- `src-tauri/icons/*` — create-tauri-app defaults.

## 2. Test summaries (verbatim)

Command: `cd demo && npm test`

```
 Test Files  4 passed (4)
      Tests  13 passed (13)
   Start at  03:09:29
   Duration  999ms (transform 156ms, setup 0ms, collect 319ms, tests 13ms, environment 2.69s, prepare 248ms)
```

Command: `cd app && npm test`

```
 Test Files  6 passed (6)
      Tests  21 passed (21)
   Start at  03:12:08
   Duration  712ms (transform 130ms, setup 242ms, collect 288ms, tests 67ms, environment 1.94s, prepare 295ms)
```

Command: `cd app/src-tauri && cargo test`

```
running 8 tests
test db::tests::wire_progress_is_derived_two_of_five_is_40 ... ok
test db::tests::wire_input_json_has_no_progress_field ... ok
test scanner::tests::refuses_to_write_facts_inside_scan_root ... ok
test db::tests::part_with_no_wires_is_pending ... ok
test db::tests::round_trip_workspace_parts_wires ... ok
test db::tests::stored_progress_column_is_ignored_on_read ... ok
test scanner::tests::facts_are_written_outside_the_scanned_tree ... ok
test scanner::tests::scan_this_repo_under_10s_read_only_and_populated ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s

     Running unittests src/main.rs (target/debug/deps/tinman-e75f37aa1575fd2a)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests app_lib

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Also: `npx tsc --noEmit` and `npx vite build` both exited 0. `npm run tauri dev` / a real 1440×900 window were not driven.

## 3. Key decisions (including departures from `demo/`)

- Tauri v2, not Electron: ~10 MB sidecar vs ~150 MB Chromium; scanner/git/SQLite belong in Rust off the UI thread.
- Persistence is SQLite, not localStorage. Chrome prefs (theme, last workspace, view) live in a sentinel `workspace` row `id=__tinman_app__` because the brief forbids extra tables.
- `wire.progress` is stored as a cache column (schema required it) but every write computes it from criteria and every read recomputes and ignores the column. `WireInput` has no `progress` field. A test updates the column to 99 via raw SQL and asserts the read-back is still 40.
- Unconfirmed robot: all ghost outlines, `待确认架构地图`, no `%` and no `进度` in the SVG (demo still put `进度 0%` in `<title>`). Fleet cards hide the corner percentage until confirm.
- Architecture map is a single `ArchitectureProposal` object `MapSheet` can ingest. Round 2 can prefill that object without changing the component.
- After confirm, “scan” is incremental facts refresh only; it does not rebuild parts/wires.
- Right bar at 1024 px stays visible; the left project rail hides instead. Demo hid the right bar. See §5.
- Git is invoked with `--no-optional-locks` so `status`/`diff` do not refresh the index. Tests are not executed during scan.
- LOC is non-blank physical lines by extension. Routes/pages/API lists stay empty unless Next/pages-convention paths exist.
- Dispatch domain + tests are ported so the four demo files stay green; the UI `生成任务` button is disabled. No worktree, no agent CLI.

## 4. Unsure / wrong at first / not verified

- Did not launch `npm run tauri dev` or click through the window. Scan overlay, folder picker, native menus, and window-title updates are compiled and wired, not seen.
- C10 was asserted from CSS + `preserveAspectRatio="xMidYMid meet"`, not from a real 1024 px window.
- First `cargo test` failed `facts_are_written_outside_the_scanned_tree`: macOS tempfile `/var/folders` canonicalizes to `/private/var/folders`, so `starts_with(data)` was false. Fixed by comparing canonical paths.
- First C2 vitest failed because `aria-label="项目进度机器人"` contains `进度`. Changed to `项目机器人`.
- Snapshot of “the scanned tree is unmodified” skips `node_modules`, `target`, and `.git` for speed. A write into those dirs would not be caught. Writes into source/docs would.
- `git status --porcelain` is still a process spawn; we did not prove with dtruss/fs_usage that git never opened a file for write.
- Sentinel `__tinman_app__` workspace is a schema dodge. A fifth `app_prefs` table would be cleaner; the brief said exactly four tables.
- TODO detection will light up on the word `TODO` in UI copy (`PartPanel` “TODO 数”) and in `commands.rs` `TODO(round2)`. That is detection working, not a project-health signal.
- `tauri build` (signed .app) was not run.

## 5. Brief items I believe are mistaken or in tension

- **C10 vs §4.6 right bar.** C10 wants two columns at 1024 px. Demo did that by `display:none` on the right bar. §4.6 says the right bar must never be hidden because it is the escape hatch. I kept the right bar and hid the left rail instead. If C10 meant “copy the demo”, this is a miss; if §4.6 is the product rule, demo is the miss.
- **§4.2 “weighted mean of wires”.** No per-wire weight exists in the schema or the demo. I kept the demo’s equal average of `wireProgress`. A weighted mean needs a weight column the brief did not give.
- **`wire.status` ∈ unmapped.** Domain wires are `Exclude<PartStatus, 'unmapped'>`. SQL allows `unmapped` because the brief listed it. Persistence never writes `unmapped` on a wire.
- **`$APPDATA/tinman/workspaces/<id>/facts.json`.** Tauri’s app-data dir for identifier `dev.tinman.workbench` is `~/Library/Application Support/dev.tinman.workbench/` on macOS, not a folder literally named `tinman`. Facts go in `…/workspaces/<id>/facts.json` under that dir.
- **Demo C2.** The demo robot tooltip still rendered `进度 0%` before map confirmation. That fails the “no progress numbers whatsoever” rule; the app does not copy it.
- **Porting `persistence.test.ts` as-is** would reintroduce localStorage. Replaced with a write-type/`withCriteria` invariant on the TS side and a SQLite round-trip on the Rust side.

## 6. Assumptions

ASSUMED: LOC = non-blank physical lines grouped by file extension — because the brief asks for LOC by language and does not specify comment stripping. Reversible by swapping in tokei.

ASSUMED: app chrome (theme, last workspace, view, sort) is stored in workspace row `__tinman_app__` — because only four tables are allowed. Reversible by adding an `app_prefs` table.

ASSUMED: `prefs_json.mapConfirmed` is the confirmation flag — because `workspace` has no such column. Reversible by adding `map_confirmed INTEGER`.

ASSUMED: until tasks exist, the project-tree children are recent git paths with relative times — because dispatch is round 2. Reversible by reading `task` rows.

ASSUMED: git CLI with `--no-optional-locks` is read-only enough — because linking libgit2 would add build time and `git status` without the flag can touch the index. Reversible by parsing `.git` with git2 in read-only mode.

ASSUMED: a part with no wires is `pending` and the UI must not label it `0%` — matching §4.2; fill height is still empty. Reversible by showing `0%` once the map is confirmed.

ASSUMED: 3–6 criteria per wire are enforced at confirm, not at draft save — so a half-filled sheet can be stored. Reversible by validating on every keystroke.

ASSUMED: default slot weights head 2 / torso 3 / arms 2 / legs 2 / backpack 1, backpack present=false — matching demo defaults. Reversible in `DEFAULT_WEIGHTS` / `emptyProposal()`.

ASSUMED: at 1024 px hide the left rail, keep the 200 px right bar — because §4.6 forbids hiding the escape hatch. Reversible by restoring demo’s `right-bar { display:none }`.

ASSUMED: light theme is only the `prefers-color-scheme: light` query plus an explicit `data-theme` override — matching “dark by default, light through a single query”. Reversible by always setting `data-theme` from JS.

ASSUMED: create-tauri-app default icons are acceptable for round 1. Reversible by replacing `app/src-tauri/icons`.
