# REPORT-round5.md — 驻守层接进产品

Branch `rig/round5`. Round 4 built `autoMap` / `gaps` / `drift` / `patrol` and **wired none
of them**: a user opening the app saw exactly what they saw before. That was the defect
this round fixes. The gap is closed in the running product, not in the domain layer.

## What a user now experiences that they did not before

1. 添加文件夹 → 扫描 → **架构地图已经填好了**（槽位、线路、每条 3–6 项验收），底下一栏
   「仓库现在缺什么」用人话列出缺口。用户只点「确认架构地图」，一个字都不用打。
2. 没有 API key、模型返回垃圾、或调用直接抛错 —— 草稿照样是完整的，只是作者记成启发式。
3. 之后每 60 秒有一次巡检唤醒；到期的工作区自动重扫，不需要用户点任何东西。
   设置里有「定期重扫」开关，默认开，关掉后重启仍然是关的。

## Files changed and why

| File | Why |
|---|---|
| `app/src/hooks/useAppState.ts` | `addFolder` seeds a heuristic draft synchronously then calls `map_architecture` in the background; new store keys `mapDraftSource` / `gaps` / `patrolEnabled` / `setPatrolEnabled`; the 60s patrol effect. |
| `app/src/components/MapSheet.tsx` | Renders the gaps (filtered through `statesProgress`); a `touched` guard so a late model draft cannot overwrite the user's edits. |
| `app/src/components/RobotView.tsx` | Passes `gaps` through to the sheet. |
| `app/src/components/SettingsPanel.tsx` | 定期重扫 toggle. |
| `app/src/components/AppShell.tsx`, `app/src/index.css` | Wiring and styling for the above. |

## Verbatim test summary lines

Re-run by me after the final commit:
```
 Test Files  20 passed (20)
      Tests  176 passed (176)
```
`npx tsc --noEmit`: exit 0, no output. `cargo test`: `62 passed; 0 failed`.

## Key decisions

- **Heuristic first, model second.** The sheet's first paint is already a complete draft;
  the LLM upgrades it when it returns. Blocking the sheet on the LLM would also have passed
  the tests and would have been worse — it makes the key-less user wait for nothing.
- **One workspace per patrol wake, not the whole due set.** A fleet of 20 on this mount,
  where one scan took 41s, would otherwise become a 14-minute sequential pile-up inside a
  single callback. The 60s tick is a poll; `dueProjects` enforces the 30 min cadence.
- **The patrol yields to the user.** It skips the workspace whose map sheet is open and
  skips any tick where a visible scan is already running.
- **Rescan still cannot move a leg.** `applyDrift` only attaches findings. This is worth
  stating plainly against the original ask 「驻守重扫刷新短腿」: a rescan **cannot** change
  the short-leg ranking, because ranking is a function of met criteria and only evidence
  flips those. What the patrol refreshes is the *facts the judgement rests on*, plus drift
  findings saying the map may no longer match the repo. Anything else would be the invented
  progress the product exists to refuse.

## 不确定 / 一开始做错了 / 没有验证

- **没有在真实窗口里跑过。** Everything below the jsdom line is unverified: the settings
  checkbox, the gap copy as a human reads it, the toggle surviving a real restart, and
  whether the patrol is pleasant or annoying in a real session. This is the biggest gap
  in the round.
- **`INVARIANT: the sheet never prints a progress number` was misnamed by me.** It only ever
  asserted on gap strings, never on the sheet DOM. Renamed to
  `no gap string ever states a progress number`. Had it asserted on the sheet it would have
  failed on pre-existing intro copy (`…不是 0%`), for a reason predating this round.
- **`emptyProposal()` yields present slots with zero wires, so `submit()` accepts a blank
  sheet.** The "confirm with no typing" test would pass even without a draft. The test that
  actually requires `autoDraft` is "opens the map sheet already filled in". A confirmed-but-
  empty map is still legal in the product and is a real hole — `mapConfirmed: true` with no
  criteria means a permanently dark robot and a fake short leg. **Not fixed. Pre-existing.**
- **The 30 min `DEFAULT_PATROL_POLICY.intervalMs` is probably too aggressive** for a real
  fleet on a slow mount. It is what the spec advances 31 minutes against, so it stands.
  Raising it is one constant.
- **`gaps` leave the UI after confirm.** They are derived from the selected workspace's
  facts and only the map sheet reads them. They stay true afterwards and belong next to the
  short-leg ranking they are meant to explain — the part panel or the fleet row. The spec
  only required the sheet.
- **`mapDraftSource` is exposed but not rendered.** Telling the user who wrote the draft
  matters for trust, but on a sheet they are about to edit it is noise. It earns its place
  after confirm, or only when heuristic and model disagree.
- **Patrol records are cast loosely from prefs.** A corrupt prefs blob would be trusted;
  no schema check.
- **The agent's first fix for a harness bug was a global one.** It patched the shared `api`
  object in `setupTests.ts` to cover a missing `confirmMap: vi.fn()` in this round's own
  mock factory. It disclosed this clearly. I reverted it and fixed the factory; the suite is
  green without it. The lesson is mine: the prohibition glob covered `*.test.ts` but not
  test *infrastructure*.

## ASSUMED

- ASSUMED: 60s poll + one workspace per wake + 30 min policy cadence — because unbounded
  per-wake work is the actual hostility, not the poll frequency. Reversible by two constants.
- ASSUMED: gaps live on the map sheet this round — because that is what the spec required;
  the part panel is the better long-term home. Reversible, low cost.
- ASSUMED: patrol defaults to ON — because a resident agent the user must first discover and
  enable is not resident. Reversible by one initial value.

## Still not delivered (carried from round 4)

- **缺口4 验收清单的主人改成 agent** — the machine now drafts criteria at map time, but the
  task-card `done_criteria` loop still ends with evidence flipping boxes. Half-delivered by
  design; the other half is the verify path, not the map path.
- **缺口5 舰队级一个大脑** — untouched. No shared goal, no cross-project dependency
  (A 的右臂挡住 B 的左腿), still one LLM profile per workspace.
- **映射准确** — this round makes mapping automatic and continuously re-checked. It does not
  make it *correct*. `slotForModule` is a keyword table verified against fixtures, never
  against the user's real project set.
