import type { Criterion, Part, PartStatus, Project, Wire } from './types'

export function wireProgress(wire: Wire): number {
  if (wire.criteria.length === 0) return 0
  const met = wire.criteria.filter((c) => c.met).length
  return Math.round((met / wire.criteria.length) * 100)
}

export function deriveWireStatus(wire: Wire): Exclude<PartStatus, 'unmapped'> {
  if (wire.status === 'blocked') return 'blocked'
  const p = wireProgress(wire)
  if (p >= 100) return 'done'
  if (p > 0) return 'in_progress'
  return wire.status === 'done' ? 'done' : wire.status === 'in_progress' ? 'in_progress' : 'pending'
}

export function partProgress(part: Part): number {
  if (part.status === 'unmapped') return 0
  if (part.wires.length === 0) return 0
  const total = part.wires.reduce((sum, w) => sum + wireProgress(w), 0)
  return Math.round(total / part.wires.length)
}

export function partDisplayStatus(part: Part): PartStatus {
  if (part.status === 'unmapped') return 'unmapped'
  if (part.wires.length === 0) return 'pending'
  if (part.status === 'blocked' || part.wires.some((w) => w.status === 'blocked')) return 'blocked'
  const p = partProgress(part)
  if (p >= 100) return 'done'
  if (p > 0) return 'in_progress'
  return part.status
}

export function projectProgress(project: Project): number {
  const mapped = project.parts.filter((p) => p.status !== 'unmapped')
  if (mapped.length === 0) return 0
  const tw = mapped.reduce((s, p) => s + p.weight, 0)
  const sp = mapped.reduce((s, p) => s + p.weight * partProgress(p), 0)
  return tw ? Math.round(sp / tw) : 0
}

export function displayProgressForPart(part: Part, mapConfirmed: boolean): number {
  if (!mapConfirmed) return 0
  if (part.status === 'unmapped') return 0
  return partProgress(part)
}

export function displayProgressForProject(project: Project): number {
  if (!project.mapConfirmed) return 0
  return projectProgress(project)
}

export function markCriterionMet(wire: Wire, index: number, met: boolean): Wire {
  const criteria: Criterion[] = wire.criteria.map((c, i) =>
    i === index ? { ...c, met } : c,
  )
  return { ...wire, criteria }
}

export function applyWireUpdate(project: Project, wireId: string, updater: (w: Wire) => Wire): Project {
  return {
    ...project,
    parts: project.parts.map((part) => ({
      ...part,
      wires: part.wires.map((w) => (w.id === wireId ? updater(w) : w)),
    })),
  }
}

export function completeTaskCriteria(project: Project, wireId: string): Project {
  return applyWireUpdate(project, wireId, (wire) => ({
    ...wire,
    status: 'done',
    criteria: wire.criteria.map((c) => ({ ...c, met: true })),
  }))
}

export function medianProgress(parts: Part[]): number {
  const values = parts
    .filter((p) => p.status !== 'unmapped')
    .map((p) => partProgress(p))
    .sort((a, b) => a - b)
  if (values.length === 0) return 0
  const mid = Math.floor(values.length / 2)
  return values.length % 2 ? values[mid]! : Math.round((values[mid - 1]! + values[mid]!) / 2)
}

export function isPlannedNotStarted(part: Part, now = new Date()): boolean {
  if (!part.plannedStart) return false
  return new Date(part.plannedStart) > now
}

export function isStalled(part: Part): boolean {
  if (partProgress(part) >= 100) return false
  const days = part.wires.reduce((max, w) => Math.max(max, w.lastCommitDays ?? 0), 0)
  return days > 30
}

export function isLagging(part: Part, allParts: Part[]): boolean {
  if (isPlannedNotStarted(part)) return false
  const p = partProgress(part)
  if (p === 0 && partDisplayStatus(part) === 'pending') return false
  const med = medianProgress(allParts)
  return med - p >= 20
}

/** The only legal mutation that changes progress: flipping criteria. */
export function withCriteria(wire: Wire, criteria: Criterion[]): Wire {
  const { id, label, status, updatedAt, lastCommitDays } = wire
  return { id, label, status, updatedAt, lastCommitDays, criteria }
}
