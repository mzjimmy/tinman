# REPORT-round4.md — 自动架构草稿 + 驻守重扫

Branch `rig/round4`. Round 4 targets the two gaps named as the watershed between
"专家确认工具" and "小白判断辅助": **自动架构草稿** and **驻守重扫刷新短腿**.

## What this round does and does not claim

It delivers the **domain layer** for gaps 1–3 of the五点清单. It does **not** wire any
of it into the UI — no component, no `useAppState.ts`, calls these modules yet. A user
running the app today sees exactly what they saw before. That wiring is round 5, and
saying otherwise would be the "invented progress" this product refuses.

## Files changed and why

| File | Why |
|---|---|
| NEW `app/src/domain/autoMap.ts` | 缺口1. `heuristicProposal` drafts all 7 slots from facts; `sanitizeLlmProposal` turns `map_architecture` output into data, not authority; `autoDraft` prefers the model and falls back to the heuristic. |
| NEW `app/src/domain/gaps.ts` | 缺口2. Facts → 人话缺口 with evidence. `statesProgress()` is the guard. |
| NEW `app/src/domain/drift.ts` | 缺口3a. Confirmed map re-checked against fresh facts; advisory only. |
| NEW `app/src/domain/patrol.ts` | 缺口3b. Cross-project rescan scheduling, stalest-first, backoff. |
| EDIT `app/src-tauri/src/llm.rs` | `validate_map_architecture` replaces the `_ =>` passthrough. |
| EDIT `app/src/domain/types.ts` | `driftFindings` declared on `Project` so consumers can typecheck. |

## Verbatim test summary lines

All three re-run by me after the final commit, not quoted from an agent report.

Front-end (`npx vitest run`, from a local-disk copy):
```
 Test Files  19 passed (19)
      Tests  163 passed (163)
   Duration  1.83s
```
Baseline entering the round was `15 passed (15)` / `115 passed (115)`. The 48 new tests
are the round-4 specs.

Type check (`npx tsc --noEmit`): exit 0, no output.

Rust (`CARGO_TARGET_DIR=/tmp/tinman-target cargo test`):
```
test result: ok. 62 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```
Baseline entering the round was 56 passed. The 6 new tests are the `r4_*` gate tests.

## How the work was done

Two delegation rounds to an outside agent (grok-4.6), tests-first:

| Round | Dispatched | Result |
|---|---|---|
| 1 | 4 TS suites + 6 Rust tests, red | green on first attempt; **5 defects found afterwards by reading the diff** |
| 2 | those 5 defects, each reproduced as a failing test | all 5 fixed, scope clean |

Round-1 defects, none of which the green suite caught:
1. `autoDraft` credited `source: 'llm'` when the model returned nothing usable — the
   product would have told the user a model drafted what the heuristic drafted.
2. `src/` and `app/` mapped to no slot — the two commonest top-level directories.
3. A stale wire was raised once per (hot file x wire) — one reworked module printed the
   same sentence four times.
4. A registration page was reported as `有登录页文件` — the sentence contradicted its
   own citation.
5. `driftFindings` was stored on an undeclared property, so no consumer could typecheck
   against it.

The agent was right twice against me and both pushbacks were adopted: it argued the
`src/` abstention fought the generous-draft purpose (**my test was the thing at fault**,
and I rewrote it), and it noted `applyDrift` had no test proving it stores anything, so a
no-op would have satisfied the whole suite. It also disclosed that one branch of its own
`src/` rule was unasserted by my test; I closed that myself rather than spend a round.

## Key decisions

- **Tests were written before the implementation and by a different party than the
  implementer.** The implementation was delegated to an outside agent (grok) which was
  explicitly forbidden from editing any test or fixture. Scope compliance was checked
  mechanically, not taken from its report.
- **The heuristic is the floor, the model is the topping.** `autoDraft` always computes
  the heuristic proposal first and merges sanitized model output onto it. An unavailable,
  offline, or gated LLM degrades to a complete draft rather than to a blank sheet. This is
  what makes 缺口1 real rather than conditional on an API key.
- **Two validation layers on purpose.** Rust rejects a malformed `map_architecture`
  response outright (gate); TypeScript drops the bad part and keeps the rest (draft).
  They must not be "harmonised" in round 5.
- **Drift is structurally incapable of moving a leg.** `applyDrift` attaches findings and
  nothing else; a test asserts met-flags and part progress are byte-identical before and
  after. Rescan still cannot change the robot — as designed.
- **Criteria drafted by the machine are always born unmet, with empty evidence**, in both
  languages. 缺口4 (agent owns the checklist) is deliberately only half-delivered: the
  agent may now *draft* the checklist, but only evidence flips a box.

## 不确定 / 一开始做错了 / 没有验证

- **没有在真实窗口里跑过。** Domain + Rust only. Zero UI verification. The Chinese
  sentences are accepted by tests, not by a person who cannot read code.
- **没有在真实多项目仓库上验证映射质量。** `slotForModule` is a keyword table. It is
  verified against fixtures, not against the user's actual project set. 「映射准确」
  remains a product assumption, exactly as the intake analysis said — this round makes
  the mapping *automatic*, not *correct*.
- **`wire_stale` 信号偏弱。** It keys off `git.top_files_30d` overlapping a part's modules.
  Heavy commits to a file do not mean its acceptance criteria are wrong. The copy is
  phrased as a prompt ("可能过时"), not a verdict. Known limitation, not fixed.
- **`登录页 ⇒ 需要注册接口` 是产品假设，不是仓库事实。** An SSO-only app will show this
  gap forever. Known false-positive class; the fix is a per-project mute, which is UI work.
- **Round 1 went green on the first attempt with no red-green cycle after the files
  landed.** That is the tests being tight plus luck, not proof every case was anticipated.
  Five defects were found afterwards by reading the diff, not by the suite.
- **Patrol has no driver.** The scheduling logic is tested; nothing calls it on a timer.
  There is still no resident process. 缺口3 is half-delivered by design.
- **缺口5 (舰队级一个大脑) is untouched.** Out of scope by the intake's own dependency order.

## ASSUMED lines

- ASSUMED: round 4 stops at the domain+Rust layer with no UI wiring — because the intake
  named 自动架构草稿 + 驻守重扫 as the watershed and the pure logic is what tests can pin
  down. Reversible by a round-5 brief wiring `useAppState`/`MapSheet`.
- ASSUMED: an in-app interval patrol rather than an OS watcher/daemon — because a Tauri app
  already owns an event loop. Reversible by swapping the driver; the pure logic is unchanged.
- ASSUMED: 缺口4 and 缺口5 deferred — because the intake ordered them after 1–3 and said
  without 1 and 2 the rest drifts.
- ASSUMED: `DEFAULT_PATROL_POLICY` = 30 min interval, 8 h max backoff — arbitrary defaults.
  Reversible by one constant; the backoff math does not care.
