CRITERIA:  C1 met — queue::tests::c1_default_station_count_is_two, c1_third_task_queues_when_two_stations_are_busy, c1_freed_station_claims_next_queued_task_without_user_action; domain/queue.test.ts claim order
           C2 met — queue::tests::c2_one_failure_leaves_other_tasks_untouched, c2_failed_task_keeps_its_worktree; TaskView.test.tsx failed task shows only its own failure
           C3 met — verify::tests::c3_verification_marks_each_criterion_with_evidence_or_a_reason, c3_agent_claiming_success_with_no_evidence_does_not_reach_done, c3_all_criteria_met_reaches_done
           C4 met — verify::tests::c4_part_fill_rises_by_the_met_ratio_after_write_back (0 → 40), c4_no_path_sets_progress_directly (SQL 99 still reads 40); db::tests::stored_progress_column_is_ignored_on_read still green
           C5 met — queue::tests::c5_stations_and_queue_rebuild_from_the_database, c5_task_left_running_by_a_crash_is_recovered_not_left_running; verify::tests::c5_two_concurrent_tasks_have_independent_worktrees
BASELINE:  npm 60 passed / cargo 36 passed
AFTER:     Test Files  12 passed (12)
           Tests  70 passed (70)
           test result: ok. 53 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 47.62s
INVARIANT: raw-SQL progress column still ignored on read: yes
           no code path sets progress directly: yes
           scanned tree never written: yes
           llm.rs gate tests still green: yes
FILES:     app/src-tauri/src/queue.rs
           app/src-tauri/src/verify.rs
           app/src-tauri/src/db.rs
           app/src-tauri/src/dispatch.rs
           app/src-tauri/src/commands.rs
           app/src-tauri/src/lib.rs
           app/src/domain/queue.ts
           app/src/domain/queue.test.ts
           app/src/domain/dispatch.ts
           app/src/hooks/useAppState.ts
           app/src/components/TaskView.tsx
           app/src/components/TaskView.test.tsx
           app/src/components/PartPanel.test.tsx
           app/src/index.css
           REPORT-round2-wp3.md
SCOPE:     extended: app/src-tauri/src/queue.rs — station board, claim_next, contention, crash recovery
           extended: app/src-tauri/src/verify.rs — delivery verification and criteria write-back
           extended: app/src/domain/queue.ts — same board/claim rules for the store and TaskView
TESTS MOVED: none

## 1. Files

- `app/src-tauri/src/queue.rs` — station count from app prefs (default 2). Board derived from `task` rows. `claim_next` is the only function that assigns a station. Occupying states: `running`, `waiting_dispatch`. `checking` / `done` / `failed` / `queued` do not occupy.
- `app/src-tauri/src/verify.rs` — for each `done_criteria` item, `{ text, met, evidence }`. Evidence from worktree git diff / untracked files, task log, delivery text. LLM proposal is optional and must resolve against that index. Empty evidence or "done" is unmet. All met → `done`; else stay `checking`. Write-back through `add_criterion` / `set_criterion_met`.
- `app/src-tauri/src/db.rs` — `list_all_tasks`, `get_wire`. Four core tables unchanged. No new migration.
- `app/src-tauri/src/dispatch.rs` — `start_dispatch` always writes `queued` with `station = None`. Exit 0 is still `checking`. `finish_process` verifies after exit 0. `done` is not a transition here.
- `app/src-tauri/src/commands.rs` — dispatch queues then `drain`s; spawned child on exit verifies then drains again. `list_tasks` recovers crashed `running` rows. `recover_and_drain` at startup.
- `app/src-tauri/src/lib.rs` — `mod queue` / `mod verify`; `recover_and_drain` after `AppState` is installed.
- `app/src/domain/queue.ts` + `queue.test.ts` — same claim/queue/contention rules driving `confirmDispatch`.
- `app/src/domain/dispatch.ts` — confirm goes queued then drain; `completeDemoTask` no longer flips every criterion (that was a fake fill).
- `app/src/hooks/useAppState.ts` — `station_count` from prefs; board derived from tasks; workspace reload when a task hits `checking`/`done`.
- `app/src/components/TaskView.tsx` + test — station rows, queue, failure isolated to the failed task, four fixed sections from the verification result.
- `app/src/components/PartPanel.test.tsx` — after verify-shaped criteria, evidence is visible and displayed fill is 40%.
- `app/src/index.css` — queue + summary + failure colour.

Not modified: `demo/`, `robot-v2.html`, `REPORT-round1.md`, `REPORT-round2-wp1.md`, `REPORT-round2-wp2.md`, `llm.rs`, `api.ts` (no new command), migrations, four core table columns. No commit, no push.

## 2. Final test summary lines

npm test:

```
 Test Files  12 passed (12)
      Tests  70 passed (70)
```

cargo test (`CARGO_TARGET_DIR=/tmp/tinman-target`):

```
test result: ok. 53 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 47.62s
```

`npx tsc --noEmit` exit 0.

## 3. Decisions

**D1 Station occupancy.** A station is held only by `running` and `waiting_dispatch`. `checking` does not occupy: if it did, a task whose criteria stay unmet would pin the station forever. After exit, `claim_next` can start the next runnable task while verification records run on the finished row.

**D2 `claim_next` is the only assigner.** `start_dispatch` writes `queued` / `station = None`. Production `dispatch_task` and the post-exit path both call `queue::drain` (a loop around `claim_next`). Interactive agents become `waiting_dispatch` when claimed (result_json.interactive), occupy a station, and do not spawn.

**D3 Dependency key (heuristic).** Two keys, either is enough to block:
1. `wire:<wire_id>` when the task targets a wire.
2. `risk:<normalized framework_advice.shared_risk>` — trim, lowercase, collapse whitespace. Ignored when empty, `none`/`n/a`/`-`/`无`, or the hand-fill sentence `与相邻部位共用约定…`.

A queued task is runnable unless another unfinished (`state != done`) task already holds an overlapping key. `failed` still holds the surface — the owner never finished, so dependents stay queued. Independent tasks keep draining.

This fails to catch: two phrasings of the same surface, shared files never named in `shared_risk`, two tasks on different wires that still edit the same crate.

**D4 Crash recovery → `failed`, not `queued`.** A `running` row means a child that died with the app. Re-queue would relaunch an agent on unknown leftover work. The row becomes `failed` with `result_json.error = "process did not survive app restart"` and `recovered: true`. Worktree kept. `waiting_dispatch` is left alone (no child was running). On open, checking rows are re-verified, then `drain` claims free stations.

**D5 Verification is grounded or unmet.** Sources: `git diff` / `git diff --cached` / `git ls-files --others` / `main...HEAD` in the worktree, the task log, delivery text. `git log --name-only -8` is *not* used — that would count `README.md` from `init` as evidence. A log line that is only "done"/"完成"/"all criteria met" is not evidence. LLM `verify_delivery` may propose a mapping; a proposal whose evidence reference is missing from the index is unmet. No LLM → deterministic match, rest unmet. Empty `done_criteria` stays `checking`.

**D6 Write-back.** Matching criterion text on the target wire is flipped through `set_criterion_met`; unknown text is `add_criterion` then set. Fill is `derived_progress` on read. `verify.rs` strips a `progress` key from `result_json` and never writes a fill number.

**D7 Per-task summary.** Stored on `result_json.summary` as try_it / built / checked / still_wrong, rendered in that order on finished tasks.

## 4. Criteria I could not demonstrate in a live window

I did not launch the Tauri app. C1–C5 are the named unit tests plus the TaskView/PartPanel render tests. Force-quit/reopen is simulated by `drop(conn); db::open(path)` and `recover_crashed`.

`StdProcessRunner` is still untested against a real OS process. Spawned-agent drain after exit is the command path; the suite uses `ScriptedRunner` and direct `claim_next`.

No pause button and no abandon button. Failure keeps the worktree (C2). Terminal takeover was WP2. Spec §9.3 also asked for pause / abandon-with-worktree-kept as user actions; those UI entries are not in this package.

## 5. Unsure, wrong first, or unverified

- First `c5_two_concurrent_tasks_have_independent_worktrees` used the harness's single `wire_id` for both tasks. `claim_next` treated them as the same surface and left the second queued. The test now uses `wire-a` / `wire-b`. Same-wire serialisation is the intended heuristic; the test was wrong, not the claim loop.
- First cargo compile failed because `Clock` was not in scope in `commands.rs` (`now_rfc3339` is a trait method).
- `completeDemoTask` previously marked every wire criterion met (a fake fill through the legal path). Nothing in the app called it. It now only moves the task to `checking` and drains. If something outside the repo depended on the old demo complete, that is gone.
- Default agents are still interactive stubs. Two of them occupy both default stations as `waiting_dispatch`; a third queues. A non-interactive agent with a program is what actually spawns.
- `mark_running` is unused in production after this change (`claim_next` sets `running`). Left in place; rustc warns.
- Part fill in the live UI after verify depends on the `task-state` handler reloading the workspace. That handler is untested in jsdom (no Tauri).
- `git diff --name-only HEAD` on a dirty worktree is used as evidence. A user who edits files unrelated to a criterion can accidentally ground that criterion if the path appears in the criterion text.

## 6. Brief items I think are slightly off

- Expected scope listed `RightPanel.tsx` and `api.ts`. The board is `TaskView`; recovery/claim live behind existing `list_tasks` / `dispatch_task` / prefs. New IPC would have been a second copy of `claim_next`.
- "mark it `running`" for every claim would launch interactive stubs. Interactive claimed tasks go to `waiting_dispatch` and occupy the station without a child.
- `checking` occupying a station until `done` would deadlock the board when criteria stay unmet. I let `checking` free the station. If you wanted verification to hold the slot, say so — but then unmet-checking needs a timeout or a user action to release it.
- Same-wire contention is stronger than shared_risk. Two tasks on one wire never run together, even with different `shared_risk`. That matches "公共部分只指派一个任务负责" if the wire *is* the shared surface; it is conservative if two tasks on one wire are actually independent slices.
