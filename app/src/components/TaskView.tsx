import type { AppStore } from '../hooks/useAppState'

export function TaskView({ store }: { store: AppStore }) {
  return (
    <div className="task-view">
      <div className="station-card">
        <h3>工位队列</h3>
        <p className="muted">
          派发、隔离 worktree 和 agent CLI 在 round 2 接入。当前项目：
          {store.selectedProject?.name ?? '（未选择）'}
        </p>
        <p>目标：{store.dispatchTarget}</p>
      </div>
    </div>
  )
}

export function StubDialog({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="stub-overlay" role="dialog">
      <div className="stub-dialog">
        <h3>{label}</h3>
        <p>此功能在 round 2 接入（LLM / 派发 / 自动化）。当前只保留入口，避免把工作台做成记录系统。</p>
        <button type="button" className="btn primary" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  )
}
