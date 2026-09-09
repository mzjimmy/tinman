# REPORT — round 2

Round 1 delivered spec §13 steps 1–4: read-only scanning, the architecture-map confirmation
sheet, the robot SVG, and the fleet view with short-leg ranking. Round 2 delivers steps 5–8 —
the LLM layer, task dispatch, the station queue, delivery verification, and the acceptance
sweep — on branch `rig/round2`.

The work was delegated to an outside agent (grok-4.6) in four test-first packages, each with a
written outcome contract; every criterion was then re-verified in this session against the live
code rather than against the agent's report. The four package reports are kept alongside this
one: `REPORT-round2-wp1.md` … `REPORT-round2-wp4.md`.

## 1. Test summaries (verbatim, re-run by me after each package)

```
npm test    ->  Test Files  13 passed (13)
                     Tests  99 passed (99)

cargo test  ->  test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

npx tsc --noEmit -> exit 0
```

Round-1 baseline was 35 front-end and 8 Rust tests. Nothing was deleted to get here; two tests
were replaced and both replacements assert more than the originals (see §5).

## 2. What was built

**Package 1 — the LLM layer and its gate** (`app/src-tauri/src/llm.rs`, 1332 lines).
`llm::call(purpose, input)` is the single path, and `Purpose` is a closed four-variant enum
(`map_architecture` / `advise_part` / `draft_goal` / `verify_delivery`) deserialised before any
transport is constructed. Providers are data: an OpenAI-compatible base URL or a local Ollama
endpoint, stored as profiles in app prefs and selected per workspace through the previously
unused `workspace.llm_profile_id`. The API key lives in the OS keychain, is scrubbed out of every
logged row and every error string, and its `Debug` impl redacts it.

The gate is the feature. `validate(purpose, raw, facts)` is a pure function that refuses fenced
code, diff hunks, function-definition lines, percentages, progress fractions, and a `progress`
key anywhere in the JSON; requires all five `advise_part` fields with 3–5 `done_criteria`; and
refuses a `diagnosis` that cites nothing traceable to the facts that were sent — with the spec's
own escape hatch, `事实不足`, honoured as valid rather than rejected. Every call, accepted or
rejected, is logged with its verdict.

**Package 2 — goal card, worktree, dispatch, terminal** (`worktree.rs`, `runner.rs`,
`dispatch.rs`). The round-1 stub that invented `/tmp/tinman/<id>` and a module-level counter is
gone. A card is now built from the selected part and wire, the composer text verbatim, the scan
facts, and `Purpose::DraftGoal` advice — degrading to a recorded assumption rather than blocking
when no model is configured. `seal_goal` overwrites `allow_push` / `allow_deploy` / `allow_spend`
to false and strips any `progress` key regardless of what the UI sent. Dispatch creates a real
`git worktree` at `<app_data>/worktrees/<task_id>` on `tinman/<task_id>`, verified against
`git worktree list`; a refusal (not a git repo, branch exists, path inside the project, argv
containing push/deploy/publish) writes no task row at all. Output streams line by line to the
terminal pane and to a log file, so history survives a restart. A process exiting 0 reaches
`checking`, never `done`.

**Package 3 — stations, queue, verification** (`queue.rs`, `verify.rs`). Stations are database
rows, not React state, so "reopen the app" and "re-render" take the same path. `claim_next` is
the only assigner and runs after every terminal transition and at startup. Contention is keyed on
the wire and on the normalised `shared_risk` from the goal card, so one task owns a shared surface
and the rest queue. A failed task frees its station, keeps its worktree, and leaves every other
task untouched. Verification grounds each `done_criteria` item in the worktree's git diff, the
task log, or the delivery text — a log line that only says "done" is not evidence — and writes
the result back through the existing criteria path, so the part's fill rises because
`derived_progress` recomputes, never because anything wrote a number.

**Package 4 — the acceptance sweep and the takeover actions.** Pause, take over by hand, and
abandon-keeping-the-worktree now exist as real controls. The composer's model selector selects
the workspace's provider profile instead of offering the round-1 placeholder names, and says
"未配置模型" plainly when nothing is configured. Station count is editable and defaults to 2.
`app/src/acceptance.test.tsx` walks the spec's twelve acceptance items, one `describe` each.

## 3. Verification I ran myself, beyond the agents' reports

- Both suites re-run after every package, plus `npx tsc --noEmit`.
- Read `validate()`, `seal_goal()`, `forbidden_token()`, `worktree::create()` and the dispatch
  tests line by line. The worktree tests use real `git`, not a mock.
- Scope checked mechanically: `git diff` confirms `scanner.rs`'s read-only guarantees untouched
  by packages 1–3, the four core tables' DDL unchanged, and one migration file throughout.
- **Drove the real UI in a browser at 1024 px** — the one criterion no jsdom test can settle.
  At 1440 px the workspace grid is `260px 980px 200px`; at 1024 px it becomes `824px 200px`:
  two columns, the right action bar still 200 px wide and visible, the left rail collapsed, and
  no horizontal scroll. A probe SVG carrying the robot's exact `viewBox="0 0 200 260"`,
  `preserveAspectRatio="xMidYMid meet"` and `.robot-svg` class, injected into the real layout at
  1024 px, rendered 280×364 — 0.000% distortion, no overflow into the right bar.
- Same browser session with no Tauri bridge and no network: the whole shell rendered, no error
  banner, and the console carried exactly one line, React's DevTools notice. That is spec §12
  item 11 verified for real, not simulated.

## 4. Spec §12 acceptance list

| # | Item | Status |
|---|------|--------|
| 1 | Facts + map sheet within 10s, robot renders after confirm | Scanner budget verified against a synthetic 100k-line repo; the live add-folder click-through in a window is not asserted |
| 2 | Unconfirmed map: all dark, no invented progress | Verified (`RobotSvg.test.tsx`, `progress.test.ts`) |
| 3 | Three people, five projects, 15 seconds | **Not machine-checkable** — a human study, not run |
| 4 | Ranking → dispatched task in ≤3 clicks | Verified (`dispatch.test.ts::c1_three_clicks_from_ranking_to_dispatch`) |
| 5 | Five advice fields, `diagnosis` cites a clickable fact | Verified; the citation was plain text before package 4 and is now a real link |
| 6 | Code or a percentage is intercepted and recorded | Verified (`llm.rs` gate tests) |
| 7 | Two tasks, independent worktrees, no overwriting | Verified (`verify.rs::c5_two_concurrent_tasks_have_independent_worktrees`) |
| 8 | Fill rises by the met ratio, traceable to evidence | Verified (`verify.rs::c4_part_fill_rises_by_the_met_ratio_after_write_back`, 0 → 40) |
| 9 | Blocked part pulses in both views | Verified (`acceptance.test.tsx`, both views, same state) |
| 10 | Force-quit and restart restores stations, queue, history | Verified (`queue.rs` recovery tests) |
| 11 | Offline start: scan and visuals work, LLM degrades, no errors | Verified in a real browser |
| 12 | 1024 px drops to two columns, robot not distorted | Verified in a real browser |

## 5. Tests replaced (nothing was weakened)

- `scanner::tests::scan_this_repo_under_10s_read_only_and_populated` was split. The 10s budget in
  the spec is a claim about a 100k-line repo, not about whatever filesystem the checkout sits on;
  the unchanged scanner took 11s and 41s on consecutive runs of this checkout. It is now
  `scan_100k_line_repo_under_10s` against a synthetic 100k-line fixture in the system temp dir
  (local disk), plus `scan_this_repo_is_read_only_and_populated` keeping every read-only and
  content assertion without a wall-clock number hostage to the mount. **This was my change, not
  the outside agent's.**
- `domain/dispatch.test.ts` asserted `worktree_path` contained `/tmp/tinman/` — the stub path
  package 2 was asked to delete. The replacement asserts the worktree is under `/worktrees/` and
  *not* under the project root, which is the property that actually matters.

## 6. Unsure, unverified, or honestly scoped

- **"The scanned tree is byte-identical after dispatch" excludes `.git/`.** `git worktree add`
  necessarily writes `.git/worktrees/<id>`. That is git's own bookkeeping, not a change to the
  user's working files, but the claim should be read with that scope.
- `StdProcessRunner` has never been exercised against a real OS process. Every test uses the
  injected `ScriptedRunner`, as the briefs required. Pipe or thread bugs in the real runner would
  only appear once a non-interactive agent is actually configured.
- No real keychain round-trip and no real provider HTTP call anywhere. Both are injected traits.
- The Tauri desktop window itself was never launched — `npm run tauri dev` was not run, so native
  menus, the folder picker, and window-title updates remain compiled and wired rather than seen.
  The browser verification above ran the same front end under vite.
- The dependency heuristic (`wire:<id>` plus normalised `shared_risk`) will not catch two
  phrasings of the same surface, or shared files never named in `shared_risk`. It is deliberately
  conservative: two tasks on one wire never run together.
- Crash recovery moves a task the database left `running` to `failed`, not `queued`, because
  re-queuing would relaunch an agent onto unknown leftover work. The worktree is kept.
- `verify` uses `git diff --name-only HEAD` on a dirty worktree as evidence, so a user editing
  unrelated files whose paths appear in a criterion's text could accidentally ground it.
- The citation check is a substring match against the facts JSON, so `db.rs` matches `src/db.rs`.
- A bare `3/5` without 完成 is not caught as a progress number. Harmless in practice: progress
  cannot come from model text at all, only from counting criteria.
- Default agent definitions are interactive stubs with an empty program, so an unconfigured
  machine never spawns a CLI. Configuration is the switch, deliberately.

## 7. Environment notes for the next person

This checkout sits on a virtualised `/Volumes/...` mount that is extremely slow and **cannot do
POSIX file locking**. Three things follow, all of them fixed here:

- `app/src-tauri/.cargo/config.toml` disables incremental compilation; rustc's session lock fails
  on this filesystem with `Operation not supported (os error 45)`.
- cargo cannot take its build-directory lock inside the repo at all. Run
  `CARGO_TARGET_DIR=/tmp/tinman-target cargo test`.
- `app/node_modules` is a **symlink** to `/Users/sentinellab/.cache/tinman-node/node_modules`.
  Installing there takes 3 seconds against 15 minutes on the mount, and the front-end suite went
  from 294 seconds (or hanging indefinitely) to under 2. To change a JS dependency, edit
  `app/package.json`, install in `/Users/sentinellab/.cache/tinman-node/`, and copy the lockfile
  back.

Also fixed: `app/package-lock.json` carried an optional
`@rolldown/binding-openharmony-arm64` entry with no `version` field, which made every
`npm install` fail with `Invalid Version:`. The entry is removed.

## 8. Not done

Nothing in the round-2 scope was left out. Outside that scope and unchanged by design: `demo/`
and `robot-v2.html` remain frozen reference, `tauri build` was not run, and acceptance item 3
needs three humans and five projects.

**The work is uncommitted on branch `rig/round2`.** To commit it:

```bash
git add -A && git commit -m "feat(app): round-2 LLM gate, worktree dispatch, station queue, delivery verification"
```
