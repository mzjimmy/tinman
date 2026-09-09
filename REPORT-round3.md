# REPORT — round 3

Round 3 交付两件事，都在分支 `rig/round3` 上（round 2 的未提交改动被这条分支一并带过来了）：

1. **「添加本地文件夹」不再撒谎。** 用户报的「功能不能用」不是功能坏了 —— 是失败路径在骗人。
2. **左栏 / 右栏 / 底部输入区重做。** 用户报的「边界线、按钮布局、比例差」，每一条都先量成像素再改。

两个工作包都通过 Outside Agent 技能派发给 grok-4.6，测试先行，每一条验收项都在这里由我
独立复验 —— 包括**第一次真正启动 Tauri 桌面窗口**（round 2 明确列为未验证项）。
包报告在 `REPORT-round3-wp1.md` 与 `REPORT-round3-wp2.md`。

## 1. 测试汇总（我自己跑的，不是转述）

```
npm test          ->  Test Files  15 passed (15)
                           Tests  115 passed (115)

cargo test        ->  test result: ok. 56 passed; 0 failed; 0 ignored

npx tsc --noEmit  ->  exit 0
```

Round-2 基线是 13 files / 99 tests 与 56 Rust。没有删任何测试，没有削弱任何断言。
新增 16 个前端测试（WP1 六个，WP2 十个）。唯一被改写的既有测试见 §4，那是我的 brief 造成的，
改写后断言比原来更强。

## 2. 用户报的那个 bug：诊断与真相

**桌面应用里这条路径一直是好的。** 我启动 `npm run tauri dev`，在真实窗口里点左栏「+」：
系统目录选择器打开 → 选中目录 → `create_workspace` → 只读扫描 841 个文件 → 项目进入左栏
→ 架构地图确认表弹出。整条链路完好。

**坏的是浏览器里的失败路径。** 在 `http://localhost:1420`（`npm run dev`，没有 Tauri 后端）
点同一个按钮，实际弹出的是：

> **Add Local Folder needs the desktop app**
> 此功能在 round 2 接入（LLM / 派发 / 自动化）。当前只保留入口，避免把工作台做成记录系统。

标题是英文，正文是 round-1 时代写死的通用占位文案 —— round 2 早就交付了，
而这个功能在桌面端**当时就能用**。没有一个字告诉用户该怎么办。
`useAppState.ts:283` 把非 Tauri 环境直接丢给通用 `StubDialog`，
而 `StubDialog` 的正文是硬编码的。这就是「不能用」的全部来源。

顺带查出第二个缺陷：`open()` 当时在 `try` 块**之外**（`useAppState.ts:288`），
三个调用点又全是 `void store.addFolder()`。所以目录选择器一旦抛错，
用户看到的是彻底的无反应 —— 没有横幅、没有 overlay、没有日志。

## 3. 验收项

### WP1 —「添加本地文件夹」的诚实度

| # | 项 | 状态与证据 |
|---|---|---|
| C1 | 所有入口在非 Tauri 下给出同一条中文提示，不含 round 2 字样 | **我在真实 Chrome 里点的**，拿到「无法在浏览器里添加本地文件夹 / 系统目录选择器只存在于桌面应用…请到 app 目录运行 npm run tauri dev」 |
| C2 | dialog 抛错 → 横幅带原因、overlay 不残留；取消 → 完全安静 | 取消分支**在真实 Tauri 窗口里验证**（点开选择器→Cancel→无横幅、无 overlay、项目数不变）；抛错分支读了带 sentinel 的测试断言 |
| C3 | create_workspace / scan_workspace 抛错同样落到横幅并清 overlay | 两个 sentinel 测试，断言逐行读过 |
| C4 | StubDialog 正文不再宣称「round 2 接入」 | 浏览器实测 + 测试 |

`open()` 现在在 try 内，失败统一 `setError` + `setScan(null)`。
`setScan(null)` 不是可有可无 —— `scanning` 的定义是 `scan !== null && scan.phase !== 'done'`，
漏掉它会让扫描遮罩永久盖住整个界面。

### WP2 — 外壳重做（几何项全部由我在真实浏览器里量，不按描述判定）

| # | 项 | 改前 | 改后 | 状态 |
|---|---|---|---|---|
| C1 | 折叠按钮不与其他控件相交 | 与 New Project 重叠 **20×20px**；`position:absolute` | 相交集合 `[]`；`position: static` | ✅ |
| C2 | 左栏一级块左边缘统一 | **0 / 8 / 12 / 16** 四条基线 | 三块全部 **12** | ✅ |
| C3 | 顶部功能区不再是四个全宽描边按钮 | 四个 235×28 堆到 y=142，列表 y≈230 | 一条头部行，列表起点 **y=60** | ✅ |
| C4 | 右栏导航 ≤96px，正文 ≥55% | 导航 **219px**，正文 **18px** | 导航 58px（含标题 90px），正文 **802px = 89.1%** | ✅ |
| C5 | 底部控件同高（极差 ≤2px） | **27/39/28/28/21** | **32/32/32/32/32**，极差 **0** | ✅ |
| C6 | 尺寸来自一组 CSS 变量 | 八个选择器各写各的 border/padding/radius | `--space-1..4` / `--control-height(-sm)` / `--radius-sm`，三处引用 | ✅ |
| C7 | 断点不变 | — | 1440 → `260px 980px 200px`，scrollWidth 1440；1024 → `824px 200px`、左栏隐藏、scrollWidth **1024** | ✅ |
| C8 | 测试与 tsc 不降 | — | 15 files / 115 tests，Rust 56，tsc 0 | ✅（见 §4） |
| C9 | 右栏 Browser 占位不提 round 2 | 「round 2 占位 — 预览浏览器未接入」 | 「预览浏览器未接入。用 Changes / Files / Facts 接管手工操作。」 | ✅ |

被删掉的两个东西，理由写在这里以免下次有人以为是漏了：

- **`Search` 按钮**：它的实现是 `document.getElementById('project-filter')?.focus()` ——
  唯一作用是把焦点移到下面 150px 处那个一直可见的过滤输入框。职责已交给标题旁的 ⌕ 图标。
- **`New Project` 按钮**：它和「Projects」标题旁的 `+` 调的是同一个
  `store.addFolder()`，在一栏 260px 里把同一个动作画了两遍。

`Automations` / `Customize` / `Update` 降级为账号行上的安静按钮 —— 它们都是 stub 入口，
不该和主操作等权重。

## 4. 我自己改的那一处，以及为什么是我的错

WP2 按 C3 删掉 `New Project` 之后，WP1 的
`c1_non_tauri_four_entries_share_desktop_hint` 红了 —— 它点的正是那个按钮。
grok 没有改那条测试（brief 里明令禁止），而是**报了 `C8 not met` 并在报告里指出
我的 brief 自相矛盾**：C3 要求「左栏只留一个 addFolder 入口」，C8 要求「测试不降」，
禁令又不准动 WP1 的测试 —— 三者不可能同时成立。它是对的，这是我写 brief 的错。

我在这里修的，改法不是把断言放松：删掉那次点击之后，补上了两条更强的断言 ——
`New Project` 必须不存在，且左栏里能触发 addFolder 的控件**恰好一个**。
原来的测试只保证「这几个按钮都会弹提示」；现在还保证「不会有第二个入口绕过这条提示」。
测试改名为 `c1_non_tauri_every_add_folder_entry_shows_desktop_hint`。

## 5. 我在报告之外自己做的验证

- 两套测试各跑三次（WP1 后、WP2 后、我修完后），`npx tsc --noEmit` 各一次。
- **第一次启动 Tauri 桌面窗口** —— round 2 把它列为未验证项。在真实窗口里点通了
  添加文件夹、取消、架构地图确认表、右栏面板切换。
- 几何验收全部由我独立测量，不复用 grok 的数字：在 Chrome 里 1440×900 与 1024×768
  各跑一段 `getBoundingClientRect()` 脚本，用标准 AABB 判相交。
  grok 也自己起了一个 headless Chromium 量过，两组数字一致 —— 但两组是独立得到的。
- **第二次冷启动复验**：关掉 dev server、重新 `npm run dev`、浏览器全新加载（不是 HMR
  热更新后的状态）再量一遍 1440 与 1024，每个数字逐一复现。另外在 1024 下扫了整棵 DOM
  找 `scrollWidth > clientWidth` 且 `overflow-x: visible` 的元素，结果为空 —— 没有任何
  一处横向溢出，不只是根元素没有。
- 作用域机械核对：改动文件恰好是 `index.css`、`AppShell.tsx`、`RightPanel.tsx`、
  `AppShell.layout.test.tsx`、`useAppState.test.tsx`、`useAppState.ts`、`TaskView.tsx`。
  `RobotSvg.tsx`、`scanner.rs`、所有 Rust 代码、`demo/`、`robot-v2.html` 逐字节未动
  （WP1 阶段我用快照比对确认 `index.css` 与 `RightPanel.tsx` 完全未被 WP1 触碰）。
- 描边规则改到了全局 `.btn` / `.btn-sm`，会波及 MapSheet / Settings / TaskView。
  我在桌面窗口里打开架构地图确认表检查过：「稍后 / 保存草稿」是安静按钮，
  「确认架构地图」是蓝色主按钮，层级比改前更清楚。这是收益，不是误伤。
- 读了 WP2 的 10 条断言，确认没有几何断言（jsdom 里会以「全 0 相等」假绿），
  且 CSS 契约断言都带了「规则不存在就失败」的守卫，不会因为选择器改名而空过。

## 6. 环境：一个会毁掉这一轮的坑，已修

`app/node_modules` 在本轮开始时已经不是符号链接，而是挂载点上的一个真实目录 ——
前端测试要跑 **262 秒**（round 2 的记录是 2 秒）。我把它恢复成指向
`/Users/sentinellab/.cache/tinman-node/node_modules` 的符号链接，**回到 9.5 秒**（首次含冷启动，之后 2.6 秒）。
两个 brief 里都写死了「不要在 `app/` 里跑 `npm install`」，因为那正是把符号链接换掉的动作。

其余环境约束不变：`CARGO_TARGET_DIR=/tmp/tinman-target cargo test`；
`app/src-tauri/.cargo/config.toml` 关闭增量编译（这个文件系统上 rustc session lock 报 os error 45）。

## 7. 不确定、未验证、如实列出

- **浅色主题已补量（原先列为未验证）。** 冷启动 + `data-theme="light"` 下重量一遍：
  折叠钮相交数 0、左栏三块左边缘 12/12/12、右栏导航 58px、正文占比 89.1%、
  composer 极差 0、`scrollWidth` 1440 —— 与深色逐项相同。尺寸 token 与主题无关这一点成立。
  正文对比度 13.98:1。
- **新发现（既有问题，不是本轮引入）：`.muted` 在浅色下对比度只有 4.27:1。**
  `--text2: #7d7a75` 落在白底上，14px 常规字重，低于 WCAG AA 对正文要求的 4.5:1。
  受影响的是「添加本地文件夹开始扫描」这类次要说明文字。
  我核对过 `git show HEAD:app/src/index.css`：这个 token 值与 round-1 提交完全一致，
  **round 3 没有碰它**。没有顺手改，因为它是全局颜色 token，改动会波及每一个用到
  `--text2` 的界面，超出本轮契约 —— 留给下一轮，和 `.sort-switch` 一起收。
- **左栏折叠后 grid 轨道仍是 260px** —— `.left-bar.collapsed { width: 36px }` 改不了
  grid 列宽。这是 round-1 就有的行为，本轮没要求改，也没改。
- **只在 Chrome 143 与 Tauri 的 WKWebView 里看过。** composer 的原生 `<select>`
  用了 `appearance:none`，其他 UA 的内边距可能让文字垂直差 1px。
- **`.sort-switch`（最短腿排行的排序开关）不在 D6 点名的八个选择器里，仍是描边按钮。**
  它和新规则不完全一致。留着是因为它不在本轮 scope 内，但下一轮该收进来。
- **右栏「导航总高」有两个口径**：五个按钮的并集 58px，含标题的 `.right-bar-head` 90px。
  两者都 ≤96，验收按哪个口径都过，但这两个数字不是一回事。
- round 2 遗留的未验证项里，**`StdProcessRunner` 对真实进程仍未跑过**，
  **验收项 3（三人 / 五项目 / 15 秒）仍是人类研究，没有做**。本轮没有触碰这两项。
- 我没有跑 `tauri build`（只跑了 `tauri dev`）。打包产物未验证。

## 8. 提交

**改动全部未提交，在分支 `rig/round3` 上**（round 2 的未提交改动也在这条分支里 ——
如果要把两轮分开，需要先在 round-2 的内容上做一次提交）。一次性提交两轮：

```bash
git add -A && git commit -m "feat(app): round-2 LLM gate + dispatch, round-3 add-folder honesty and shell chrome"
```

只想提交本轮：先按 `REPORT-round2.md` 末尾的命令提交 round 2，再提交本轮改动。
