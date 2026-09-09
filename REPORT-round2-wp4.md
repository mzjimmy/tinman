CRITERIA:  C1 met — pause SIGTERM + free station (queue::tests::pause_frees_or_holds_its_station, c1_pause_resume_round_trip); abandon keeps worktree (queue::tests::abandon_keeps_worktree_on_disk; TaskView 放弃并保留 worktree does not call removeWorktree); takeover shows path+command (RightPanel terminal + 手动接管)
           C2 met — composer lists llm_profiles and setLlmProfile writes workspace.llm_profile_id; empty state is 未配置模型 + 配置模型, no Extra High Fast; 工位数 input defaults to 2 and calls setStationCount (prefs persist)
           C3 met — acceptance.test.tsx c3_blocked_part_pulses_in_robot_view (.unit.blocked) and c3_blocked_part_pulses_in_fleet_card (.fleet-card.blocked-card); both animations are blocked-pulse from deriveProject.hasBlocked / part.status
           C4 met — c4_offline_shell_renders_without_error_banner: AppShell + fixture store, no throw, no .error-banner, robot/fleet/task render, LLM 未选择模型 / 未配置模型
           C5 met — c5_stylesheet_drops_to_two_columns_at_1024_without_hiding_the_right_bar (1fr 200px, no .right-bar display:none); c5_robot_svg_preserves_aspect_ratio (xMidYMid meet). Not a real 1024px window
           C6 met — app/src/acceptance.test.tsx one describe per §12 item; named tests plus file:name references; comments for item 3 (human study) and the uncheckable parts of 1 and 12
ACCEPTANCE:1 covered by scanner.rs::scan_this_repo_is_read_only_and_populated, scan_100k_line_repo_under_10s (synthetic tree), MapSheet.test.tsx, RobotSvg fill after confirm. Live add-folder <10s in a window is not asserted
           2 covered by RobotSvg.test.tsx::renders all-dark robot with notice and no progress figures; progress.test.ts unconfirmed displayProgress 0
           3 not covered — human study (three people, five projects, 15s). shortLeg.test.ts ranking formula only
           4 covered by domain/dispatch.test.ts::c1_three_clicks_from_ranking_to_dispatch
           5 covered by PartPanel five-field render + new clickable fact-cite on a path from part.facts.files. Was broken (plain <dd> text) before this package
           6 covered by llm.rs c4_gate_rejects_fenced_code / c4_gate_rejects_percentage / c4_gate_rejects_progress_fraction
           7 covered by verify.rs::c5_two_concurrent_tasks_have_independent_worktrees
           8 covered by verify.rs::c4_part_fill_rises_by_the_met_ratio_after_write_back and PartPanel evidence/40% test
           9 covered by c3_blocked_part_pulses_in_robot_view and c3_blocked_part_pulses_in_fleet_card
           10 covered by queue.rs::c5_task_left_running_by_a_crash_is_recovered_not_left_running and c5_stations_and_queue_rebuild_from_the_database
           11 covered by c4_offline_shell_renders_without_error_banner (fixture store, jsdom, isTauri false)
           12 covered by stylesheet 1024px block + svg preserveAspectRatio. Real window not asserted
BASELINE:  npm 70 passed / cargo 53 passed
AFTER:     Test Files  13 passed (13)
           Tests  99 passed (99)
           test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 40.85s
INVARIANT: raw-SQL progress column still ignored on read: yes
           no code path sets progress directly: yes
           llm.rs gate tests still green: yes
           abandon keeps the worktree: yes
FILES:     app/src/acceptance.test.tsx
           app/src/components/SettingsPanel.tsx
           app/src/components/AppShell.tsx
           app/src/components/TaskView.tsx
           app/src/components/PartPanel.tsx
           app/src/hooks/useAppState.ts
           app/src/lib/api.ts
           app/src/lib/mapWorkspace.ts
           app/src/domain/types.ts
           app/src/domain/queue.ts
           app/src/domain/queue.test.ts
           app/src/domain/fixtures.ts
           app/src/index.css
           app/src-tauri/src/queue.rs
           app/src-tauri/src/commands.rs
           app/src-tauri/src/lib.rs
           app/src-tauri/src/runner.rs
           app/src-tauri/src/dispatch.rs
           app/src-tauri/src/db.rs
           REPORT-round2-wp4.md
SCOPE:     extended: app/src-tauri/src/queue.rs — paused/abandoned transitions; pause frees station; abandon keeps worktree
           extended: app/src-tauri/src/runner.rs — LiveChildren PID registry + SIGTERM
           extended: app/src-tauri/src/commands.rs — pause_task / resume_task / abandon_task
           extended: app/src/components/SettingsPanel.tsx — profiles + station count + theme behind the gear
           extended: app/src/acceptance.test.tsx — C6 sweep
TESTS MOVED: none

## 1. Files

- `app/src/acceptance.test.tsx` — C6 sweep: one describe per §12 item. References existing tests by file and name. Direct tests for C1–C5 names, clickable citation, READY/eyes/ready-pop.
- `app/src/components/SettingsPanel.tsx` — gear panel: station count, add profile (id/kind/base URL/model/key_ref/password), theme. Password is local and cleared on save; list never shows a secret.
- `app/src/components/AppShell.tsx` — composer selector binds workspace profile; empty state 未配置模型; gear opens settings.
- `app/src/components/TaskView.tsx` — pause (honest label), 手动接管, 放弃并保留 worktree; paused/abandoned cards; 删除 worktree is a separate button on abandoned rows.
- `app/src/components/PartPanel.tsx` — diagnosis wraps fact paths from `part.facts.files` in a `fact-cite` button.
- `app/src/hooks/useAppState.ts` — profiles from prefs; setLlmProfile → set_workspace_llm_profile; pause/resume/abandon/takeOver/removeWorktree; station_count already persisted.
- `app/src/lib/api.ts` — pause_task / resume_task / abandon_task; profilesFromPrefs.
- `app/src/lib/mapWorkspace.ts` — llmProfileId from workspace.
- `app/src/domain/types.ts` — TaskState + paused/abandoned; LlmProfile; Project.llmProfileId.
- `app/src/domain/queue.ts` — pauseTask/resumeTask/abandonTask; abandoned releases contention like done; paused does not occupy a station.
- `app/src/domain/queue.test.ts` — TS pause/resume/abandon.
- `app/src/domain/fixtures.ts` — makePart accepts facts.
- `app/src/index.css` — fact-cite, settings overlay, pause-note. No palette/layout redesign.
- `app/src-tauri/src/queue.rs` — pause/resume/abandon; tests named in the brief.
- `app/src-tauri/src/commands.rs` — three commands; kill PID after the row is paused/abandoned; drain; do not call worktree::remove on abandon.
- `app/src-tauri/src/lib.rs` — register commands; LiveChildren on AppState.
- `app/src-tauri/src/runner.rs` — LiveChildren + spawn_tracked.
- `app/src-tauri/src/dispatch.rs` — apply_exit / apply_spawn_failure leave paused and abandoned rows alone.
- `app/src-tauri/src/db.rs` — round-trip also covers paused and abandoned. Four core tables unchanged.

Not modified: `demo/`, `robot-v2.html`, other REPORT-*.md, migrations, four core table columns. No commit, no push.

## 2. Final test summary lines

npm test:

```
 Test Files  13 passed (13)
      Tests  99 passed (99)
```

cargo test (`CARGO_TARGET_DIR=/tmp/tinman-target`):

```
test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 40.85s
```

`npx tsc --noEmit` exit 0.

## 3. Decisions

**D1 Pause stops the process.** A running child is sent SIGTERM via `LiveChildren` (task id → pid). The row becomes `paused`, `station = None`. Resume writes `queued` and `drain` may claim it again — a new process, not a continued one. The running-state button is labelled `暂停进程并释放工位`. `waiting_dispatch` / `queued` have no child; the button is `暂停并释放工位`. A paused task whose agent was still writing would be a lie; that is why pause kills first in the command after the row is committed, and `apply_exit` refuses to overwrite `paused`/`abandoned`.

**D2 Pause frees the station.** Same shape as WP3's `checking` decision. `occupies_station` is still only `running` | `waiting_dispatch`. `pause_frees_or_holds_its_station` asserts a queued neighbour is claimed.

**D3 Abandon keeps the worktree.** State `abandoned`, station cleared, `result_json.abandoned` + `worktree_kept`. `abandon_task` never calls `worktree::remove`. The only remove path remains `remove_worktree`. UI: 放弃并保留 worktree vs 删除 worktree on the abandoned card.

**D4 Contention.** `abandoned` releases the shared surface (like `done`). `paused` holds it (like `failed`) so a neighbour on the same wire does not start while the user is paused.

**D5 Selector.** `llm_profiles` in app prefs; composer options are real profiles; change calls `set_workspace_llm_profile`. Zero profiles: `未配置模型` + `配置模型`, no Extra High Fast / Local stub.

## 4. Acceptance items already broken (found, then fixed or documented)

- **Item 5 clickable citation.** Five fields rendered; diagnosis was a plain `<dd>`. No clickable fact. Added `fact-cite` wrapping paths from `part.facts.files`.
- **Item 11 / C2 empty selector.** Composer offered Extra High Fast / Local stub and wrote only local state. That is the decorative-selector failure the brief named. Removed.
- **Item 9 class names.** Robot pulses via `.unit.blocked`; Fleet via `.fleet-card.blocked-card`. Same `@keyframes blocked-pulse`, same derived blocked state, two class names. Left as-is; both asserted.

Not broken, already present: unconfirmed dark robot, three-click path, gate, independent worktrees, fill-by-criteria, crash recovery, station count input (WP3 TaskView), READY/eyes/ready-pop, 1024px CSS, preserveAspectRatio.

## 5. Criteria I could not demonstrate in a live window

Did not launch the Tauri app. C1 process-kill is the PID registry + state machine; `StdProcessRunner::spawn_tracked` is not run against a real `sleep` in the suite. C4 is `AppShell` with a fixture store (jsdom, `isTauri()` false). Bootstrapping `useAppState()` with zero workspaces would show the empty-folder prompt, not a robot — the brief asked for robot/fleet/task to work, so the store has `rankingProject()`. C5 is the stylesheet text + SVG attribute, not a 1024px window. Round 1 already said it never verified that in a real window; this package does not claim it either.

Item 1's 10s bound after adding a folder in the UI is not asserted. `scan_100k_line_repo_under_10s` times a synthetic tree; `scan_this_repo_is_read_only_and_populated` has no wall-clock bound because this checkout is on a virtualised mount.

## 6. Unsure, wrong first, or unverified

- First `apply_exit` guard was `state != "running"` → skip. That broke `queue::tests::c2_failed_task_keeps_its_worktree`, which calls `apply_exit` on a still-`queued` row from `start_dispatch`. Did not edit the test. Narrowed the guard to `paused` | `abandoned` only.
- Interactive default agents still become `waiting_dispatch` with no child. Pause then has nothing to SIGTERM; the label does not say 暂停进程.
- `takeOver` pauses then opens the terminal. A human who wanted the agent to keep writing while they watch would be stopped. Spec said 打开终端手动接管; stopping the child is the non-lying version.
- Settings password field exists; no test types a secret and asserts it is absent from the profile list. The list renders `key_ref`, never the secret.
- `ProcessRunner` trait is unused in the non-test lib after `spawn_claimed` switched to `spawn_tracked`. Tests still use `ScriptedRunner`. Warning only.

## 7. Brief items that were slightly off

- Expected scope listed `RightPanel.tsx`. Worktree path and command were already there (WP2). The missing UI was pause/abandon/takeover on the station card. RightPanel was not rewritten.
- Station count was already an editable input on TaskView (WP3) with `setStationCount` → app prefs. This package added the same control in Settings and pinned it with `c2_station_count_defaults_to_two_and_persists`.
- "Mount AppShell with the Tauri bridge absent" plus "the robot and the fleet ranking render" cannot both use a raw `useAppState()` boot: that hook starts with `projects = []`. The C4 test feeds a fixture store.
