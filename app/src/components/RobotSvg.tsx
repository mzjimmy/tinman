import { ALL_SLOTS, SLOT_LABELS, STATUS_LABELS, type DerivedPart, type Slot } from '../domain/types'
import { partDisplayStatus, wireProgress } from '../domain/progress'
import {
  GROUND_Y,
  ghostRect,
  isAllDone,
  layoutV2,
  type Rect,
  wireLines,
} from '../robot/geometry'

interface RobotSvgProps {
  uid: string
  parts: DerivedPart[]
  mapConfirmed: boolean
  highlightSlot?: Slot
  shortLegSlot?: Slot
  compact?: boolean
  onPartClick?: (partId: string) => void
  onPartHover?: (part: DerivedPart | null, event?: React.MouseEvent) => void
  ready?: boolean
}

function weightMap(parts: DerivedPart[]): Partial<Record<Slot, { weight: number }>> {
  const m: Partial<Record<Slot, { weight: number }>> = {}
  for (const p of parts) {
    if (p.part.status !== 'unmapped') m[p.part.slot] = { weight: p.part.weight }
  }
  return m
}

export function partTooltip(part: DerivedPart, mapConfirmed: boolean): string {
  const slot = SLOT_LABELS[part.part.slot]
  if (!mapConfirmed) {
    return `${part.part.label} ｜ ${slot}\n待确认架构地图`
  }
  const status = partDisplayStatus(part.part)
  const lines = [`${part.part.label} ｜ ${slot}`, STATUS_LABELS[status]]
  if (part.part.wires.length > 0) {
    lines[1] = `${part.displayProgress}%　${STATUS_LABELS[status]}`
  }
  if (part.shortLegScore > 0) lines.push(`短腿分数 ${part.shortLegScore.toFixed(1)}`)
  if (part.lagging) lines.push('落后于其他部位')
  if (part.plannedNotStarted) lines.push('按计划未开工')
  return lines.join('\n')
}

export function RobotSvg({
  uid,
  parts,
  mapConfirmed,
  highlightSlot,
  shortLegSlot,
  compact = false,
  onPartClick,
  onPartHover,
  ready,
}: RobotSvgProps) {
  const bySlot = Object.fromEntries(parts.map((p) => [p.part.slot, p])) as Partial<
    Record<Slot, DerivedPart>
  >
  const geo = layoutV2(weightMap(parts))
  const allDone = isAllDone(parts) && mapConfirmed
  const showReady = ready ?? allDone

  return (
    <svg
      className={`robot-svg${compact ? ' compact' : ''}${showReady ? ' ready' : ''}`}
      viewBox="0 0 200 260"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="项目机器人"
    >
      <defs>
        <pattern
          id={`${uid}-hatch`}
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--red)" strokeWidth="2.6" />
        </pattern>
      </defs>

      <line
        className={`ground${bySlot.left_leg || bySlot.right_leg ? '' : ' off'}`}
        x1="30"
        y1={GROUND_Y}
        x2="170"
        y2={GROUND_Y}
      />

      {!mapConfirmed && (
        <text x="100" y="252" textAnchor="middle" className="map-prompt">
          待确认架构地图
        </text>
      )}

      {renderDecor(bySlot, geo)}

      {ALL_SLOTS.map((slot) => {
        const dp = bySlot[slot]
        const rect = dp ? geo[slot] ?? ghostRect(slot, geo) : ghostRect(slot, geo)
        if (!rect) return null
        return (
          <g key={slot}>
            {renderUnit(uid, slot, rect, dp, mapConfirmed, highlightSlot, shortLegSlot, onPartClick, onPartHover)}
            {dp && mapConfirmed && dp.part.wires.length > 0 && renderWires(rect, dp)}
          </g>
        )
      })}

      {mapConfirmed && renderEyes(bySlot.head, geo.head)}
      {showReady && (
        <text x="178" y="24" className="ready-badge">
          READY
        </text>
      )}
    </svg>
  )
}

function renderUnit(
  uid: string,
  slot: Slot,
  rect: { x: number; y: number; w: number; h: number; rx: number },
  dp: DerivedPart | undefined,
  mapConfirmed: boolean,
  highlightSlot?: Slot,
  shortLegSlot?: Slot,
  onPartClick?: (partId: string) => void,
  onPartHover?: (part: DerivedPart | null, event?: React.MouseEvent) => void,
) {
  const isGhost = !dp || dp.part.status === 'unmapped'
  const status = !mapConfirmed ? 'unmapped' : isGhost ? 'unmapped' : dp!.status
  const progress = mapConfirmed && dp && dp.part.wires.length > 0 ? dp.displayProgress : 0
  const clipId = `${uid}-clip-${slot}`
  const fh = rect.h * (progress / 100)
  const fy = rect.y + rect.h - fh
  const tooltip = dp
    ? partTooltip(dp, mapConfirmed)
    : `${SLOT_LABELS[slot]}\n未映射`

  if (isGhost || !mapConfirmed) {
    return (
      <g
        className={`unit ghost-unit${highlightSlot === slot ? ' selected' : ''}`}
        data-status="unmapped"
        onClick={() => dp && onPartClick?.(dp.part.id)}
        onMouseEnter={(e) => onPartHover?.(dp ?? null, e)}
        onMouseMove={(e) => onPartHover?.(dp ?? null, e)}
        onMouseLeave={() => onPartHover?.(null)}
      >
        <title>{tooltip}</title>
        <rect className="ghost" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={rect.rx} />
      </g>
    )
  }

  return (
    <g
      className={`unit${status === 'blocked' ? ' blocked' : ''}${highlightSlot === slot ? ' selected' : ''}${shortLegSlot === slot ? ' short-leg' : ''}`}
      data-status={status}
      tabIndex={0}
      onClick={() => onPartClick?.(dp!.part.id)}
      onMouseEnter={(e) => onPartHover?.(dp!, e)}
      onMouseMove={(e) => onPartHover?.(dp!, e)}
      onMouseLeave={() => onPartHover?.(null)}
    >
      <title>{tooltip}</title>
      <clipPath id={clipId}>
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={rect.rx} />
      </clipPath>
      <rect className="bg" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={rect.rx} />
      {fh > 0 && (
        <rect className="fill" clipPath={`url(#${clipId})`} x={rect.x} y={fy} width={rect.w} height={fh} />
      )}
      {status === 'blocked' && (
        <rect
          clipPath={`url(#${clipId})`}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          fill={`url(#${uid}-hatch)`}
        />
      )}
      <rect className="edge" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={rect.rx} />
      {shortLegSlot === slot && dp!.shortLegScore > 0 && (
        <text x={rect.x + rect.w - 2} y={rect.y + 10} className="short-badge" textAnchor="end">
          短腿
        </text>
      )}
    </g>
  )
}

function renderWires(rect: Rect, dp: DerivedPart) {
  const lines = wireLines(
    dp.part.slot,
    rect,
    dp.part.wires.map((w) => ({ id: w.id, progress: wireProgress(w) })),
  )
  const extra = dp.part.wires.length - lines.length
  return (
    <g className="wires">
      {lines.map((l: { id: string; x1: number; y1: number; x2: number; y2: number; done: boolean }) => (
        <line
          key={l.id}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          className={l.done ? 'wire done' : 'wire pending'}
        />
      ))}
      {extra > 0 && (
        <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2} className="wire-more">
          +{extra}
        </text>
      )}
    </g>
  )
}

function renderDecor(bySlot: Partial<Record<Slot, DerivedPart>>, geo: Partial<Record<Slot, Rect>>) {
  let s = null
  const head = geo.head
  const torso = geo.torso
  if (head && bySlot.head) {
    s = (
      <>
        <line className="decor" x1="100" y1={head.y} x2="100" y2={head.y - 11} />
        <circle className={`bulb${bySlot.head.status === 'done' ? ' on' : ''}`} cx="100" cy={head.y - 14} r="3.2" />
      </>
    )
  }
  const neck =
    head && torso ? (
      <rect
        className="decor-fill"
        x="93"
        y={head.y + head.h - 1}
        width="14"
        height={torso.y - head.y - head.h + 2}
        rx="3"
      />
    ) : null

  const la = geo.left_arm
  const fingers =
    la && bySlot.left_arm ? (
      <>
        {[1, 2, 3].map((i) => {
          const fx = la.x + (la.w * i) / 4
          const yb = la.y + la.h
          return <line key={i} className="decor" x1={fx} y1={yb + 1} x2={fx} y2={yb + 9} />
        })}
      </>
    ) : null

  const ra = geo.right_arm
  const plug =
    ra && bySlot.right_arm ? (
      <>
        <rect className="decor-fill" x={ra.x + ra.w / 2 - 8} y={ra.y + ra.h + 1} width="16" height="6" rx="2" />
        <line className="decor" x1={ra.x + ra.w / 2 - 4} y1={ra.y + ra.h + 7} x2={ra.x + ra.w / 2 - 4} y2={ra.y + ra.h + 13} />
        <line className="decor" x1={ra.x + ra.w / 2 + 4} y1={ra.y + ra.h + 7} x2={ra.x + ra.w / 2 + 4} y2={ra.y + ra.h + 13} />
      </>
    ) : null

  const ll = geo.left_leg
  const base =
    ll && bySlot.left_leg ? (
      <rect className="decor-fill" x={ll.x - 5} y={ll.y + ll.h - 1} width={ll.w + 10} height="7" rx="2" />
    ) : null

  const rl = geo.right_leg
  const wheels =
    rl && bySlot.right_leg ? (
      <>
        <circle className="decor-fill" cx={rl.x + rl.w * 0.28} cy={rl.y + rl.h + 4} r="5" />
        <circle className="decor-fill" cx={rl.x + rl.w * 0.72} cy={rl.y + rl.h + 4} r="5" />
      </>
    ) : null

  return (
    <>
      {s}
      {neck}
      {fingers}
      {plug}
      {base}
      {wheels}
    </>
  )
}

function renderEyes(head: DerivedPart | undefined, geoHead?: { x: number; y: number; w: number }) {
  if (!head || !geoHead) return null
  const dx = geoHead.w / 4.6
  const lit = head.displayProgress >= 100
  return (
    <>
      <circle className={`eye${lit ? ' on' : ''}`} cx={100 - dx} cy={geoHead.y + 21} r="4.5" />
      <circle className={`eye${lit ? ' on' : ''}`} cx={100 + dx} cy={geoHead.y + 21} r="4.5" />
    </>
  )
}
