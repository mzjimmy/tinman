# ASSUMPTIONS

- ASSUMED: Backpack slot geometry is a small rounded rect centered above the torso (y=58, width `18 + weight*4`) — because `robot-v2.html` has 6 slots and no backpack; MD requires 7 fixed slots. Reversible by adjusting `layoutV2` in `src/robot/geometry.ts`.

- ASSUMED: Unmapped slots still reserve ghost outlines with dashed stroke — because MD overrides HTML "缺的不画". Reversible by hiding ghosts in `RobotSvg`.

- ASSUMED: **客户端 SDK** starts with `mapConfirmed: false` — because brief requires at least one unconfirmed project; others stay confirmed for Fleet ranking. Reversible in `demoData.ts`.

- ASSUMED: 5th Demo project is **观测平台** with a mapped **backpack** part — because brief requires ≥5 projects and a backpack example. Reversible in `demoData.ts`.

- ASSUMED: Wire/part progress uses equal weight per wire within a part — because MD does not specify per-wire weights. Reversible in `partProgress()`.

- ASSUMED: Stalled coefficient uses max `lastCommitDays` across wires on a part — because MD mentions ">30 days no related commit" without wire-level detail. Reversible in `isStalled()`.

- ASSUMED: `planned_start` on **观测平台 · 导出 API** is `2026-12-01` — to demonstrate exclusion from ranking. Reversible in `demoData.ts`.

- ASSUMED: Default view is **Fleet** — so ranking is visible on first load. Reversible in `createSeedState()`.

- ASSUMED: Default theme is **dark** via seed state; light available via toggle — because MD §6 says dark default. Reversible in `createSeedState()` / CSS.

- ASSUMED: Right bar hidden below 1024px width; layout becomes two columns — per MD §12.12 responsive note. Reversible in `index.css`.

- ASSUMED: Task IDs start at `t_0142` — to align with MD §9.1 sample. Reversible via `resetTaskCounter()`.

- ASSUMED: Demo terminal/changes/browser panels show static plausible text — because real PTY/git is out of scope. Reversible in `TaskView.tsx` / `AppShell`.

- ASSUMED: "落后于其他部位" shown when progress ≥20pp below project part median and part has started — per MD §5. Reversible in `isLagging()`.

- ASSUMED: Workspace title **Tinman Demo Workspace** — no screenshot provided for exact window title. Reversible in `demoData.ts`.

- ASSUMED: Orchestrator patched `confirmDispatch` to persist `stations` — because the first worker return dropped station assignment so tasks never appeared on workstations. Reversible by reverting `demo/src/domain/dispatch.ts`.

- ASSUMED: Composer text is stored in `composerDraft` and copied into goal `user_intent_verbatim` — because C8 requires the input bar to be operable. Reversible by ignoring composer text in `simulateGenerateGoal`.

- ASSUMED: Browser checks used local Edge + puppeteer-core instead of the IDE browser MCP — because MCP tabs did not stay open in this session. Reversible by re-running `demo/` in any Chromium window at 1440×900 and 1024×768.


