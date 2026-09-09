import type { AppStore } from '../hooks/useAppState'

const PANEL_COPY: Record<string, { title: string; body: string }> = {
  terminal: {
    title: 'Demo Terminal (simulated)',
    body: '$ tinman-agent run t_0142\n[sim] Cloning worktree /tmp/tinman/t_0142\n[sim] Running vitest — 12 passed\n[sim] No real PTY connected',
  },
  changes: {
    title: 'Demo Changes (simulated git diff)',
    body: 'diff --git a/.github/workflows/ci.yml\n+ name: CI\n+ on: [push]\n+ jobs:\n+   test:\n+     runs-on: ubuntu-latest',
  },
  browser: {
    title: 'Demo Preview (simulated)',
    body: '[Preview] Settings page mock — checkbox "Enable CI notifications" checked.',
  },
  files: {
    title: 'Demo Files (simulated tree)',
    body: 'src/\n  left_leg/\n    ci.ts\n  torso/\n    core.ts\ntests/\n  left_leg.test.ts',
  },
  facts: {
    title: 'Demo Facts (simulated scan)',
    body: 'files: 128 · TS 62% · last commit 2026-08-12 · todos: 4',
  },
}

export function TaskView({ store }: { store: AppStore }) {
  const { state } = store

  return (
    <div className="task-view">
      <div className="stations">
        {state.stations.map((st) => {
          const task = state.tasks.find((t) => t.id === st.taskId)
          return (
            <div key={st.id} className="station-card">
              <h3>
                {st.label}｜
                {task
                  ? `${task.goal.target.slot} / ${task.goal.target.wire}`
                  : '等待派发'}
              </h3>
              <p>{task ? taskStateLabel(task.state) : '空位'}</p>
              {task && (
                <div className="station-actions">
                  <button type="button" className="btn-sm" onClick={() => store.patch({ rightPanel: 'terminal', view: 'task' })}>
                    打开终端
                  </button>
                  <button type="button" className="btn-sm" onClick={() => store.patch({ rightPanel: 'changes' })}>
                    查看变更
                  </button>
                  {task.state !== 'done' && (
                    <button type="button" className="btn-sm primary" onClick={() => store.completeTask(task.id)}>
                      模拟完成
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {state.queue.length > 0 && (
        <div className="queue">
          <h3>等待队列</h3>
          <ul>
            {state.queue.map((id) => {
              const t = state.tasks.find((x) => x.id === id)
              return <li key={id}>{t?.goal.target.wire ?? id}</li>
            })}
          </ul>
        </div>
      )}

      {state.rightPanel && (
        <div className="demo-panel inline-panel">
          <h4>{PANEL_COPY[state.rightPanel]?.title}</h4>
          <pre>{PANEL_COPY[state.rightPanel]?.body}</pre>
        </div>
      )}
    </div>
  )
}

function taskStateLabel(state: string): string {
  const map: Record<string, string> = {
    queued: '排队中',
    waiting_dispatch: '等待派发',
    running: '正在实现',
    checking: '正在检查',
    done: '已完成',
    failed: '失败',
  }
  return map[state] ?? state
}

export function DemoPanel({ kind }: { kind: keyof typeof PANEL_COPY }) {
  const copy = PANEL_COPY[kind]
  return (
    <div className="demo-panel">
      <h4>{copy.title}</h4>
      <pre>{copy.body}</pre>
    </div>
  )
}

export function StubDialog({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="stub-overlay" role="dialog">
      <div className="stub-dialog">
        <h3>{label}</h3>
        <p>
          Demo stub — 此功能将在完整版通过 scan / SQLite / LLM 适配层接入。当前仅展示交互占位。
        </p>
        <button type="button" className="btn primary" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  )
}
