# REPORT — 设计初衷重新对齐 + 分支归并

回答两个问题：分支是否同步运行、能否合并到 main；以及"多轮推进后设计过于复杂"
到底复杂在哪里、该怎么砍。原意图文档已从 git 历史恢复，作为判定基准。

## 0. 判定基准

原文档 `软件意图提示词：机器人视图多项目推进工作台（代号 Tinman）.md`（310 行）
在 commit `41cba4d` 被移出发布并加入 `.gitignore`。恢复方式：

```bash
git show "3707003:软件意图提示词：机器人视图多项目推进工作台（代号 Tinman）.md"
```

与本次结论相关的硬约束：

| 出处 | 约束 |
| --- | --- |
| §0 | 目的不是记录进度，是快速识别任务、快速派发任务 |
| §1 | 从"看见短腿"到"任务已派发"不超过 3 次点击 |
| §2 | 部位槽位固定 7 个，不得扩展；未映射槽位渲染为暗色轮廓，不是 0% |
| §4 | 扫描不得伪造任何模块的完成百分比 |
| §7.1 | 线路数 > 6 时只画 6 条并标注 `+N` |
| §7.2 | 最短腿排行：`项目名 · 部位名 · 进度 · 状态`，最多 5 行 |
| §8.2 | 无事实依据的推测必须写「事实不足：需要扫描 X」，不得猜 |

## 1. 分支核实结果

**结论：分支不"运行"，也不并行。** 分支是提交的指针，不是进程。`git worktree list`
显示整个仓库只有 1 个工作树，检出的只有 `rig/round5`；其余 8 条是冻结快照。

9 条本地分支实际只有 3 条独立工作线，其中 5 个名字只承载 2 个提交：

| 分支名 | 提交 | 与 main 关系 | 判定 |
| --- | --- | --- | --- |
| `rig/round5` | `ce1094d` | 领先 15 个提交 | rounds 4–9 的干流，**未推送** |
| `rig/round4` | `8276c69` | 领先 5 个提交 | `rig/round5` 的祖先，无独立提交 |
| `hardening/memory-limits` | `b589579` | 领先 3 个提交 | 已并入 `origin/main` |
| `review/composer-llm-send` | `b589579` | 同上 | 与上一条**同一个提交** |
| `origin/cursor/auto-map-draft-watch-9871` | `2cc66ac` | 远端独有 | 内容与 round4 重复 |
| `main` / `feat/deepseek-provider` / `rig/round3` | `125fd9b` | — | 三个名字同一个提交 |
| `rig/round1` / `rig/round2` | `e16c3df` | 落后 1 个提交 | 两个名字同一个提交 |

**命名误导**：`rig/round5` 不在 round5。它装着 round4 到 round9 的全部工作。
每一轮都新开一条分支、旧分支不删，于是名字与实际内容脱钩 —— 这是"看不懂"的第一来源。

## 2. 合并记录（已执行）

合并前为每条分支打了 `backup/pre-merge/*` 标签，可随时回退。

1. `git checkout main && git merge --ff-only origin/main` → main 对齐到 `2487cda`（补回
   memory-limits 的 3 个提交）。
2. `git merge --no-commit --no-ff rig/round5` → 15 个提交，**2 处冲突**，其余全部自动合并。
3. 冲突处理（两处都是**互补**而非对立，因此两侧都保留）：
   - `REPORT-round4.md`（add/add）：两个不同文档撞名。保留 rig 线的《自动架构草稿 +
     驻守重扫》为 `REPORT-round4.md`，memory-limits 那份改名为
     `REPORT-hardening-memory-limits.md`。
   - `app/src-tauri/src/llm.rs`（content）：origin/main 侧加 DeepSeek provider 与
     响应体大小上限（`MAX_BODY_BYTES` / `read_body_capped` / `clamp_logged`），
     rig/round5 侧加 `map_architecture` 输出校验（`MAP_SLOTS` /
     `validate_map_architecture`）。两者落在不同区域，合并结果保留双方。

> 注意：`git merge` 首次执行报 `fatal: stash failed`，重试即成功 —— 该 `/Volumes`
> 挂载不能做 POSIX 文件锁，索引刷新偶发失败。遇到同类报错直接重试。

## 3. 三处漂移

### 漂移一：排行表多了一列「分数」（用户可见）

- 证据：`app/src/components/FleetView.tsx:51` `<th>分数</th>`，`:86`
  `<td>{r.score.toFixed(1)}</td>`，表头共 5 列。
- 对照：意图 §7.2 规定四列 `项目名 · 部位名 · 进度 · 状态`。
- 问题：把无量纲的 `shortLegScore`（如 `3.7`）摆在首屏。目标用户是非工程人员，
  这个数字既不解释也不可操作，只增加噪音。
- 改法：删掉 `<th>分数</th>` 与 `<td>{r.score.toFixed(1)}</td>`，`colSpan={5}` 改回 4。
  零风险，不触碰任何计算逻辑。

### 漂移二：两个模块没人用（用户不可见，但撑大了代码与测试）

- 证据：`domain/fleetBrain.ts` 与 `domain/intent.ts` **除自身测试文件外，没有任何
  地方 import**（已全量 grep 确认）。`FleetView.tsx` 用的是 `shortLeg.ts` 的
  `sortProjectsByShortLeg` / `deriveProject`，不是 `fleetRankingWithBlocking`。
- 问题：round 9（缺口4 / 缺口5）产出的两个模块，用户永远看不到。它们只增加了
  domain 层体积（非测试模块已达 14 个）与测试数量。
- 改法：二选一，不要维持半成品。
  - 要留：在 round 10 里真正接进 `useAppState.ts` 与 `FleetView.tsx`；
  - 要砍：删掉这两个模块与对应测试，domain 层立刻变干净。

### 漂移三：第二条"隐形回路"削弱了第一条

- 原意图只有一条回路：看见短腿 → 点一下 → 派发（§1，≤3 次点击）。
- rounds 4–9 实际接进去的是第二条：后台巡检（`patrol`）→ 自动草稿（`autoMap`）→
  漂移检测（`drift`）→ 每部位陈旧度（`staleness`）。这些**已接入** `useAppState.ts`。
- 问题：它们会让分数与排序**自己变动**。用户看到数字动了却不知道为什么，
  反而更不敢信任可见的那条回路。`useAppState.ts` 因此涨到 983 行 / 31 KB。
- 改法：不是删功能，而是**让变动可见**。巡检改完排序后，在排行条上留一行
  "刚刚重扫：left_leg 因 30 天无提交上升"，把隐形回路变成可见的解释。
  这比再加一个视图便宜得多。

### 一处已在 round 9 报告里被自己承认的越界

`fleetBrain.ts` 靠 npm 依赖名模糊匹配推断"A 项目阻塞 B 项目"。round 9 报告原文承认：
`登录` 会匹配任何含这两个字的标签，叫 `react` 的项目会显得阻塞所有依赖它的项目，
"a confident wrong target is worse than an honest fallback, and this layer cannot
tell them apart"。这违反意图 §8.2。**对非技术用户来说，一个自信的错误答案比没有
答案更糟**，因为他分辨不出来。这也是漂移二里"要砍就砍干净"的主要理由。

## 4. 守住了的部分（不需要动）

- 7 个槽位固定未扩展（`domain/types.ts` `ALL_SLOTS`）。
- 自底向上填充、暗色未映射轮廓、blocked 脉冲、READY 徽标（`RobotSvg.tsx`）。
- 线路 > 6 只画 6 条标 `+N`（`RobotSvg.tsx:199-225`）。
- 短腿排行只取前 5（`FleetView.tsx`）。
- 未确认架构地图时不给进度数字（`MapSheet` / `robot-view` 横幅）。

## 5. 执行状态

### 已完成

- **合并已提交**：`4aeb303` `Merge rig/round5 (rounds 4-9) into main`。
  提交前 `git fsck` 干净（仅悬空对象，属正常残留），无对象损坏。
- **合并后在提交树上复验**：Rust `89 passed; 0 failed`；前端 `29 files / 255 tests, 0 failed`。
- **6 个无独立提交的分支已删除**（`feat/deepseek-provider`、`rig/round1`、`rig/round2`、
  `rig/round3`、`review/composer-llm-send`、`hardening/memory-limits`）。全部先确认已并入
  main，因此用的是安全删除 `git branch -d`，不是 `-D`。
- **`app/node_modules` 已恢复为软链**，指向本地磁盘缓存 `~/.cache/tinman-node/node_modules`。
  前端套件从约 10 分钟回到约 1 分钟（测试本体 2.14 秒，其余为 jsdom 环境准备）。
- 9 条合并前的分支顶端全部保留在 `backup/pre-merge/*` 标签下，可随时回退。

### 未做 / 待定

- **产品代码一行未改**（按选择只出报告）。漂移一至三全部仍是现状。
- **`main` 尚未推送**，领先 `origin/main` 16 个提交。
- `rig/round4` / `rig/round5` 仍保留为里程碑指针；两者已完全包含于 main，属可删的下一批。
- `origin/cursor/auto-map-draft-watch-9871` 未处理；它多出的 `watch.rs`（242 行）
  是否与 `patrol` 重复，需要单独比对后再决定。
