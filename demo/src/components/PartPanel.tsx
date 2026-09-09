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
  const advice = part.part.advice

  return (
    <div className="part-panel">
      <section>
        <h3>事实</h3>
        <ul>
          <li>文件区域：{facts?.files.join(', ')}</li>
          <li>测试：{facts?.tests}</li>
          <li>最近提交：{facts?.lastCommit}</li>
          <li>TODO 数：{facts?.todoCount}</li>
        </ul>
      </section>

      <section>
        <h3>验收项</h3>
        <ul className="criteria-list">
          {part.part.wires.flatMap((w) =>
            w.criteria.map((c, i) => (
              <li key={`${w.id}-${i}`} className={c.met ? 'met' : 'unmet'}>
                {c.met ? '✓' : '○'} {c.text}
                {c.evidence && (
                  <a href="#" onClick={(e) => e.preventDefault()}>
                    {c.evidence}
                  </a>
                )}
              </li>
            )),
          )}
        </ul>
      </section>

      <section>
        <h3>
          LLM 框架建议{' '}
          <span className="demo-badge">Demo data · llm.call(&apos;advise_part&apos;) not connected</span>
        </h3>
        {advice && (
          <dl className="advice">
            <dt>diagnosis</dt>
            <dd>{advice.diagnosis}</dd>
            <dt>next_step</dt>
            <dd>{advice.next_step}</dd>
            <dt>entry_point</dt>
            <dd>{advice.entry_point}</dd>
            <dt>shared_risk</dt>
            <dd>{advice.shared_risk}</dd>
            <dt>done_criteria</dt>
            <dd>
              <ul>
                {advice.done_criteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </dd>
          </dl>
        )}
      </section>

      <section>
        <h3>线路清单</h3>
        <ul className="wire-list">
          {part.part.wires.map((w) => (
            <li key={w.id}>
              <span>
                {STATUS_LABELS[w.status]} · {w.label} · {wireProgress(w)}%
              </span>
              <button type="button" className="btn-sm" onClick={() => store.generateGoal(w.id)}>
                生成任务
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn primary" onClick={() => store.generateGoal()}>
          生成任务
        </button>
      </section>
    </div>
  )
}
