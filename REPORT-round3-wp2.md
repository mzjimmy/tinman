CRITERIA:  C1 met — Chrome 1440×900：`.collapse-btn` 219–247×0–28，`[aria-label="add local folder"]` 187–215×0–28，相交面积 0；左栏内其余 button/input 与折叠钮相交集合为空。
           C2 met — 同视口：`.group-title` / `#project-filter` / `.projects-group` / `.account-card` / `.left-rail-head` 的 x 均为 12（`--space-3`）。现场无 `.project-item`（空工作区），空态 `.muted.pad` 也是 x=12。
           C3 met — 左栏只剩一个 `addFolder` 入口（`+` / `aria-label="add local folder"`）；Search 已删；`#project-filter` 仍可输入。Chrome：顶栏 0–28，过滤框 28–56，空态/列表起点 y=60（≤96）。
           C4 met — `.right-bar-head` 高 90px（≤96）；`.right-panel-nav` 本身 58px。`.panel-body` 802 / 剩余 810 = 99%（≥55%）。右栏 `overflow: hidden`，正文自己滚。
           C5 met — `.composer` 五个直接子控件高度均为 32px，极差 0（≤2）。
           C6 met — `:root` 定义 `--space-1..4` / `--control-height` / `--control-height-sm` / `--radius-sm`；`.left-bar` 引用 `--space-3`，`.right-panel-nav button` 引用 `--control-height-sm`，`.composer` 引用 `--space-2`，`.composer > .ctrl` 引用 `--control-height`。尺寸 token 与主题无关，只写在 `:root`，注释说明了为什么不进另外两份。
           C7 met — 1440：`grid-template-columns` 计算值为 `260px 980px 200px`，`scrollWidth=1440`。1024：计算值 `824px 200px`，`.left-bar { display: none }`，`scrollWidth=1024`。
           C8 not met — 新增 10 个测试全绿；原 105 里 104 绿。唯一失败：`useAppState.test.tsx::c1_non_tauri_four_entries_share_desktop_hint` 仍点 `name: 'New Project'`。C3 要求左栏只留一个 addFolder 入口，禁令不准改这份 WP1 测试。Rust 56 仍绿。`npx tsc --noEmit` exit 0。
           C9 met — Browser 面板正文为「预览浏览器未接入。用 Changes / Files / Facts 接管手工操作。」，不含 round 2。Chrome `document.body.innerText` 也不含。
BASELINE:  14 files / 105 tests (frontend), 56 (rust)
AFTER:     Test Files  1 failed | 14 passed (15)
      Tests  1 failed | 114 passed (115)
test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 13.43s
TSC:       0
FILES:     app/src/index.css
           app/src/components/AppShell.tsx
           app/src/components/RightPanel.tsx
           app/src/components/AppShell.layout.test.tsx
           REPORT-round3-wp2.md
SCOPE:     clean

## 1. Files

- `app/src/index.css` — 尺寸 token、描边规则、左/右/底/顶栏布局；合并 `.group-title`；去掉折叠钮 `position:absolute`；右栏改为栏不滚、正文滚。
- `app/src/components/AppShell.tsx` — 左栏头部行（Projects / 过滤 / + / 折叠）；删 New Project 与 Search；Automations / Customize / Update 降到账号行；右栏五键收进 `data-testid="right-panel-nav"`；composer 五个直接子节点统一 `ctrl`；顶栏 `float` 换成 flex 行。
- `app/src/components/RightPanel.tsx` — Browser 占位去掉 round 2。
- `app/src/components/AppShell.layout.test.tsx` — §5 的结构契约 + CSS 契约。`fakeStore` 与 `acceptance.test.tsx` 同形，复制而非 import（从测试文件 import 会把 acceptance 用例注册两次）。
- `REPORT-round3-wp2.md` — 本文件。

## 2. Test summary

```
Test Files  1 failed | 14 passed (15)
      Tests  1 failed | 114 passed (115)
```

```
test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 13.43s
```

`npx tsc --noEmit` exit 0。未跑 `npm install` / `npm ci`。未 commit、未 push、未切分支。未动正在跑的 `tauri dev`。

失败的那一条是 WP1 的 `c1_non_tauri_four_entries_share_desktop_hint`（`getByRole('button', { name: 'New Project' })`）。没有改 `useAppState.test.tsx`。其余 WP1 用例（含点 Automations 的 C4）仍绿。

## 3. Spec

尺寸 token（仅 `:root`，与主题无关）：

| token | 值 |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--control-height` | 32px |
| `--control-height-sm` | 28px |
| `--radius-sm` | 4px |
| `--radius` | 8px（原有） |

描边规则（写在 `index.css` `.left-bar` 上方的注释里，下一个人照着写）：

- 容器之间用一条边分隔：左栏 `border-right`、右栏 `border-left`、composer / 账号卡 `border-top`。
- 控件默认无描边、背景透明。hover 用 `--surface2` 填充。
- 选中（`.on` / `.active`）用 `--blue-soft` 填充 + `--blue` 文字。
- 主操作（`.btn.primary`）用 `--blue` 填充，不再套一圈边。
- 键盘：`button/input/select:focus-visible` 为 2px `--blue` outline。composer 输入框把 outline 抬到 `.composer-field:focus-within`，避免内层 input 再画一次。
- 不要再给单个 shell 控件写 `border: 1px solid var(--border)`。

这条规则覆盖 brief 点名的八个选择器（`.btn` / `.btn-sm` / `.view-switch button` / 右栏按钮 / `.collapse-btn` / `.icon-btn` / composer 输入 / `.filter-input`）。`.sort-switch` 不在名单里，仍是描边按钮。

左栏：折叠钮进 `.left-rail-head` 文档流。`--space-3` 是唯一左内边。主操作只留 `+`。过滤图标点了会 focus `#project-filter`（接过 Search 的唯一职责）。Automations / Customize / Update 是账号行上的 `.quiet-btn`。

右栏：标题 + 两行紧凑分段（3+2），总头 90px。`.right-panel-main > *` `flex:1; min-height:0; overflow:auto`。长路径 `overflow-wrap: anywhere`。

底栏：五个直接子节点都是 `.ctrl`，高 `--control-height`。输入是主体（`.composer-field { flex:1 }`）。「未配置模型」+「配置模型」包在 `.composer-llm` 里。原生 `<select>` 去掉 UA 外观，套同一高度。没有发送键。附件名塞进输入容器，不当第六个不同高的直接子节点。

顶栏：`.top-right` 的 `float:right` + `.context-line` 的 `clear:both` 换成 `.top-bar-row` flex。这是文件里唯一的浮动；换成 flex 与其余外壳一致，而且 `context-line` 不再需要 clear。风险低于继续留一个孤立的 BFC 技巧。

## 4. Criteria I could not unit-test

C1–C5、C7 的几何部分 jsdom 证不了（`getBoundingClientRect` 全 0）。契约测试只钉结构/CSS。几何用独立 headless Chromium（Playwright 缓存里的 Chrome 143，CDP，不碰 MCP 占用的那个实例）打 `http://localhost:1420`：

1440×900：

- 折叠 ∩ 添加：面积 0；左栏其他控件相交集合 `[]`
- 一级块 x = 12
- 列表起点 y = 60
- 右栏头 90px，正文占比 0.99
- composer 子高度 `[32,32,32,32,32]`
- grid `260px 980px 200px`（`1fr` 算出来是 980）

1024×768：grid `824px 200px`，左栏 `display:none`，`scrollWidth=1024`。

现场工作区没有项目，所以没有 `.project-item` 矩形。C3 用过滤框底 + `--space-1` 之后的空态 y=60 代替「第一个项目条目」。加上一个项目后，`.project-item` 会从同一 y 开始（按钮没有 `<p>` 那种默认 margin）。

## 5. Uncertain / wrong turns

- C8 和 C3 在这份 brief 里不能同时成立。见 §6。我按 C3 删了 New Project，WP1 那条红着，没有改测试来让它绿。
- 折叠钮和添加钮之间有 4px 缝（`--space-1`）。相交面积是 0，但它们的 y 区间完全重叠。如果验收脚本把「共享 y 区间」当成相交，会和 `x-overlap=0` 的矩形定义打架。我用的是标准 AABB：`x < right && right > x && y < bottom && bottom > y`。
- `.btn` / `.btn-sm` 全局去掉描边，会改到 TaskView / Settings / MapSheet 里用这两个 class 的按钮。这是 D6 点名的选择器，不是误伤。`.sort-switch` 没动，截图里排行开关仍有框。
- 右栏「导航总高」我报了两个数：分段控件 58px，含标题的 `.right-bar-head` 90px。两者都 ≤96。如果验收只量五个按钮的并集，用 58；如果从栏顶量到 `.panel-body` 顶，用 90。
- 没有在 1440 下量过带真实项目列表的左栏。空态文案的左缘与过滤框同为 12。
- 没有量过 `prefers-color-scheme: light` / `.theme-light` 下的像素。尺寸 token 不随主题变。
- composer 的 native `<select>` 用了 `appearance:none` 加 CSS 三角。不同 UA 的内边距仍可能让文字垂直居中差 1px；这次 Chrome 143 里高度是 32，极差 0。
- 左栏折叠后 grid 列仍是 260px（`.left-bar.collapsed { width: 36px }` 改变不了 grid 轨道）。这是原行为，C7 没要求改。

## 6. Brief 纠错

C3「左栏只留一个 addFolder 入口」和 C8「105 tests 不降」加上「不准改 `useAppState.test.tsx`」是三元矛盾。WP1 的 `c1_non_tauri_four_entries_share_desktop_hint` 会点 `New Project` 和 `add local folder` 两个左栏按钮。一个 button 不能同时拥有两个 accessible name（`aria-label="add local folder"` 会盖掉可见文本 `New Project`），所以也不能把两个入口合成一个还让那条测试绿。Search 没有旧测试依赖，按 brief 删了。New Project 有，我没删那条测试，也没留第二个入口。

「沿用 acceptance 的 store fixture，不要另起一套 harness」：从 `acceptance.test.tsx` import 会让 vitest 把那 23 个 describe 再注册一遍。复制同一份 `fakeStore` 不是第二套语义，只是避开双重收集。

§4.7 问 `.top-right` 的 float 动不动：动了。它是全文件唯一的浮动，换成 flex 行之后 `.context-line` 不再靠 `clear:both` 换行，和三栏外壳同一套布局原语。
