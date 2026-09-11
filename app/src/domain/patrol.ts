export interface PatrolPolicy {
  intervalMs: number
  maxBackoffMs: number
}

export interface PatrolRecord {
  projectId: string
  lastSuccessAt: number | null
  lastAttemptAt: number | null
  failures: number
}

export const DEFAULT_PATROL_POLICY: PatrolPolicy = {
  intervalMs: 30 * 60 * 1000,
  maxBackoffMs: 8 * 60 * 60 * 1000,
}

export function emptyPatrolRecord(projectId: string): PatrolRecord {
  return {
    projectId,
    lastSuccessAt: null,
    lastAttemptAt: null,
    failures: 0,
  }
}

function backoffMs(failures: number, policy: PatrolPolicy): number {
  let wait = policy.intervalMs
  for (let i = 0; i < failures; i++) {
    wait = Math.min(policy.maxBackoffMs, wait * 2)
    if (wait >= policy.maxBackoffMs) return policy.maxBackoffMs
  }
  return wait
}

function nextDueAt(rec: PatrolRecord, policy: PatrolPolicy): number {
  if (rec.failures > 0) {
    const from = rec.lastAttemptAt ?? rec.lastSuccessAt ?? 0
    return from + backoffMs(rec.failures, policy)
  }
  if (rec.lastSuccessAt == null) return 0
  return rec.lastSuccessAt + policy.intervalMs
}

export function dueProjects(records: PatrolRecord[], now: number, policy: PatrolPolicy): string[] {
  return records
    .filter((rec) => now >= nextDueAt(rec, policy))
    .sort((a, b) => {
      const ta = a.lastSuccessAt ?? 0
      const tb = b.lastSuccessAt ?? 0
      if (ta !== tb) return ta - tb
      return a.projectId.localeCompare(b.projectId)
    })
    .map((rec) => rec.projectId)
}

export function recordSuccess(rec: PatrolRecord, now: number, _policy: PatrolPolicy): PatrolRecord {
  return {
    projectId: rec.projectId,
    lastSuccessAt: now,
    lastAttemptAt: now,
    failures: 0,
  }
}

export function recordFailure(rec: PatrolRecord, now: number, _policy: PatrolPolicy): PatrolRecord {
  return {
    projectId: rec.projectId,
    lastSuccessAt: rec.lastSuccessAt,
    lastAttemptAt: now,
    failures: rec.failures + 1,
  }
}
