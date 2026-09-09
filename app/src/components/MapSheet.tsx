import { useEffect, useMemo, useState } from 'react'
import { ALL_SLOTS, SLOT_LABELS, type Slot } from '../domain/types'
import {
  applyProposal,
  assignModule,
  blankCriteria,
  emptyProposal,
  type ArchitectureProposal,
} from '../domain/proposal'
import type { Facts } from '../lib/api'

interface MapSheetProps {
  proposal?: ArchitectureProposal | null
  facts?: Facts
  modules: string[]
  defaultName: string
  onConfirm: (proposal: ArchitectureProposal, name: string) => void
  onDraft?: (proposal: ArchitectureProposal) => void
  onCancel: () => void
}

export function MapSheet({
  proposal,
  facts,
  modules,
  defaultName,
  onConfirm,
  onDraft,
  onCancel,
}: MapSheetProps) {
  const initial = useMemo(
    () => applyProposal(emptyProposal(), proposal),
    [proposal],
  )
  const [draft, setDraft] = useState<ArchitectureProposal>(initial)
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    setDraft(applyProposal(emptyProposal(), proposal))
  }, [proposal])

  const assigned = new Map<string, Slot>()
  for (const p of draft.parts) {
    for (const m of p.modulePaths) assigned.set(m, p.slot)
  }

  function setPart(slot: Slot, patch: Partial<ArchitectureProposal['parts'][number]>) {
    setDraft((d) => ({
      parts: d.parts.map((p) => (p.slot === slot ? { ...p, ...patch } : p)),
    }))
  }

  function addWire(slot: Slot) {
    setDraft((d) => ({
      parts: d.parts.map((p) =>
        p.slot === slot
          ? {
              ...p,
              wires: [...p.wires, { label: '', criteria: blankCriteria(3) }],
            }
          : p,
      ),
    }))
  }

  function updateWire(slot: Slot, wi: number, label: string) {
    setDraft((d) => ({
      parts: d.parts.map((p) =>
        p.slot === slot
          ? { ...p, wires: p.wires.map((w, i) => (i === wi ? { ...w, label } : w)) }
          : p,
      ),
    }))
  }

  function updateCriterion(slot: Slot, wi: number, ci: number, text: string) {
    setDraft((d) => ({
      parts: d.parts.map((p) =>
        p.slot === slot
          ? {
              ...p,
              wires: p.wires.map((w, i) =>
                i === wi
                  ? {
                      ...w,
                      criteria: w.criteria.map((c, j) => (j === ci ? { ...c, text } : c)),
                    }
                  : w,
              ),
            }
          : p,
      ),
    }))
  }

  function addCriterion(slot: Slot, wi: number) {
    setDraft((d) => ({
      parts: d.parts.map((p) =>
        p.slot === slot
          ? {
              ...p,
              wires: p.wires.map((w, i) =>
                i === wi && w.criteria.length < 6
                  ? { ...w, criteria: [...w.criteria, { text: '', met: false, evidence: '' }] }
                  : w,
              ),
            }
          : p,
      ),
    }))
  }

  function submit() {
    for (const p of draft.parts) {
      if (!p.present) continue
      for (const w of p.wires) {
        const n = w.criteria.filter((c) => c.text.trim()).length
        if (!w.label.trim()) {
          setError(`${SLOT_LABELS[p.slot]}: 线路需要名称`)
          return
        }
        if (n < 3 || n > 6) {
          setError(`${w.label || SLOT_LABELS[p.slot]}: 每条线路需要 3–6 条验收项`)
          return
        }
      }
    }
    const cleaned: ArchitectureProposal = {
      parts: draft.parts.map((p) => ({
        ...p,
        wires: p.present
          ? p.wires.map((w) => ({
              ...w,
              criteria: w.criteria
                .filter((c) => c.text.trim())
                .map((c) => ({ ...c, met: false })),
            }))
          : [],
      })),
    }
    onConfirm(cleaned, name)
  }

  return (
    <div className="map-sheet">
      <header className="map-sheet-head">
        <div>
          <h2>架构地图</h2>
          <p>七个固定槽位。多出来的模块合并进同类槽，不能加第八个。未使用的槽保持暗色轮廓，不是 0%。</p>
        </div>
        <label>
          项目名
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </header>

      {facts && (
        <div className="facts-summary">
          <strong>扫描摘要</strong>
          <span>{facts.file_count} 文件</span>
          <span>
            {Object.entries(facts.loc_by_language)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([k, v]) => `${k} ${v}`)
              .join(' · ') || 'LOC —'}
          </span>
          <span>分支 {facts.git.branch ?? '—'}</span>
          <span>TODO {facts.markers.length}</span>
          <span>{(facts.duration_ms / 1000).toFixed(1)}s</span>
        </div>
      )}

      <section className="module-assign">
        <h3>发现的模块（合并到槽位）</h3>
        <ul>
          {modules.length === 0 && <li className="muted">没有发现顶层目录</li>}
          {modules.map((m) => (
            <li key={m}>
              <code>{m}</code>
              <select
                value={assigned.get(m) ?? ''}
                onChange={(e) => {
                  const v = e.target.value as Slot | ''
                  setDraft((d) => assignModule(d, m, v ? (v as Slot) : null))
                }}
                aria-label={`assign ${m}`}
              >
                <option value="">未分配</option>
                {ALL_SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {SLOT_LABELS[s]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </section>

      <div className="slot-rows">
        {draft.parts.map((p) => (
          <article key={p.slot} className="slot-row">
            <header>
              <label className="present">
                <input
                  type="checkbox"
                  checked={p.present}
                  onChange={(e) => setPart(p.slot, { present: e.target.checked })}
                />
                {SLOT_LABELS[p.slot]}
              </label>
              <input
                value={p.label}
                onChange={(e) => setPart(p.slot, { label: e.target.value })}
                aria-label={`${p.slot} label`}
              />
              <label>
                权重
                <input
                  type="number"
                  min={0.5}
                  max={8}
                  step={0.5}
                  value={p.weight}
                  onChange={(e) => setPart(p.slot, { weight: Number(e.target.value) })}
                />
              </label>
              <label>
                计划开工
                <input
                  type="date"
                  value={p.plannedStart ?? ''}
                  onChange={(e) => setPart(p.slot, { plannedStart: e.target.value })}
                />
              </label>
            </header>
            {p.modulePaths.length > 0 && (
              <p className="chips">
                {p.modulePaths.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </p>
            )}
            {p.present && (
              <div className="wire-editor">
                {p.wires.map((w, wi) => (
                  <div key={wi} className="wire-edit">
                    <input
                      placeholder="线路名称"
                      value={w.label}
                      onChange={(e) => updateWire(p.slot, wi, e.target.value)}
                    />
                    {w.criteria.map((c, ci) => (
                      <input
                        key={ci}
                        placeholder={`验收项 ${ci + 1}`}
                        value={c.text}
                        onChange={(e) => updateCriterion(p.slot, wi, ci, e.target.value)}
                      />
                    ))}
                    {w.criteria.length < 6 && (
                      <button type="button" className="btn-sm" onClick={() => addCriterion(p.slot, wi)}>
                        + 验收项
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="btn-sm" onClick={() => addWire(p.slot)}>
                  + 线路
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      <footer className="map-actions">
        <button type="button" className="btn" onClick={onCancel}>
          稍后
        </button>
        {onDraft && (
          <button type="button" className="btn" onClick={() => onDraft(draft)}>
            保存草稿
          </button>
        )}
        <button type="button" className="btn primary" onClick={submit}>
          确认架构地图
        </button>
      </footer>
    </div>
  )
}
