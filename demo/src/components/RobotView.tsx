import { useState } from 'react'
import type { AppStore } from '../hooks/useAppState'
import type { DerivedPart } from '../domain/types'
import { SLOT_LABELS, STATUS_LABELS } from '../domain/types'
import { RobotSvg } from './RobotSvg'
import { PartPanel } from './PartPanel'
import { GoalCardView } from './GoalCardView'

export function RobotView({ store }: { store: AppStore }) {
  const { selectedProject, derived, state } = store
  const selectedPart = derived.parts.find((p) => p.part.id === state.selectedPartId)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)

  const onPartHover = (part: DerivedPart | null, event?: React.MouseEvent) => {
    if (!part || !event) {
      setTip(null)
      return
    }
    const progress = part.displayProgress
    const text = `${part.part.label} ｜ ${SLOT_LABELS[part.part.slot]}\n进度 ${progress}%　${STATUS_LABELS[part.status]}${
      part.shortLegScore > 0 ? `\n短腿分数 ${part.shortLegScore.toFixed(1)}` : ''
    }`
    setTip({ text, x: event.clientX, y: event.clientY })
  }

  return (
    <div className="robot-view">
      <div className="robot-main">
        {!selectedProject.mapConfirmed && (
          <div className="map-banner">
            <p>架构地图尚未确认 — 机器人保持暗色轮廓，不显示虚假进度。</p>
            <button type="button" className="btn primary" onClick={store.confirmMap}>
              确认示例架构地图
            </button>
          </div>
        )}
        <RobotSvg
          uid={`main-${selectedProject.id}`}
          parts={derived.parts}
          mapConfirmed={selectedProject.mapConfirmed}
          highlightSlot={selectedPart?.part.slot}
          shortLegSlot={store.shortLegSlot}
          onPartClick={store.selectPart}
          onPartHover={onPartHover}
        />
      </div>
      <div className="robot-side">
        <PartPanel store={store} part={selectedPart} />
        {state.showGoalCard && state.goalDraft && (
          <GoalCardView
            goal={state.goalDraft}
            onConfirm={() => store.dispatchGoal(state.goalDraft!)}
            onCancel={() => store.patch({ showGoalCard: false, goalDraft: undefined })}
          />
        )}
      </div>
      {tip && (
        <div className="robot-tooltip" style={{ left: tip.x + 14, top: tip.y - 12 }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
