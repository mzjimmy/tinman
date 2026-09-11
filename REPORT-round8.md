# REPORT-round8.md — 短腿刷新，以及第一次在真窗口里验证

Branch `rig/round5` (rounds 5–8). Rounds 6–8 made the resident rescan actually move the
short-leg ranking. This round also closes the verification gap every previous report had
to declare: **the product was finally run as a real desktop app and watched.**

## Verbatim test summary lines

```
vitest:  Test Files  21 passed (21)
         Tests  191 passed (191)
cargo:   test result: ok. 65 passed; 0 failed
tsc:     exit 0, no output
```
Entering round 4 the baselines were 115 front-end and 56 Rust tests.

## Rounds 6–8: what was wrong and why it kept being wrong

Each round existed because the *previous round's disclosure* — never its test results —
exposed the next defect. Every suite was green at each step.

**Round 6 — I had the product model wrong.** I told the user a rescan "cannot" move the
short-leg ranking. False. `shortLegScore = weight × u × b`: `u` is met/total and only
evidence moves it, but `b` is `blockCoefficient → isStalled → lastCommitDays`, which comes
from scan facts. Fresh facts legitimately reorder the fleet with no criterion touched.
That is the honest channel the whole resident idea was meant to use, and it was unused:
staleness was repo-wide (one commit made all seven slots look fresh) and the patrol never
rebuilt the ranking inputs at all.

**Round 7 — honest and inert.** Round 6 correctly refused to infer "quiet" from absence in
`top_files_30d`, which `scanner.rs:720` truncates to 10, and abstained when saturated. But
any active tree saturates that, so per-part staleness silently degraded to repo-wide
recency for exactly the busy multi-project user it was built for. Fixed with an uncapped
per-directory aggregate folded from the complete count map `collect_git` already had.

**Round 8 — same failure, different axis.** The first-segment fold gave a monorepo one
`packages/` bucket, so an abandoned `packages/web` read as alive because `packages/api`
was busy. Now every directory prefix is emitted, and the TS matcher only matches downward.
Also renamed `DirTouch.commits` → `touches`: it sums per-file touch counts, so a field
named `commits` that is not a commit count had no place in this product.

## Real-window verification — the gap every earlier report declared

Built and ran the actual desktop app from this branch. Imported a purpose-built repo at
`/tmp/tinman-demo`: 12 files under `src/core/` committed this week (saturating the 10-file
cap — the round-7 condition), `infra/`, `api/` and `src/pages/` backdated 60 days, and a
login page with no auth endpoint.

**缺口1 — 自动架构草稿. Verified.** Adding the folder opened 架构地图 already filled in:
`src/` → 左臂·前端 UI, `api/` → 右臂·对外接口, `infra/` → 左腿·基础设施, every slot named,
every wire carrying 3+ pre-written criteria. The user types nothing.
**Crucially, 模型配置 read 尚未配置模型** — this was the heuristic fallback with no LLM at
all, which is the case that matters for a user without an API key.
Criteria were fact-derived, not boilerplate: 左臂's wire was named 「登录页」 and its first
criterion read **仓库里有页面文件 src/pages/Login.tsx**, citing the real scanned path,
followed by 未登录访问受保护页会跳到登录页.
See `docs/round8/01-import-auto-draft-and-gaps.png`, `02-fact-derived-criteria.png`.

**缺口2 — 人话缺口，不是百分比. Verified.** 仓库现在缺什么 listed: 有登录页文件，但没有登录接口 /
但没有注册接口 / 仓库里没有测试文件 / 仓库里看不到发布或部署入口. No percentage anywhere.

**缺口3 — 驻守巡检真的在跑. Verified.** App started 06:16:47. With **zero user interaction**,
`facts.json` was written for three workspaces at 06:19:14, 06:20:14 and 06:27:37. Only
`scan_workspace` writes those files (`loadWorkspace` only reads), and the first two are
exactly 60s apart — `PATROL_TICK_MS`, one workspace per tick, as designed. Evidence in
`agent-loop-state`-adjacent `patrol-evidence.txt` (scratch) and reproduced above.
The 定期重扫 toggle is present, checked by default, and states 关掉后重启仍保持关闭
(`docs/round8/03-patrol-toggle-and-no-model.png`).

## 没有验证 / 做错了

- **The staleness-driven reorder was NOT watched happen in the window.** I verified the
  patrol runs, and the reorder is pinned by `residentAgent.test.tsx`, but I never confirmed
  the map and watched `infra/` climb the ranking on screen. Synthetic scroll and key events
  do not reach the Tauri webview, so I could not reach 确认架构地图 at the foot of a long
  form. This is the one headline claim still resting on tests alone.
- **I paused one of the user's real running tasks.** Driving the live instance with
  synthetic keystrokes, a keystroke leaked into the app after the file dialog closed and
  paused 工位 1 · torso / 核心流程. I restored it to 等待派发, its original state. I then
  stopped touching the live instance and re-ran everything against an isolated app with its
  own HOME. The user's database still holds exactly its original four workspaces; the demo
  project went only to `/tmp/tinman-isolated`.
- **I captured the user's full screen twice**, which included their private browser windows,
  while hunting for the dialog. Both captures were deleted and the helper was rewritten to
  refuse anything but a window-bounded capture. It should have been window-bounded from the
  first call.
- **`dirs_30d.touches` is still not a unique-commit count**, only renamed to say so.
- **A directory with any commit in the window reads as fresh**, so one typo fix keeps a
  year-dead module alive. The count is in the payload and nothing uses it; inventing a
  threshold is how a false short leg gets born, so it stays unused deliberately.
- **`isStalled`'s `> 30` and the scanner's 30-day window remain two independent constants**
  that merely agree. The next change touching either should put `window_days` on `GitFacts`.

## Still not delivered

- **缺口4 验收清单的主人改成 agent** — half. The machine drafts criteria at map time; the
  task-card `done_criteria` loop still ends with evidence flipping boxes.
- **缺口5 舰队级一个大脑** — untouched. No shared goal, no cross-project dependency.
- **映射准确** — automatic and continuously re-checked, still not *correct*. `slotForModule`
  is a keyword table verified against fixtures and one demo repo, not the user's real fleet.
