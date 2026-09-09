CRITERIA:  C1 met — domain/dispatch.test.ts::c1_three_clicks_from_ranking_to_dispatch records ranking-row → generate-task → confirm-dispatch (length 3); PartPanel.test.tsx clicks 生成任务 and then sees 确认派发
           C2 met — domain/goalCard.test.ts: exact §9.1 keys, auth all false, composer text unmodified, no `%`, no progress field
           C3 met — dispatch::tests::c3_worktree_is_outside_the_scanned_tree, c3_scanned_tree_is_byte_identical_after_dispatch, c3_two_tasks_get_different_worktrees_and_branches, c3_dispatch_without_git_repo_is_typed_error_and_writes_no_task_row, c3_dispatch_refuses_a_command_whose_argv_contains_push
           C4 met — runner::tests::c4_runner_streams_lines_as_they_arrive; components/RightPanel.test.tsx renders lines + worktree + command, and the empty selected-task state
           C5 met — db::tests::c5_task_row_round_trips_through_every_state; dispatch::tests::c5_exit_zero_is_checking_not_done
BASELINE:  npm 47 passed / cargo 24 passed
AFTER:     Test Files  10 passed (10)
           Tests  60 passed (60)
           test result: ok. 36 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.79s
INVARIANT: wire progress still derived from criteria (db.rs tests green): yes
           scanned tree never written (new dispatch test): yes
           llm.rs gate tests still green: yes
FILES:     app/src-tauri/src/worktree.rs
           app/src-tauri/src/runner.rs
           app/src-tauri/src/dispatch.rs
           app/src-tauri/src/db.rs
           app/src-tauri/src/commands.rs
           app/src-tauri/src/lib.rs
           app/src-tauri/src/gitutil.rs
           app/src/lib/api.ts
           app/src/domain/types.ts
           app/src/domain/dispatch.ts
           app/src/domain/dispatch.test.ts
           app/src/domain/goalCard.test.ts
           app/src/hooks/useAppState.ts
           app/src/components/GoalCardView.tsx
           app/src/components/PartPanel.tsx
           app/src/components/PartPanel.test.tsx
           app/src/components/RightPanel.tsx
           app/src/components/RightPanel.test.tsx
           app/src/components/RobotView.tsx
           app/src/components/TaskView.tsx
           app/src/index.css
           REPORT-round2-wp2.md
SCOPE:     extended: app/src-tauri/src/dispatch.rs — worktree + runner + db orchestration so commands.rs does not hold the db mutex across a child process
           extended: app/src/components/GoalCardView.tsx — the preview between click 2 and click 3
           extended: app_paths / list_tasks / get_task / read_task_log / remove_worktree commands — persist, reopen, and explicit worktree removal
           FleetView.tsx untouched — ranking-row click 1 already called openRanking

## 1. Files

- `app/src-tauri/src/worktree.rs` — `git worktree add -b tinman/<id>` under `<data_dir>/worktrees/<id>`, verified via `git worktree list --porcelain`. Removal is `git worktree remove --force` and is never called from dispatch.
- `app/src-tauri/src/runner.rs` — `ProcessRunner` trait; `StdProcessRunner` pipes stdout/stderr on background threads; `ScriptedRunner` for tests; `forbidden_token` refuses push/deploy/publish; goal.json + log.txt live under `<data_dir>/tasks/<id>/`, not in the worktree.
- `app/src-tauri/src/dispatch.rs` — `start_dispatch` creates the worktree and writes the row (queued or waiting_dispatch) or fails with a typed `DispatchError` and no row. `run_started` marks running, streams, then `checking` (exit 0) or `failed`. `done` is not a transition here.
- `app/src-tauri/src/db.rs` — `TaskRecord` / `put_task` / `get_task` / `list_tasks`. Four core tables unchanged.
- `app/src-tauri/src/commands.rs` — `dispatch_task` (snake_case), `list_tasks`, `get_task`, `read_task_log`, `remove_worktree`, `app_paths`. Child process runs in `spawn_blocking` on a second sqlite connection. Events: `task-output`, `task-state`.
- `app/src-tauri/src/lib.rs` — mods + handler registration.
- `app/src-tauri/src/gitutil.rs` — `branch_exists` via `show-ref --verify`.
- `app/src/domain/dispatch.ts` — `draftGoal(DraftGoalInput)` replaces the counter stub. `newTaskId()` is `t_` + 12 hex from UUID. LLM miss → ASSUMED hand-fill, card still built.
- `app/src/domain/goalCard.test.ts` / `dispatch.test.ts` — C2 and C1.
- `app/src/hooks/useAppState.ts` — generateGoal, confirmDispatch, tasks, live lines, log reload on workspace load.
- `app/src/components/GoalCardView.tsx` — preview; 确认派发 is click 3.
- `app/src/components/PartPanel.tsx` — 生成任务 enabled.
- `app/src/components/RightPanel.tsx` — terminal pane always shows worktree + command + lines (or the empty-state copy). Not behind a disclosure.
- `app/src/components/TaskView.tsx` — persisted row: state, station, worktree, times, result.
- `app/src/lib/api.ts` — invoke wrappers; ipcContract 25 tests green.
- `app/src/index.css` — terminal + task meta.

Not modified: `demo/`, `robot-v2.html`, `REPORT-round1.md`, `REPORT-round2-wp1.md`, `llm.rs`, `scanner.rs`, migrations, the four core table definitions. No commit, no push.

## 2. Final test summary lines

npm test:

```
 Test Files  10 passed (10)
      Tests  60 passed (60)
```

cargo test (`CARGO_TARGET_DIR=/tmp/tinman-target`):

```
test result: ok. 36 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.79s
```

`npx tsc --noEmit` exit 0.

## 3. Decisions

**Worktree first, row second.** `start_dispatch` refuses (not a git repo / branch exists / path exists / path inside the scanned tree / forbidden argv) before `put_task`. A failed worktree leaves `COUNT(*) FROM task = 0`. After a successful worktree, a db write failure removes the worktree so we do not leak a half-created task.

**Exit 0 is `checking`.** `state_after_exit(0) == "checking"`. Verification write-back is WP3. `completeDemoTask` in this package now also lands on `checking`, not `done`.

**Interactive vs launched.** Agent defs come from app prefs `agents[]`, falling back to three interactive stubs (`this-pc`, `agent-cli`, `station`) with an empty program. Empty program is treated as interactive: worktree is created, command is written into `result_json` and the log, nothing is spawned. That is how an unconfigured machine never launches grok/codex. A non-interactive agent with a program is launched; argv is checked for `push`/`deploy`/`publish` (substring, case-insensitive) on both the template and the rendered argv.

**Authorization is sealed on the way in.** `seal_goal` overwrites `allow_push/deploy/spend` to false and strips a top-level `progress` key, regardless of what the UI sent.

**Goal card from real inputs.** `user_intent_verbatim` is `[composerDraft]` with no trim. Facts come from the part scan. `framework_advice` prefers `Purpose::DraftGoal` output (the gate returns `Validated::Other`, so the UI accepts `advice`, or `output.framework_advice`, or top-level `next_step`). Any of WP1's four unavailable reasons still produce a card plus an `ASSUMED: … hand-filled …` line.

**Logs outlive the process.** Each line is appended to `<data_dir>/tasks/<id>/log.txt` and emitted as `task-output`. Reopening a workspace reloads those files into `taskLines`.

**One station, no queue.** A second dispatch is allowed immediately and gets its own worktree/branch. Occupied-station waiting is WP3.

## 4. Criteria I could not demonstrate in a live window

I did not launch the Tauri app or click the three-click path in a real window. C1 is the domain transition test plus the PartPanel button/card test. FleetView's ranking row already called `openRanking`; I did not remount AppShell and fireEvent the ranking row, the generate button, and 确认派发 in one tree.

`StdProcessRunner` is untested against a real OS process. The C4 test uses `ScriptedRunner` as required. Pipe/thread bugs in the real runner would only show up when a non-interactive agent is actually configured.

`remove_worktree` is a command with no abandon button. The brief says abandoning must be able to *keep* the worktree and that removal is never automatic; I implemented the primitive and did not add a UI that calls it.

## 5. Unsure, wrong first, or unverified

- Default agents are interactive stubs. If the intended first-run behaviour was to spawn a hard-coded CLI, that is not what shipped; configuration is the switch. I would rather not put `grok`/`codex` in the binary.
- `DraftGoal` is not validated as `FrameworkAdvice` in `llm.rs` (WP1 left it as `Validated::Other`). Parsing is best-effort. A weird JSON shape degrades; it does not block.
- `todo_count` in `facts` is a number. C2 forbids a numeric *progress* field, not every number. The test allows this.
- C1's click counter increments as the test itself calls the three store functions. That matches "driving the real store transitions". It is not a Playwright-style click count.
- `git worktree list` paths on macOS may be `/tmp` vs `/private/tmp`. Matching canonicalises both. Tests passed on this machine.
- WP1 left `llm.rs`, `Cargo.toml`, `001_init.sql`, `scanner.rs`, `package-lock.json` dirty on `rig/round2`. I did not add to those diffs.
- `dispatch_task` reconstructs `CommandSpec` from `result_json` after releasing the db lock, so the mutex is not held across the child. If `result_json` were missing, program/argv would be empty and the spawn would fail into `failed`. `start_dispatch` always writes that object.
- I originally typed the `wire_id` fallback as `goalDraft.target.wire` (a label). generateGoal sets `selectedWireId`, so the happy path was fine; the fallback is now `''`.

## 6. Brief items I think are slightly off

- The expected-scope list includes `FleetView.tsx`. Click 1 already existed (`openRanking`). Changing that file would have been theatre.
- "queued → running on spawn" has no state for "worktree ready, human will type the command". I used `waiting_dispatch` for interactive agents. That is already in `TaskState`. If you wanted interactive tasks to sit in `queued`, say so.
- `c3_dispatch_refuses_a_command_whose_argv_contains_push` is listed under C3 (worktree isolation) but it never creates a worktree. It is still a dispatch invariant and it writes no row.
- Existing `dispatch.test.ts` asserted `worktree_path` contains `/tmp/tinman/`. That was the stub this package was asked to delete. The replacement asserts `/worktrees/` and "not under the project root".
