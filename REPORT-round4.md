# Round 4 — memory-exhaustion hardening after the forced crash

Branch `hardening/memory-limits`. Nothing committed, nothing pushed.

The trigger for this round was a sudden forced crash of the running app, with no
saved logs. The question asked was whether the software has memory-leak-shaped
security risks. It does — or did: the whole child-output path was unbounded end
to end, and a dispatched agent CLI decides how much it writes.

The work was test-first, and an outside agent (grok-4.6, via the `outside-agent`
skill) audited the code independently before any fix and reviewed the patch
afterwards. Its two reports are the audit trail:

- `grok-audit-round1.md` — independent audit, findings N1–N10
- `grok-review-round2.md` — review of this patch

Both live in this session's scratchpad (not in the repo).

## What was actually wrong

The child-output path had no bound at any stage:

| # | Where | What it did |
|---|---|---|
| N1 | `runner.rs` reader threads | `BufReader::lines()` grew one `String` until a newline. A child writing a minified bundle, base64, binary, or a `\r` progress bar with no `\n` grew it until the process died. Release builds set `panic = "abort"`, so an allocation failure is not recoverable. |
| N1b | same | `map_while(Result::ok)` **stopped** the reader at the first non-UTF-8 byte; the pipe then filled and the child blocked forever. A hang, from the same input. |
| N2 | `runner.rs` channel | Unbounded `mpsc`. The consumer does a `create_dir_all` + open + append + close **and** an IPC emit per line, so a chatty child outran it and the queue grew at the child's pace. |
| N3 | `useAppState.ts` | `taskLines` appended forever, copying the whole array per line, and `RightPanel` re-joined the entire buffer into one string on every render. |
| N4 | `runner.rs` log file | `log.txt` had no rotation and no cap. A 4 GB dump became a 4 GB file, and the write failure was swallowed. |
| N5 | `verify.rs` | At child exit, the whole log was read **twice** (`collect_evidence` and `delivery_text`), and a matched log line was stored into SQLite and emitted to the UI **untruncated** — while delivery evidence had always been capped at 120 chars. |
| N6 | `useAppState.ts` | `loadTasks` read the full log of **every** task in the workspace, on open, on dispatch, and on every pause/resume/abandon. |
| N7 | `queue.rs` + UI | `station_count` had a floor of 1 and no ceiling. Each station is a child process, two reader threads and a pipe pair, plus a rendered card. |
| N8 | `llm.rs` | The HTTP client had a 45 s timeout but **no size limit**; `resp.text()` read a whole body. Request/response text was stored in the call log unbounded, and `list_llm_calls` had no `LIMIT`. |
| N9 | `runner.rs` | `kill()` removed the pid from the live map immediately and sent SIGTERM only. A child that ignores SIGTERM kept streaming while the UI showed the task paused and a new child took the freed station. |
| N10 | `gitutil.rs` | `Command::output` captured a full `git diff` into memory with no cap. |

The most likely cause of the observed crash is N1 or N2, not the front end.
I had ranked the front end first; the outside agent corrected that, and it was
right: the reader threads sit **upstream** of IPC, so the Rust process dies
before the webview has seen the bytes. N5 is the "died just as the agent
finished" variant.

## Bounds now enforced

| Bound | Value | Where |
|---|---|---|
| single line from a child | 64 KiB, remainder counted and dropped | `runner::BoundedLines` |
| reader → consumer queue | 128 pending lines ≈ 8 MiB at the line cap (`sync_channel`) | `runner::spawn_std` |
| `log.txt` | 32 MiB, rotated keeping the newest half | `runner::append_log_line` |
| `read_log` | last 4 MiB / 5000 lines, each clamped to 64 KiB | `runner::read_log` |
| log evidence in a verdict | 120 chars | `verify::EVIDENCE_SNIPPET_CHARS` |
| stations | 8 | `queue::MAX_STATION_COUNT`, `clampStationCount`, `max=` on both inputs |
| LLM response body | 1 MiB | `llm::read_body_capped` |
| call-log columns / query | 32 KiB each / `LIMIT 200` | `llm::clamp_logged`, `db::list_llm_calls` |
| git stdout / stderr | 8 MiB / 64 KiB, enforced **while reading the pipe** | `gitutil::read_capped` |
| UI lines per task | 5000, each 8 KiB | `logBuffer::appendTaskLine` |
| terminal render | 256 KiB per render | `logBuffer::renderLogText` |
| log preloads on open | 8 tasks, rest fetched on select | `logBuffer::MAX_PRELOADED_LOGS` |

Two things that are deliberately *not* bounds: the agent's worktree on disk
(that is the agent's workspace, by design), and the scanner's per-repo vectors
(bounded by repo size, already capped at `CONTENT_MAX`/`MARKER_CAP`/`TREE_CAP`,
and not on the child-output path).

## Tests

Every fix has a test that fails on the old code. The load-bearing ones exercise
a **real child process through a real pipe**, not a stub:

- `real_child_dumping_without_newlines_stays_bounded` — `sh -c "head -c 3000000
  /dev/zero | tr '\0' 'a'"`; asserts no single line and no total exceeds the cap.
  This is the crash path, reproduced.
- `real_child_line_flood_arrives_complete_and_in_order_under_backpressure` —
  3072 lines with a deliberately slow consumer; asserts nothing is lost or
  reordered and the bounded channel does not deadlock.
- `bounded_lines_survives_invalid_utf8_instead_of_stopping` — the hang.
- `read_log_returns_a_bounded_tail`, `read_log_clamps_a_single_huge_line`,
  `read_log_of_one_line_longer_than_the_tail_window_is_not_empty`.
- `append_log_line_rotates_instead_of_growing_forever`.
- `child_registration_survives_kill_and_ends_with_the_guard`.
- `log_evidence_is_stored_as_a_snippet_not_a_whole_line`.
- `station_count_is_clamped_to_the_ceiling`; `response_body_is_capped_and_says_so`;
  `call_log_text_is_clamped_on_both_sides`; `git_output_is_capped`.
- Front end: `logBuffer.test.ts`, `renderBudget.test.ts`,
  `useAppState.logbound.test.tsx` (wiring, not just the helper),
  `useAppState.logload.test.tsx` (fan-out cap + lazy fetch on select).

### Verbatim test summaries

Rust baseline before the round:

    test result: ok. 60 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

Rust after:

    test result: ok. 80 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

Front-end baseline before the round:

    Test Files  1 failed | 16 passed (17)
         Tests  4 failed | 128 passed (132)

Front end after: PENDING — filled in below.

## What the outside agent's patch review changed

grok reviewed the patch and found five real defects. All five are fixed, each
with a test. Two of them mattered:

- **D1 — my git cap was a lie.** `clamp_git_output` ran *after*
  `Command::output()` had already allocated the entire diff. The bound was in
  the wrong place, so N10 was not actually fixed and a large enough diff would
  still have aborted the process. `gitutil::git` now pipes stdout and stderr,
  reads each through a cap, and keeps draining so git is never blocked on a full
  pipe. The new test drives a **real git process**, not a `Vec` I already own —
  which is precisely the hole the old test papered over.
- **D3 — I opened a hole while fixing N9.** `ChildGuard` unregistered by task id
  alone, and my new "only SIGKILL if the pid is still registered" check turned
  that into a miss: on pause-then-resume, a second child registers, the first
  guard's drop erases the *second* child's pid, and the old process never gets
  SIGKILLed. Fixed by storing the pid on the guard and unregistering only when
  it still matches, plus `spawn_tracked` now refuses to start a second child for
  a task that already has a live one.
- **D2** — rotation truncated in place, so a failure (disk full is exactly when
  a 32 MiB log happens) or a concurrent pause hint could leave the task with an
  empty or torn log. Now writes a sibling, `sync_all`, and renames; all log
  writers serialize on one lock.
- **D4** — `confirmDispatch` stored an IPC log without `capTaskLines`; the one
  path of four that bypassed the 8 KiB clamp.
- **D5** — `clampLineText` could slice between the halves of a surrogate pair.

It also resolved one thing in my favour that it could not verify itself: I
checked reqwest 0.12.28's source, and blocking `Response: Read` streams from the
async body rather than buffering it, so the 1 MiB body cap is genuine.

And it lowered `CHANNEL_CAPACITY` from 512 to 128: 512 lines at the 64 KiB line
cap is a 32 MiB worst case, which is a line count masquerading as a byte bound.
128 keeps it near the ~8 MiB the audit asked for.

## Key decisions

- **Backpressure over dropping.** When the queue is full the reader blocks, the
  OS pipe fills, and the child stops writing. The alternative (drop lines and
  count them) loses output the user may need to explain a failure. The audit
  suggested also coalescing IPC emits into batches; I did not, because
  backpressure alone makes the path bounded and batching changes the streaming
  behaviour the UI depends on. That remains available if the terminal feels slow.
- **Truncate visibly, never silently.** Every cap leaves a marker in the text
  (`[line truncated, N more bytes dropped]`, `[log rotated: …]`, `[N earlier
  output lines not shown — full log is on disk]`). A truncated body that looks
  complete is worse than an obviously truncated one.
- **The log file stays the full record** (up to 32 MiB) — the caps are on what
  is held in memory, not on what is written.
- **Escalation is tied to our own bookkeeping.** SIGTERM, then SIGKILL after 2 s,
  but only if that task's pid is *still registered*, i.e. not yet reaped. That
  closes the pid-reuse window rather than blind-killing a raw pid.

## What was unsure, wrong at first, or not verified

- **I mis-ranked the findings.** I had the webview dying first and would have
  wired the UI cap and shipped; a `cat` of a minified bundle would still have
  aborted the process. The outside agent caught this. Fixing the reader was the
  actual answer.
- **I would have missed the UTF-8 hang** (`map_while(Result::ok)`) entirely.
- **My first `read_tail` had a regression I only found because I wrote a test for
  the case I doubted:** a log holding one record longer than the tail window read
  back as *empty*, because dropping the partial first record consumed everything.
  Test `read_log_of_one_line_longer_than_the_tail_window_is_not_empty` failed,
  and the drain rule now keeps the record when dropping it would leave nothing.
- **No crash logs exist.** The ranking of N1 vs N2 vs N3 is a reasoned
  trigger-split, not a measurement. I cannot prove which one killed the app.
- **Not measured:** IPC emit cost versus the array copy. The argument is
  complexity, not a benchmark.
- **Not verified:** whether Tauri/wry queues event payloads unboundedly when JS
  is blocked. If it does, N2 fills faster than modelled. Unread.
- **Not verified in a real window.** Everything here is test-verified. Nobody has
  run the desktop app and watched a chatty agent for an hour with these caps in
  place. The caps' *values* (64 KiB, 512, 5000, 8) are judgement, not tuning.
- **Still not bounded (known, accepted, from the review):** `delivery_text` joins
  the 4 MiB tail rather than passing a tail plus a byte count; `collect_evidence`
  holds 5000 strings and lowercases each; `taskLines` never evicts a task key
  once selected; call-log rows written *before* this patch still load at whatever
  size they were stored; `LIMIT 200` rather than the 50 the audit suggested.
  All are bounded now, just not tightly. None is on the child-stdout path.
- **A runaway child process** can still exhaust the machine on its own without
  Tinman copying a byte. Out of scope, not fixed, not ruled out as the cause.
- **My own test papered over D1.** `git_output_is_capped` tested the clamp helper
  on a `Vec` that already existed, which is exactly the shape of test that cannot
  catch "the allocation happened before the clamp". The lesson generalises: a
  bound test that does not drive the real producer proves nothing about the
  bound. The two `real_child_*` tests and the new real-git test are the ones with
  actual evidential weight.
- **N9 partly fixed.** The kill path no longer lies and escalates safely, but the
  station is still freed and the next task drained without waiting for the old
  `spawn_blocking` to exit. So briefly more than `station_count` children can be
  alive. Bounded by the ceiling of 8, not by 1.
- **The 4 pre-existing front-end failures** in `AppShell.layout.test.tsx` were
  already failing at the start of this round, from unrelated uncommitted DeepSeek
  work (a half-finished `sendComposer`). Untouched, out of scope, still failing.

## ASSUMED

- ASSUMED: every finding was worth fixing, not just the top three, because all
  ten are unbounded-growth paths and the user asked for prioritised fixes.
  Reversible by reverting individual hunks; each is independent.
- ASSUMED: the caps above are right for a desktop workbench watching agent
  output. Because they keep a full-rate agent's worst case in the tens of MiB
  while leaving a normal run untouched. Reversible by editing one constant each —
  they are all named constants, in one place per language.
- ASSUMED: bounding memory is worth losing the very oldest UI output on a long
  run. Because the log file keeps everything and the UI says what it dropped.
  Reversible by raising `TASK_LINE_CAP`.
- ASSUMED: `loadTasks` fetching only 8 logs plus lazy-fetch-on-select is
  acceptable, because selecting a task now fetches its log. Reversible by
  raising `MAX_PRELOADED_LOGS`.
