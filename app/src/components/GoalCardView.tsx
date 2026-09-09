import type { GoalCard } from '../domain/types'

interface GoalCardViewProps {
  goal: GoalCard
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

export function GoalCardView({ goal, onConfirm, onCancel, busy }: GoalCardViewProps) {
  return (
    <div className="goal-card" data-testid="goal-card">
      <h3>Goal 任务卡 · {goal.task_id}</h3>
      <p>
        <strong>{goal.project.name}</strong> → {goal.target.part} / {goal.target.wire}
      </p>
      <dl>
        <dt>user_intent_verbatim</dt>
        <dd>{goal.user_intent_verbatim.join('\n') || '（空）'}</dd>
        <dt>worktree</dt>
        <dd>
          {goal.workspace.worktree_path} · {goal.workspace.branch}
        </dd>
        <dt>framework_advice</dt>
        <dd>
          {goal.framework_advice.next_step} · {goal.framework_advice.entry_point}
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
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="button" className="btn primary" onClick={onConfirm} disabled={busy}>
          确认派发
        </button>
      </div>
    </div>
  )
}
