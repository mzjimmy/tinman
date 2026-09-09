import {
  displayProgressForPart,
  isLagging,
  isPlannedNotStarted,
  isStalled,
  partDisplayStatus,
  partProgress,
  projectProgress,
} from './progress'
import type { DerivedPart, DerivedProject, Part, Project, ShortLegEntry, Slot } from './types'

export function blockCoefficient(part: Part): number {
  const status = partDisplayStatus(part)
  if (status === 'blocked') return 1.5
  if (isStalled(part)) return 1.2
  return 1.0
}

export function shortLegScore(part: Part, mapConfirmed: boolean): number {
  if (!mapConfirmed || part.status === 'unmapped') return 0
  if (isPlannedNotStarted(part)) return 0
  const progress = partProgress(part)
  const u = 1 - progress / 100
  const b = blockCoefficient(part)
  return part.weight * u * b
}

export function derivePart(part: Part, project: Project): DerivedPart {
  const progress = partProgress(part)
  const displayProgress = displayProgressForPart(part, project.mapConfirmed)
  const plannedNotStarted = isPlannedNotStarted(part)
  const score = shortLegScore(part, project.mapConfirmed)
  return {
    part,
    progress,
    displayProgress,
    status: project.mapConfirmed ? partDisplayStatus(part) : part.status === 'unmapped' ? 'unmapped' : 'pending',
    shortLegScore: score,
    lagging: isLagging(part, project.parts),
    plannedNotStarted,
    rankEligible: project.mapConfirmed && !plannedNotStarted && part.status !== 'unmapped' && score > 0,
  }
}

export function deriveProject(project: Project): DerivedProject {
  const parts = project.parts.map((p) => derivePart(p, project))
  const maxShortLeg = Math.max(0, ...parts.map((p) => p.shortLegScore))
  return {
    project,
    parts,
    progress: projectProgress(project),
    displayProgress: project.mapConfirmed ? projectProgress(project) : 0,
    maxShortLeg,
    hasBlocked: parts.some((p) => p.status === 'blocked'),
  }
}

export function fleetRanking(projects: Project[], limit = 5): ShortLegEntry[] {
  const entries: ShortLegEntry[] = []
  for (const project of projects) {
    if (!project.mapConfirmed) continue
    for (const dp of deriveProject(project).parts) {
      if (!dp.rankEligible) continue
      entries.push({
        projectId: project.id,
        projectName: project.name,
        partId: dp.part.id,
        partLabel: dp.part.label,
        slot: dp.part.slot,
        progress: dp.progress,
        status: dp.status,
        score: dp.shortLegScore,
        lagging: dp.lagging,
      })
    }
  }
  entries.sort((a, b) => b.score - a.score)
  return entries.slice(0, limit)
}

export function sortProjectsByShortLeg(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => deriveProject(b).maxShortLeg - deriveProject(a).maxShortLeg)
}

export function sortProjectsByName(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export function sortProjectsByRecent(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const ta = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0
    const tb = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0
    return tb - ta
  })
}

export function topShortLegPart(project: Project): DerivedPart | undefined {
  const derived = deriveProject(project)
  return [...derived.parts].sort((a, b) => b.shortLegScore - a.shortLegScore)[0]
}

export function highestScoreSlot(project: Project): Slot | undefined {
  const top = topShortLegPart(project)
  if (!top || top.shortLegScore <= 0) return undefined
  return top.part.slot
}
