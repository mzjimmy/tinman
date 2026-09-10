import type { AppStore } from '../hooks/useAppState'
import type { Task } from '../domain/types'
import {
  DEFAULT_STATION_COUNT,
  MAX_STATION_COUNT,
  deriveBoard,
  errorFromResult,
  taskSummary,
} from '../domain/queue'

function taskStateLabel(state: string): string {
  const map: Record<string, string> = {
    queued: '排队中',
    waiting_dispatch: '等待派发',
    running: '正在实现',
    checking: '正在检查',
    done: '已完成',
    failed: '失败',
    paused: '已暂停（进程已停）',
    abandoned: '已放弃',
  }
  return map[state] ?? state
}

function StationRow({
  label,
  task,
  selected,
  onSelect,
  onPause,
  onAbandon,
  onTakeOver,
}: {
  label: string
  task?: Task
  selected: boolean
  onSelect: () => void
  onPause?: () => void
  onAbandon?: () => void
  onTakeOver?: () => void
}) {
  const occupying = task?.state === 'running' || task?.state === 'waiting_dispatch'
  return (
    <div
      className={`station-card${selected ? ' selected' : ''}`}
      data-testid={`station-${label}`}
    >
      <h3>
        {label}｜
        {task ? `${task.goal.target.slot} / ${task.goal.target.wire}` : '空位'}
      </h3>
      <p>{task ? taskStateLabel(task.state) : '空位'}</p>
      {task?.state === 'failed' && (
        <p className="task-failure" data-testid={`failure-${task.id}`}>
          {errorFromResult(task.result) ?? '失败'}
        </p>
      )}
      {task && (
        <div className="station-actions">
          <button type="button" className="btn-sm" onClick={onSelect}>
            打开终端
          </button>
          {occupying && (
            <>
              <button
                type="button"
                className="btn-sm"
                title="停止子进程（SIGTERM）并释放工位。worktree 保留。不是只卡住队列。"
                onClick={onPause}
              >
                {task.state === 'running' ? '暂停进程并释放工位' : '暂停并释放工位'}
              </button>
              <button type="button" className="btn-sm" onClick={onTakeOver}>
                手动接管
              </button>
              <button type="button" className="btn-sm" onClick={onAbandon}>
                放弃并保留 worktree
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FinishedSummary({ task }: { task: Task }) {
  const summary = taskSummary(task)
  if (!summary) return null
  return (
    <div className="task-summary" data-testid={`task-summary-${task.id}`}>
      <h3>
        {task.goal.target.slot} / {task.goal.target.wire} · {taskStateLabel(task.state)}
      </h3>
      {task.state === 'failed' && (
        <p className="task-failure" data-testid={`failure-${task.id}`}>
          {errorFromResult(task.result) ?? '失败'}
        </p>
      )}
      <section>
        <h4>打开试用</h4>
        <p>{summary.tryIt || '—'}</p>
      </section>
      <section>
        <h4>做成了什么</h4>
        <ul>
          {summary.built.length === 0 && <li className="muted">—</li>}
          {summary.built.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4>检查了什么</h4>
        <ul>
          {summary.checked.length === 0 && <li className="muted">—</li>}
          {summary.checked.map((c) => (
            <li key={c.text}>
              {c.text}
              {c.evidence ? ` · ${c.evidence}` : ''}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>还有什么没做好</h4>
        <ul>
          {summary.stillWrong.length === 0 && <li className="muted">—</li>}
          {summary.stillWrong.map((c) => (
            <li key={c.text}>
              {c.text}
              {c.reason ? ` · ${c.reason}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function TaskView({ store }: { store: AppStore }) {
  const tasks = store.tasks.filter(
    (t) => !store.selectedProjectId || t.projectId === store.selectedProjectId,
  )
  const count = store.stationCount ?? store.stations?.length ?? DEFAULT_STATION_COUNT
  const board = deriveBoard(tasks, count)
  const occupyingIds = new Set(board.stations.map((s) => s.taskId).filter(Boolean))
  const paused = tasks.filter((t) => t.state === 'paused')
  const abandoned = tasks.filter((t) => t.state === 'abandoned')
  const settled = tasks.filter(
    (t) =>
      (t.state === 'done' || t.state === 'checking' || t.state === 'failed') &&
      !occupyingIds.has(t.id),
  )

  return (
    <div className="task-view">
      <div className="station-count-row">
        <label>
          工位数
          <input
            type="number"
            min={1}
            max={MAX_STATION_COUNT}
            aria-label="工位数"
            value={count}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 1) store.setStationCount?.(n)
            }}
          />
        </label>
      </div>
      <div className="stations">
        {board.stations.map((st) => {
          const task = tasks.find((t) => t.id === st.taskId)
          return (
            <StationRow
              key={st.id}
              label={st.label}
              task={task}
              selected={!!task && store.selectedTaskId === task.id}
              onSelect={() => task && store.selectTask(task.id)}
              onPause={() => task && store.pauseTask(task.id)}
              onAbandon={() => task && store.abandonTask(task.id)}
              onTakeOver={() => task && store.takeOver(task.id)}
            />
          )
        })}
      </div>
      {board.queue.length > 0 && (
        <div className="queue" data-testid="task-queue">
          <h3>等待队列</h3>
          <ul>
            {board.queue.map((id) => {
              const t = tasks.find((x) => x.id === id)
              return (
                <li key={id} data-testid={`queued-${id}`}>
                  {t ? `${t.goal.target.slot} / ${t.goal.target.wire}` : id}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {paused.map((task) => (
        <div key={task.id} className="station-card" data-testid={`paused-${task.id}`}>
          <h3>
            已暂停｜{task.goal.target.slot} / {task.goal.target.wire}
          </h3>
          <p className="pause-note">
            已停止子进程并释放工位。worktree 保留。恢复后重新排队，不会接着同一个进程。
          </p>
          <div className="station-actions">
            <button type="button" className="btn-sm" onClick={() => store.resumeTask(task.id)}>
              恢复（重新排队）
            </button>
            <button type="button" className="btn-sm" onClick={() => store.abandonTask(task.id)}>
              放弃并保留 worktree
            </button>
            <button type="button" className="btn-sm" onClick={() => store.selectTask(task.id)}>
              打开终端
            </button>
          </div>
        </div>
      ))}
      {abandoned.map((task) => (
        <div key={task.id} className="station-card" data-testid={`abandoned-${task.id}`}>
          <h3>
            已放弃｜{task.goal.target.slot} / {task.goal.target.wire}
          </h3>
          <p>worktree 已保留：{task.worktreePath ?? task.goal.workspace.worktree_path}</p>
          <div className="station-actions">
            <button type="button" className="btn-sm" onClick={() => store.selectTask(task.id)}>
              打开终端
            </button>
            <button
              type="button"
              className="btn-sm"
              onClick={() => store.removeWorktree?.(task.id)}
            >
              删除 worktree
            </button>
          </div>
        </div>
      ))}
      {settled.map((task) => (
        <FinishedSummary key={task.id} task={task} />
      ))}
      {tasks.length === 0 && (
        <div className="station-card">
          <h3>工位队列</h3>
          <p className="muted">
            从短腿排行点进部位，点「生成任务」，再确认派发。当前项目：
            {store.selectedProject?.name ?? '（未选择）'}
          </p>
          <p>目标：{store.dispatchTarget}</p>
        </div>
      )}
    </div>
  )
}

const STUB_BODY = '这个入口还没有接到工作台。点「知道了」关闭即可。'

const ADD_FOLDER_HINT_TITLE = '无法在浏览器里添加本地文件夹'
const ADD_FOLDER_HINT_BODY =
  '系统目录选择器只存在于桌面应用，浏览器里打不开。请到 app 目录运行 npm run tauri dev，在桌面窗口里再点「添加本地文件夹」。'

export function StubDialog({
  label,
  body = STUB_BODY,
  onClose,
}: {
  label: string
  body?: string
  onClose: () => void
}) {
  return (
    <div className="stub-overlay" role="dialog">
      <div className="stub-dialog">
        <h3>{label}</h3>
        <p>{body}</p>
        <button type="button" className="btn primary" onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  )
}

export function FolderHintDialog({ onClose }: { onClose: () => void }) {
  return <StubDialog label={ADD_FOLDER_HINT_TITLE} body={ADD_FOLDER_HINT_BODY} onClose={onClose} />
}
