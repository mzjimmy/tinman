import { ALL_SLOTS, DEFAULT_WEIGHTS, SLOT_LABELS, type Criterion, type Slot } from './types'

export interface ProposedWire {
  label: string
  criteria: Criterion[]
}

export interface ProposedPart {
  slot: Slot
  present: boolean
  label: string
  weight: number
  plannedStart?: string
  modulePaths: string[]
  wires: ProposedWire[]
}

export interface ArchitectureProposal {
  parts: ProposedPart[]
}

export function emptyProposal(): ArchitectureProposal {
  return {
    parts: ALL_SLOTS.map((slot) => ({
      slot,
      present: slot !== 'backpack',
      label: SLOT_LABELS[slot].split(' · ')[1] ?? SLOT_LABELS[slot],
      weight: DEFAULT_WEIGHTS[slot],
      plannedStart: '',
      modulePaths: [],
      wires: [],
    })),
  }
}

export function applyProposal(
  base: ArchitectureProposal,
  incoming?: ArchitectureProposal | null,
): ArchitectureProposal {
  if (!incoming) return base
  const bySlot = new Map(incoming.parts.map((p) => [p.slot, p]))
  return {
    parts: ALL_SLOTS.map((slot) => {
      const hit = bySlot.get(slot)
      const fallback = base.parts.find((p) => p.slot === slot)!
      return hit ? { ...fallback, ...hit, slot } : fallback
    }),
  }
}

export function assignModule(
  proposal: ArchitectureProposal,
  modulePath: string,
  slot: Slot | null,
): ArchitectureProposal {
  return {
    parts: proposal.parts.map((p) => {
      const without = p.modulePaths.filter((m) => m !== modulePath)
      if (slot && p.slot === slot) {
        return { ...p, modulePaths: [...without, modulePath], present: true }
      }
      return { ...p, modulePaths: without }
    }),
  }
}

export function blankCriteria(n = 3): Criterion[] {
  return Array.from({ length: n }, () => ({ text: '', met: false, evidence: '' }))
}
