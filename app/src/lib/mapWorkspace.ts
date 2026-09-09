import type { Part, PartStatus, Project, Slot, Wire } from '../domain/types'
import { ALL_SLOTS } from '../domain/types'
import type { Facts, PartDto, WorkspaceDto, WorkspaceSummary } from './api'
import { relativeTime } from './relativeTime'

const SLOTS = new Set<string>(ALL_SLOTS)

function asSlot(s: string): Slot {
  return (SLOTS.has(s) ? s : 'torso') as Slot
}

function asStatus(s: string): PartStatus {
  if (s === 'unmapped' || s === 'pending' || s === 'in_progress' || s === 'done' || s === 'blocked') {
    return s
  }
  return 'pending'
}

export function daysSince(iso?: string | null): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return undefined
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

export function partFromDto(p: PartDto, facts?: Facts | null): Part {
  const modulePaths = modulePathsFor(p.slot, facts)
  const wires: Wire[] = p.wires.map((w) => ({
    id: w.id,
    label: w.label,
    criteria: w.criteria,
    status: asStatus(w.status) === 'unmapped' ? 'pending' : (asStatus(w.status) as Wire['status']),
    updatedAt: w.updated_at,
    lastCommitDays: daysSince(facts?.git.last_commit_at),
  }))
  return {
    id: p.id,
    slot: asSlot(p.slot),
    label: p.label,
    weight: p.weight,
    plannedStart: p.planned_start ?? undefined,
    status: asStatus(p.status),
    wires,
    facts: facts
      ? {
          files: modulePaths.length ? modulePaths : facts.tree.slice(0, 8).map((t) => t.name),
          tests:
            facts.tests.pass != null
              ? `${facts.tests.pass} passed`
              : `${facts.tests.files.length} test files (not executed)`,
          lastCommit: facts.git.last_commit_at
            ? `${facts.git.last_commit_at}${facts.git.last_commit_subject ? ` · ${facts.git.last_commit_subject}` : ''}`
            : '—',
          todoCount: facts.markers.length,
        }
      : undefined,
  }
}

function modulePathsFor(slot: string, facts?: Facts | null): string[] {
  const prefs = (facts as unknown as { modulesBySlot?: Record<string, string[]> } | null) ?? null
  return prefs?.modulesBySlot?.[slot] ?? []
}

export function projectFromWorkspace(ws: WorkspaceDto, facts?: Facts | null): Project {
  const mapConfirmed = Boolean(ws.prefs?.mapConfirmed)
  const modulesBySlot = (ws.prefs?.modulesBySlot ?? {}) as Record<string, string[]>
  const parts = ws.parts.map((p) => {
    const part = partFromDto(p, facts)
    const files = modulesBySlot[p.slot]
    if (files?.length && part.facts) part.facts = { ...part.facts, files }
    return part
  })
  const recentTasks = (facts?.git.top_files_30d ?? []).slice(0, 3).map((f) => ({
    label: f.path.split('/').pop() ?? f.path,
    ago: facts?.git.last_commit_at ? relativeTime(facts.git.last_commit_at) : `${f.commits}c`,
  }))
  return {
    id: ws.id,
    name: ws.name,
    root: ws.root_path,
    parts,
    mapConfirmed,
    recentTasks,
    lastActivityAt: (ws.prefs?.lastActivityAt as string | undefined) ?? facts?.git.last_commit_at ?? undefined,
    mapDraft: (ws.prefs?.mapDraft as Project['mapDraft']) ?? undefined,
  }
}

export function projectFromSummary(s: WorkspaceSummary): Project {
  return {
    id: s.id,
    name: s.name,
    root: s.root_path,
    parts: [],
    mapConfirmed: Boolean(s.prefs?.mapConfirmed),
    recentTasks: [],
    lastActivityAt: s.prefs?.lastActivityAt as string | undefined,
  }
}

export function modulesFromFacts(facts: Facts): string[] {
  return facts.tree.filter((t) => t.kind === 'dir').map((t) => t.name + '/')
}
