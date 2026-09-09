import type { Slot } from '../domain/types'
import type { DerivedPart } from '../domain/types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
  rx: number
}

export const GROUND_Y = 244

export function layoutV2(partsBySlot: Partial<Record<Slot, { weight: number }>>): Partial<Record<Slot, Rect>> {
  const out: Partial<Record<Slot, Rect>> = {}
  const torso = partsBySlot.torso
  const tW = torso ? 40 + torso.weight * 12 : 64
  const tX = 100 - tW / 2

  if (torso) out.torso = { x: tX, y: 74, w: tW, h: 80, rx: 10 }
  if (partsBySlot.head) {
    const hw = 40 + partsBySlot.head.weight * 6
    out.head = { x: 100 - hw / 2, y: 18, w: hw, h: 50, rx: 12 }
  }
  if (partsBySlot.left_arm) {
    const lw = 10 + partsBySlot.left_arm.weight * 7
    out.left_arm = { x: tX - 7 - lw, y: 80, w: lw, h: 62, rx: 9 }
  }
  if (partsBySlot.right_arm) {
    const rw = 10 + partsBySlot.right_arm.weight * 7
    out.right_arm = { x: tX + tW + 7, y: 80, w: rw, h: 62, rx: 9 }
  }

  const llw = partsBySlot.left_leg ? 12 + partsBySlot.left_leg.weight * 9 : 0
  const rlw = partsBySlot.right_leg ? 12 + partsBySlot.right_leg.weight * 9 : 0
  let sx = 100 - (llw + rlw + (llw && rlw ? 5 : 0)) / 2
  if (partsBySlot.left_leg) {
    out.left_leg = { x: sx, y: 158, w: llw, h: 74, rx: 10 }
    sx += llw + 5
  }
  if (partsBySlot.right_leg) {
    out.right_leg = { x: sx, y: 158, w: rlw, h: 74, rx: 10 }
  }

  if (partsBySlot.backpack) {
    const bw = 18 + partsBySlot.backpack.weight * 4
    out.backpack = { x: 100 - bw / 2, y: 58, w: bw, h: 14, rx: 5 }
  } else {
    out.backpack = { x: 100 - 12, y: 58, w: 24, h: 14, rx: 5 }
  }

  return out
}

export function ghostRect(slot: Slot, geo: Partial<Record<Slot, Rect>>): Rect {
  const existing = geo[slot]
  if (existing) return existing
  const ghostLayout = layoutV2({
    torso: { weight: 3 },
    head: { weight: 2 },
    left_arm: { weight: 2 },
    right_arm: { weight: 2 },
    left_leg: { weight: 2 },
    right_leg: { weight: 2 },
    backpack: { weight: 1 },
  })
  return ghostLayout[slot] ?? { x: 80, y: 100, w: 40, h: 40, rx: 8 }
}

export function wireLines(
  _slot: Slot,
  rect: Rect,
  wires: { id: string; progress: number }[],
  max = 6,
): { id: string; x1: number; y1: number; x2: number; y2: number; done: boolean }[] {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const slice = wires.slice(0, max)
  return slice.map((w, i) => {
    const angle = (Math.PI * 2 * i) / Math.max(slice.length, 1) - Math.PI / 2
    const len = Math.min(rect.w, rect.h) * 0.45
    return {
      id: w.id,
      x1: cx,
      y1: cy,
      x2: cx + Math.cos(angle) * len,
      y2: cy + Math.sin(angle) * len,
      done: w.progress >= 100,
    }
  })
}

export function isAllDone(parts: DerivedPart[]): boolean {
  const mapped = parts.filter((p) => p.part.status !== 'unmapped')
  return mapped.length > 0 && mapped.every((p) => p.displayProgress >= 100)
}

export function partCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}
