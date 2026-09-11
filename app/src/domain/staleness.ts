import type { Facts } from '../lib/api'
import type { Part, Project } from './types'

/**
 * `isStalled` in progress.ts is `lastCommitDays > 30`. The scanner's window is
 * `git log --since=30 days ago` (scanner.rs collect_git). Those two 30s agreeing
 * is a coincidence of two constants, not a shared one. If either drifts, a part
 * can look fresh in the window and stalled on the coefficient, or the reverse.
 */
const STALE_AFTER_DAYS = 30

/**
 * scanner.rs `collect_git` ends with `top.truncate(10)`. Absence from a full
 * list is not evidence the module was quiet — it may have been busy and still
 * missed the top 10. Treating that as stale would invent a short leg.
 */
const TOP_FILES_30D_CAP = 10

function daysSince(iso: string | null | undefined, now: number): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return undefined
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

function fileUnderModule(filePath: string, modulePath: string): boolean {
  const prefix = modulePath.endsWith('/') ? modulePath : `${modulePath}/`
  const bare = modulePath.replace(/\/+$/, '')
  return filePath === bare || filePath.startsWith(prefix)
}

function mappedModulesOf(part: Part): string[] {
  const files = part.facts?.files ?? []
  // confirmMap stores dirs with a trailing slash; the tree-name display
  // fallback in partFromDto does not. No slash → not a map, ignore it.
  return files.filter((f) => f.includes('/'))
}

/**
 * The aggregate emits every directory prefix, so a touched directory at or below
 * the mapped module always appears in its own right. Matching only downward is
 * therefore both sufficient and necessary: matching upward too would let an
 * abandoned `packages/web/` borrow the activity of a busy sibling `packages/api/`
 * through their shared parent.
 */
function dirTouchesModule(dir: string, modulePath: string): boolean {
  return fileUnderModule(dir, modulePath)
}

export function partStalenessDays(
  facts: Facts | null | undefined,
  modulePaths: string[],
  now?: number,
): number | undefined {
  const recency = daysSince(facts?.git.last_commit_at, now ?? Date.now())
  if (recency === undefined) return undefined
  if (modulePaths.length === 0) return recency

  // Uncapped aggregate is authority when present (including empty). Missing
  // means older cached facts — fall through to the round-6 file-list path.
  const dirs = facts?.git.dirs_30d
  if (dirs !== undefined) {
    const touched = modulePaths.some((mod) => dirs.some((d) => dirTouchesModule(d.dir, mod)))
    if (touched) return recency
    return Math.max(recency, STALE_AFTER_DAYS + 1)
  }

  const top = facts?.git.top_files_30d ?? []
  const touched = modulePaths.some((mod) => top.some((f) => fileUnderModule(f.path, mod)))
  if (touched) return recency

  // List hit the scanner cap: "not in the list" ≠ "not in the window".
  if (top.length >= TOP_FILES_30D_CAP) return recency

  // Mapped, window is complete, module never appears: stale by definition,
  // even if the repo itself committed this morning.
  return Math.max(recency, STALE_AFTER_DAYS + 1)
}

export function applyStalenessToProject(
  project: Project,
  facts: Facts | null | undefined,
  now?: number,
): Project {
  return {
    ...project,
    parts: project.parts.map((part) => {
      const days = partStalenessDays(facts, mappedModulesOf(part), now)
      return {
        ...part,
        wires: part.wires.map((wire) => ({ ...wire, lastCommitDays: days })),
      }
    }),
  }
}
