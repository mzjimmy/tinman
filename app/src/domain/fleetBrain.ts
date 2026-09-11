import type { Facts } from '../lib/api'
import { fleetRanking, topShortLegPart } from './shortLeg'
import type { Part, Project, ShortLegEntry } from './types'

/**
 * `local` — the consumer names the provider through a local protocol
 * (workspace:/file:/link:/portal:), so the two really are the same fleet.
 * `name`  — only the package name matched. A fleet project called `web` or
 * `core-api` will match any consumer depending on a registry package of that
 * name, so this is the weaker evidence and must read as such to the user.
 */
export type FleetLinkConfidence = 'local' | 'name'

export interface FleetLink {
  fromProjectId: string
  toProjectId: string
  fromPartId: string
  confidence: FleetLinkConfidence
  reason: string
}

const RUNTIME_BAGS = new Set([
  'dependencies',
  'peerDependencies',
  'peer_dependencies',
  'optionalDependencies',
  'optional_dependencies',
])

const LOCAL_PROTOCOL = /^(workspace|file|link|portal):/i

/** Dependency name -> whether the version spec points at a local checkout. */
function keysOfNameMap(value: unknown): { name: string; local: boolean }[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((name) => ({ name, local: false }))
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([k]) => k.length > 0)
      .map(([name, spec]) => ({
        name,
        local: typeof spec === 'string' && LOCAL_PROTOCOL.test(spec),
      }))
  }
  return []
}

function depNamesFromData(data: unknown): { name: string; local: boolean }[] {
  if (!data || typeof data !== 'object') return []
  const rec = data as Record<string, unknown>
  const names: { name: string; local: boolean }[] = []
  for (const [key, value] of Object.entries(rec)) {
    if (/dev/i.test(key)) continue
    if (RUNTIME_BAGS.has(key)) names.push(...keysOfNameMap(value))
  }
  return names
}

function consumerDepNames(facts: Facts | undefined): { name: string; local: boolean }[] {
  if (!facts || !Array.isArray(facts.dependencies)) return []
  const names: { name: string; local: boolean }[] = []
  for (const entry of facts.dependencies) {
    if (!entry || typeof entry !== 'object') continue
    try {
      names.push(...depNamesFromData(entry.data))
    } catch {
      // malformed `data` is a skip, never a throw
    }
  }
  return names
}

function rootBasename(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function providerAliases(provider: Project): string[] {
  const names = [provider.name, rootBasename(provider.root)].filter((s) => s.length > 0)
  return [...new Set(names)]
}

/** Mapped right_arm, else mapped torso, else the provider's current short leg. No mapped part → no link. */
function blamePart(provider: Project): Part | undefined {
  const mapped = provider.parts.filter((p) => p.status !== 'unmapped')
  const rightArm = mapped.find((p) => p.slot === 'right_arm')
  if (rightArm) return rightArm
  const torso = mapped.find((p) => p.slot === 'torso')
  if (torso) return torso
  const top = topShortLegPart(provider)
  if (top && top.shortLegScore > 0) return top.part
  return undefined
}

export function detectFleetLinks(
  projects: Project[],
  factsByProjectId: Record<string, Facts>,
): FleetLink[] {
  const links: FleetLink[] = []
  const seen = new Set<string>()

  for (const consumer of projects) {
    const names = consumerDepNames(factsByProjectId[consumer.id])
    if (names.length === 0) continue
    const byName = new Map(names.map((n) => [n.name, n]))

    for (const provider of projects) {
      if (provider.id === consumer.id) continue
      if (!provider.mapConfirmed) continue
      const aliases = providerAliases(provider)
      const hitName = aliases.find((a) => byName.has(a))
      if (!hitName) continue
      const hit = hitName
      const confidence: FleetLinkConfidence = byName.get(hitName)!.local ? 'local' : 'name'
      const part = blamePart(provider)
      if (!part) continue
      const key = `${provider.id}\0${consumer.id}\0${part.id}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({
        fromProjectId: provider.id,
        toProjectId: consumer.id,
        fromPartId: part.id,
        confidence,
        reason:
          confidence === 'local'
            ? `${consumer.name} 依赖本地的 ${hit}，所以要先做 ${provider.name} 的${part.label}`
            : `${consumer.name} 依赖 ${hit}，与项目「${provider.name}」同名（只是名字对上，未必是同一个），可能要先做它的${part.label}`,
      })
    }
  }
  return links
}

export function applyFleetBlocking(
  ranking: ShortLegEntry[],
  links: FleetLink[],
): ShortLegEntry[] {
  if (links.length === 0) return ranking.slice()
  const blocking = new Set(links.map((l) => `${l.fromProjectId}:${l.fromPartId}`))
  const blockers: ShortLegEntry[] = []
  const rest: ShortLegEntry[] = []
  for (const entry of ranking) {
    if (blocking.has(`${entry.projectId}:${entry.partId}`)) blockers.push(entry)
    else rest.push(entry)
  }
  return [...blockers, ...rest]
}

export function fleetBrief(ranking: ShortLegEntry[], links: FleetLink[]): string {
  if (ranking.length === 0) return '这支舰队还没有可以动手的部位。'
  const top = ranking[0]!
  const outgoing = links.filter(
    (l) => l.fromProjectId === top.projectId && l.fromPartId === top.partId,
  )
  if (outgoing.length > 0) {
    const blocked = ranking.find((e) => e.projectId === outgoing[0]!.toProjectId)
    if (blocked) {
      return `先做 ${top.projectName} 的${top.partLabel}：它挡住了 ${blocked.projectName}。`
    }
    return outgoing[0]!.reason
  }
  const incoming = links.find((l) => l.toProjectId === top.projectId)
  if (incoming) return incoming.reason
  return `先做 ${top.projectName} 的${top.partLabel}。`
}

/**
 * Rank the fleet, lift blockers, THEN slice. Doing it in this order is the whole
 * point: `applyFleetBlocking` can only reorder what it is handed, so a blocker
 * sitting outside a pre-sliced Top 5 would be discarded before it could be
 * lifted — the fleet brain failing silently exactly when the fleet is big enough
 * to need it. Callers get the safe order by construction rather than by
 * remembering to pass a large limit.
 */
export function fleetRankingWithBlocking(
  projects: Project[],
  factsByProjectId: Record<string, Facts>,
  limit = 5,
): ShortLegEntry[] {
  const full = fleetRanking(projects, Number.POSITIVE_INFINITY)
  const links = detectFleetLinks(projects, factsByProjectId)
  return applyFleetBlocking(full, links).slice(0, limit)
}
