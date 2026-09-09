import { useState, type FormEvent } from 'react'
import type { DerivedPart, GoalCard, LlmAdviceView, LlmUnavailableReason } from '../domain/types'
import { GoalCardView } from './GoalCardView'
import type { LlmCallRow } from '../lib/api'
import { wireProgress } from '../domain/progress'
import { STATUS_LABELS } from '../domain/types'

const REASON_COPY: Record<LlmUnavailableReason, string> = {
  no_key: '未配置密钥',
  no_profile: '未选择模型',
  offline: '模型不可用',
  rejected: '输出未通过校验',
}

export interface PartPanelProps {
  part?: DerivedPart
  advice?: LlmAdviceView
  callLog?: LlmCallRow[]
  onToggleCriterion?: (wireId: string, index: number, met: boolean) => void
  onAddCriterion?: (wireId: string, text: string) => void
  onRequestAdvice?: () => void
  onGenerateGoal?: (wireId: string) => void
  onConfirmDispatch?: () => void
  onCancelGoal?: () => void
  goalDraft?: GoalCard
  dispatchBusy?: boolean
}

export function PartPanel({
  part,
  advice = { status: 'idle' },
  callLog,
  onToggleCriterion,
  onAddCriterion,
  onRequestAdvice,
  onGenerateGoal,
  onConfirmDispatch,
  onCancelGoal,
  goalDraft,
  dispatchBusy,
}: PartPanelProps) {
  const [handFill, setHandFill] = useState('')

  if (!part) {
    return <div className="part-panel empty">点击机器人部位查看详情</div>
  }

  const facts = part.part.facts
  const firstWireId = part.part.wires[0]?.id

  function submitHandFill(e: FormEvent) {
    e.preventDefault()
    const text = handFill.trim()
    if (!firstWireId || !text) return
    onAddCriterion?.(firstWireId, text)
    setHandFill('')
  }

  return (
    <div className="part-panel">
      <section>
        <h3>事实</h3>
        <ul>
          <li>文件区域：{facts?.files.join(', ') || '—'}</li>
          <li>测试：{facts?.tests || '—'}</li>
          <li>最近提交：{facts?.lastCommit || '—'}</li>
          <li>TODO 数：{facts?.todoCount ?? '—'}</li>
        </ul>
      </section>

      <section>
        <h3>验收项</h3>
        <ul className="criteria-list">
          {part.part.wires.length === 0 && <li className="muted">该部位还没有线路</li>}
          {part.part.wires.flatMap((w) =>
            w.criteria.map((c, i) => (
              <li key={`${w.id}-${i}`} className={c.met ? 'met' : 'unmet'}>
                <label>
                  <input
                    type="checkbox"
                    checked={c.met}
                    onChange={(e) => onToggleCriterion?.(w.id, i, e.target.checked)}
                  />
                  {c.text}
                </label>
                {c.evidence && <span className="evidence">{c.evidence}</span>}
              </li>
            )),
          )}
        </ul>
      </section>

      <section className="llm-advice" data-testid="llm-advice">
        <h3>LLM 框架建议</h3>
        {advice.status === 'available' ? (
          <AdviceFields
            advice={advice.advice}
            wireId={firstWireId}
            onAccept={onAddCriterion}
            factPaths={part.part.facts?.files}
          />
        ) : (
          <DegradedAdvice advice={advice} />
        )}
        <form className="hand-fill" onSubmit={submitHandFill}>
          <p className="hand-fill-title">事实 + 手填验收项</p>
          <label>
            <span className="sr-only">手填验收项</span>
            <input
              aria-label="手填验收项"
              value={handFill}
              onChange={(e) => setHandFill(e.target.value)}
              placeholder="根据事实写一条可验证的验收项"
            />
          </label>
          <button type="submit" className="btn-sm" disabled={!firstWireId}>
            添加验收项
          </button>
        </form>
        <button type="button" className="btn-sm" onClick={() => onRequestAdvice?.()}>
          获取框架建议
        </button>
        {callLog && callLog.length > 0 && (
          <details className="llm-call-log">
            <summary>调用记录</summary>
            <ul>
              {callLog.map((row) => (
                <li key={row.id}>
                  {row.purpose} · {row.verdict}
                  {row.reject_reason ? ` · ${row.reject_reason}` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section>
        <h3>线路清单</h3>
        <ul className="wire-list">
          {part.part.wires.map((w) => (
            <li key={w.id}>
              <span>
                {STATUS_LABELS[w.status]} · {w.label}
                {part.part.wires.length > 0 ? ` · ${wireProgress(w)}%` : ''}
              </span>
              <button type="button" className="btn-sm" onClick={() => onGenerateGoal?.(w.id)}>
                生成任务
              </button>
            </li>
          ))}
        </ul>
        {goalDraft && (
          <GoalCardView
            goal={goalDraft}
            onConfirm={() => onConfirmDispatch?.()}
            onCancel={() => onCancelGoal?.()}
            busy={dispatchBusy}
          />
        )}
      </section>
    </div>
  )
}

function CitedText({ text, needles }: { text: string; needles: string[] }) {
  const hits = needles
    .filter((n) => n && text.includes(n))
    .sort((a, b) => b.length - a.length)
  if (hits.length === 0) return <>{text}</>
  const needle = hits[0]!
  const parts: Array<string | { cite: string; key: number }> = []
  let rest = text
  let key = 0
  while (rest.length > 0) {
    const i = rest.indexOf(needle)
    if (i < 0) {
      parts.push(rest)
      break
    }
    if (i > 0) parts.push(rest.slice(0, i))
    parts.push({ cite: needle, key: key++ })
    rest = rest.slice(i + needle.length)
  }
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <span key={`t-${i}`}>{p}</span>
        ) : (
          <button key={p.key} type="button" className="fact-cite" data-testid="fact-cite">
            {p.cite}
          </button>
        ),
      )}
    </>
  )
}

function AdviceFields({
  advice,
  wireId,
  onAccept,
  factPaths,
}: {
  advice: import('../domain/types').FrameworkAdvice
  wireId?: string
  onAccept?: (wireId: string, text: string) => void
  factPaths?: string[]
}) {
  return (
    <div>
      <dl className="llm-fields">
        <dt>diagnosis</dt>
        <dd>
          <CitedText text={advice.diagnosis} needles={factPaths ?? []} />
        </dd>
        <dt>next_step</dt>
        <dd>{advice.next_step}</dd>
        <dt>entry_point</dt>
        <dd>{advice.entry_point}</dd>
        <dt>shared_risk</dt>
        <dd>{advice.shared_risk}</dd>
      </dl>
      <h4>建议验收项</h4>
      <ul className="proposed-criteria">
        {advice.done_criteria.map((item) => (
          <li key={item}>
            <span>{item}</span>
            <button
              type="button"
              className="btn-sm"
              disabled={!wireId}
              onClick={() => wireId && onAccept?.(wireId, item)}
            >
              接受
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DegradedAdvice({
  advice,
}: {
  advice: Exclude<LlmAdviceView, { status: 'available' }>
}) {
  if (advice.status === 'idle') {
    return <p className="muted">尚未获取框架建议。核心功能不依赖模型：先看事实，再手填验收项。</p>
  }
  return (
    <div className="llm-degraded">
      <p>{REASON_COPY[advice.reason]}</p>
      {advice.detail && <p className="muted">{advice.detail}</p>}
      <p className="muted">不阻塞界面。请根据上方事实手填验收项。</p>
    </div>
  )
}
