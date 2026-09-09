import type { GoalCard } from '../domain/types'

interface GoalCardViewProps {
  goal: GoalCard
  onConfirm: () => void
  onCancel: () => void
}

export function GoalCardView({ goal, onConfirm, onCancel }: GoalCardViewProps) {
  return (
    <div className="goal-card">
      <h3>Goal 任务卡 · {goal.task_id}</h3>
      <p>
        <strong>{goal.project.name}</strong> → {goal.target.part} / {goal.target.wire}
      </p>
      <dl>
        <dt>worktree</dt>
        <dd>
          {goal.workspace.worktree_path} <em>(simulated)</em>
        </dd>
        <dt>done_criteria</dt>
        <dd>
          <ul>
            {goal.done_criteria.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </dd>
        <dt>authorization</dt>
        <dd>
          push={String(goal.authorization.allow_push)} deploy=
          {String(goal.authorization.allow_deploy)} spend=
          {String(goal.authorization.allow_spend)}
        </dd>
      </dl>
      <div className="goal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn primary" onClick={onConfirm}>
          确认派发
        </button>
      </div>
    </div>
  )
}
