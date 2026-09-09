CRITERIA:  C1 met — useAppState.test.tsx::c1_non_tauri_four_entries_share_desktop_hint；`npm test` → Tests 105 passed；live Chromium :1420 点「+」「New Project」、Robot 空态「添加本地文件夹」三条对话框正文均为「无法在浏览器里添加本地文件夹 … npm run tauri dev …」，不含 round 2。File 菜单在非 Tauri 下 listen 不注册，测试调同一条 addFolder()；菜单接线由 C2 在桌面 mock 下触发 onMenu('add-folder') 覆盖。
           C2 met — c2_dialog_error_shows_banner_and_clears_overlay：open() reject `dialog-open-sentinel` → `.error-banner` 含该词、`.scan-overlay` 不在 DOM。c2_cancel_is_silent_no_error_no_overlay_no_project：open() resolve null → 无横幅、无 overlay、projects.length 不变。
           C3 met — c3_create_workspace_error_shows_banner_and_clears_overlay / c3_scan_error_shows_banner_and_clears_overlay：横幅含 `create-workspace-sentinel` / `scan-workspace-sentinel`，overlay 被清掉。
           C4 met — c4_stub_dialog_body_does_not_mention_round_2：点 Automations 与直接渲染 StubDialog，正文均为「这个入口还没有接到工作台…」，不含 round 2。live :1420 Automations 对话框同样不含 round 2。
BASELINE:  13 files / 99 tests (frontend), 56 (rust)
AFTER:     Test Files  14 passed (14)
      Tests  105 passed (105)
test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 10.24s
TSC:       0
FILES:     app/src/hooks/useAppState.ts
           app/src/hooks/useAppState.test.tsx
           app/src/components/TaskView.tsx
           app/src/components/AppShell.tsx
           REPORT-round3-wp1.md
SCOPE:     extended: app/src/components/AppShell.tsx — 专用提示必须挂到界面；只在 StubDialog 旁加了一个同级 overlay，未改 `.workspace` 栅格、左栏、右栏或样式。

## 1. Files

- `app/src/hooks/useAppState.ts` — 非 Tauri 走 `folderHint`，不再 `setStubDialog`。`open()` 进同一个 try/catch，失败 `setError(String(e))` + `setScan(null)`。取消（null / 数组）在 setScan 之前 return。`addFolderRef` 让 File 菜单读到当前 `rightPanel`。
- `app/src/components/TaskView.tsx` — StubDialog 默认正文改为与轮次无关的「这个入口还没有接到工作台」。新增 `FolderHintDialog`（中文标题 + 目录选择器只在桌面、`npm run tauri dev`）。
- `app/src/components/AppShell.tsx` — 渲染 `FolderHintDialog`。布局结构未动。
- `app/src/hooks/useAppState.test.tsx` — C1–C4。仓库里原先没有任何 `@tauri-apps/*` mock，本文件是第一条 IPC/dialog harness。
- `REPORT-round3-wp1.md` — 本文件。

## 2. Test summary

```
 Test Files  14 passed (14)
      Tests  105 passed (105)
```

```
test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 10.24s
```

`npx tsc --noEmit` exit 0。未跑 `npm install` / `npm ci`。未 commit、未 push、未切分支。未动 `scanner.rs`、command 签名、`index.css`、`RightPanel.tsx`。

## 3. Decisions

§4.1 选了专用 state（`folderHint: boolean` + `FolderHintDialog`），没有把 `stubDialog` 扩成 `{title, body}`。StubDialog 的语义是「这个入口还没接」；addFolder 的语义是「已经接了，但目录选择器只在桌面」。D1 的机制就是共用一个只能传标题的通道。继续共用、只换正文，Automations 和「添加文件夹」会再次绑死。组件层复用 StubDialog 的 DOM/样式，state 分开。

§4.5 File 菜单闭包：有害，已修。三个按钮的 `onClick={() => void store.addFolder()}` 每次渲染都拿到新函数，不陈旧。`onMenu` 的 effect 依赖是 `[]`，订阅一次。`addFolder` 依赖 `[refreshSide, rightPanel]`：`refreshSide` 稳定，`rightPanel` 会变。用户先切到 Files 再走 File → Add Local Folder…，成功扫描后会 `refreshSide(id, 'facts')`（首帧值），Files 面板空着直到再点一次。旧注释「closes over the latest via event」是错的。`addFolderRef.current = addFolder` 每次渲染更新，监听器在事件里读 ref。

取消不是错误：`setError(undefined)` 仍只在选中路径之后。取消不会清掉已有横幅。

错误格式保持 `String(e)`，与 create/scan 原路径一致，横幅能带上原因。

## 4. Criteria evidence / gaps

C1 File 菜单在非 Tauri 下没有原生菜单，boot effect 在 `if (!isTauri()) return` 之后才 `onMenu`。测试第四条调 `store.addFolder()`，与菜单回调同一函数。菜单是否接到 addFolder，由 C2 在 `isTauri===true` 时 `mockMenu.handler('add-folder')` 证明（open reject → 横幅）。没有在真实 Tauri 窗口再点一次 File 菜单；brief 说桌面路径是好的，本任务没去回归成功扫描。

C2/C3 的 overlay 断言在 `waitFor` 横幅出现之后。create/scan 失败前会短暂 `setScan`；测试钉的是 catch 之后不残留。

C4 只覆盖 StubDialog。`RightPanel.tsx:74` 仍有「round 2 占位」——禁令不准改 RightPanel（WP2）。

## 5. Uncertain / unverified

- Playwright MCP 被占用（`mcp-chrome-aee8611`），没用 MCP 点。改用独立 headless Chromium 打 :1420，三条添加入口 + Automations 已核对。没碰正在跑的 `tauri dev` 窗口（pid 30196）。
- 没有 jsdom 成功路径测试（open → create → scan → 项目出现）。成功分支在 pick 之后与原来同一段；只把 `open()` 推进 try。若 `refreshSide` 在成功扫描后抛错，项目已写入、catch 仍会 `setScan(null)` + `setError`——这是原行为，未改。
- addFolder 没有时钟，测试没用 `useFakeTimers`。`waitFor` 只冲微任务。
- `acceptance.test.tsx` 的 `fakeStore` 没有 `folderHint` / `closeFolderHint`，靠 `as unknown as AppStore`。`store.folderHint &&` 在 undefined 时不渲染，不读 `closeFolderHint`。
- 虚拟化挂载点上的墙钟不可比。本次 `npm test` 2.70s、cargo 10.24s，相对 baseline 变快是环境，不是测少了。

## 6. Brief 纠错

- §5「看 acceptance.test.tsx 和 PartPanel.test.tsx 怎么 mock `@tauri-apps/api` 与 `plugin-dialog`」：这两份文件不 mock 这两包。它们用 `fakeStore`，从不 import `useAppState`。本任务第一次在测试里加载 hook，所以才有 `vi.mock` harness。
- 默认 `view` 是 `'fleet'`，Robot 空态按钮要先点「Robot」。
- File 菜单在非 Tauri 下不存在；「四个入口同一条提示」里菜单只能测 addFolder 本身，不能测 listen 订阅。
- C4 的「通用 StubDialog」和 RightPanel 浏览器占位是两段文案。后者仍含 round 2，不在本包。
