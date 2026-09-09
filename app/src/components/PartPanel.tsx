import type { AppStore } from '../hooks/useAppState'
import type { DerivedPart } from '../domain/types'
import { wireProgress } from '../domain/progress'
import { STATUS_LABELS } from '../domain/types'

interface PartPanelProps {
  store: AppStore
  part?: DerivedPart
}

export function PartPanel({ store, part }: PartPanelProps) {
  if (!part) {
    return <div className="part-panel empty">点击机器人部位查看详情</div>
  }

  const facts = part.part.facts

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
                    onChange={(e) => void store.setCriterion(w.id, i, e.target.checked)}
                  />
                  {c.text}
                </label>
                {c.evidence && <span className="evidence">{c.evidence}</span>}
              </li>
            )),
          )}
        </ul>
      </section>

      <section>
        <h3>
          LLM 框架建议 <span className="demo-badge">round 2 · llm.call 未接入</span>
        </h3>
        <p className="muted">确认架构地图并接上模型后，这里会给出 next_step / entry_point / shared_risk。</p>
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
              <button type="button" className="btn-sm" disabled title="round 2">
                生成任务
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
