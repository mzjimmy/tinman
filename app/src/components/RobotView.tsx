import { useState } from 'react'
import type { AppStore } from '../hooks/useAppState'
import type { DerivedPart } from '../domain/types'
import { RobotSvg, partTooltip } from './RobotSvg'
import { PartPanel } from './PartPanel'
import { MapSheet } from './MapSheet'

export function RobotView({ store }: { store: AppStore }) {
  const selectedProject = store.selectedProject
  const derived = store.derived
  const selectedPart = derived?.parts.find((p) => p.part.id === store.selectedPartId)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)

  if (!selectedProject || !derived) {
    return (
      <div className="empty-main">
        <p>添加一个本地文件夹，开始只读扫描。</p>
        <button type="button" className="btn primary" onClick={() => void store.addFolder()}>
          添加本地文件夹
        </button>
      </div>
    )
  }

  const onPartHover = (part: DerivedPart | null, event?: React.MouseEvent) => {
    if (!part || !event) {
      setTip(null)
      return
    }
    setTip({
      text: partTooltip(part, selectedProject.mapConfirmed),
      x: event.clientX,
      y: event.clientY,
    })
  }

  if (store.mapOpen) {
    return (
      <MapSheet
        proposal={store.mapDrift ?? store.mapDraft}
        facts={store.facts}
        modules={store.modules}
        defaultName={selectedProject.name}
        gaps={store.mapGaps ?? []}
        source={store.mapDraftSource ?? 'idle'}
        drafting={Boolean(store.mapDrafting)}
        preserveProgress={Boolean(store.mapSheetPreserveProgress)}
        onConfirm={(proposal, name) => void store.confirmMap(proposal, name)}
        onDraft={(p) => void store.saveMapDraft(p)}
        onDirty={store.markMapDraftDirty}
        onCancel={() => store.setMapOpen(false)}
      />
    )
  }

  return (
    <div className="robot-view">
      <div className="robot-main">
        {!selectedProject.mapConfirmed && (
          <div className="map-banner">
            <p>架构地图尚未确认 — 机器人保持暗色轮廓，不显示进度数字。</p>
            <button type="button" className="btn primary" onClick={() => store.setMapOpen(true)}>
              打开架构地图
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
        <PartPanel
          part={selectedPart}
          advice={store.partAdvice}
          callLog={store.llmCalls}
          onToggleCriterion={(wireId, index, met) => void store.setCriterion(wireId, index, met)}
          onAddCriterion={(wireId, text) => void store.addCriterion(wireId, text)}
          onRequestAdvice={() => void store.requestAdvice()}
          onGenerateGoal={(wireId) => void store.generateGoal(wireId)}
          onConfirmDispatch={() => void store.confirmDispatch()}
          onCancelGoal={store.clearGoalDraft}
          goalDraft={store.goalDraft}
          dispatchBusy={store.dispatchBusy}
        />
      </div>
      {tip && (
        <div className="robot-tooltip" style={{ left: tip.x + 14, top: tip.y - 12 }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
