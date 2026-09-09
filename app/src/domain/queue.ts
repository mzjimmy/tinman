import type { Station, Task } from './types'

export const DEFAULT_STATION_COUNT = 2

const OCCUPYING = new Set(['running', 'waiting_dispatch'])
const PAUSEABLE = new Set(['queued', 'waiting_dispatch', 'running'])
const RELEASED = new Set(['done', 'abandoned'])

export function stationCountOf(stations: Station[] | undefined, fallback = DEFAULT_STATION_COUNT): number {
  if (stations && stations.length >= 1) return stations.length
  return fallback
}

export function occupiesStation(state: string): boolean {
  return OCCUPYING.has(state)
}

export function normalizeSharedRisk(raw: string | undefined): string | null {
  const t = (raw ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .join(' ')
  if (!t) return null
  if (['none', 'n/a', 'na', '-', '无', '没有', 'n.a.', 'null'].includes(t)) return null
  if (t.includes('与相邻部位共用约定')) return null
  return t
}

export function contentionKeys(task: Task): string[] {
  const keys: string[] = []
  const wire = task.wireId?.trim()
  if (wire) keys.push(`wire:${wire}`)
  const risk = normalizeSharedRisk(task.goal?.framework_advice?.shared_risk)
  if (risk) keys.push(`risk:${risk}`)
  return keys
}

function keysOverlap(a: string[], b: string[]): boolean {
  return a.some((k) => b.includes(k))
}

function earlier(a: Task, b: Task): boolean {
  const da = a.dispatchedAt
  const db = b.dispatchedAt
  if (da && db && da !== db) return da < db
  if (da && !db) return true
  if (!da && db) return false
  return a.id < b.id
}

export function isRunnable(task: Task, all: Task[]): boolean {
  if (task.state !== 'queued') return false
  const keys = contentionKeys(task)
  if (keys.length === 0) return true
  for (const other of all) {
    if (other.id === task.id || RELEASED.has(other.state)) continue
    if (!keysOverlap(keys, contentionKeys(other))) continue
    if (other.state !== 'queued') return false
    if (earlier(other, task)) return false
  }
  return true
}

export function deriveBoard(
  tasks: Task[],
  count = DEFAULT_STATION_COUNT,
): { stations: Station[]; queue: string[]; stationCount: number } {
  const n = Math.max(1, count)
  const stations: Station[] = Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    label: `工位 ${i + 1}`,
  }))
  const occupying = tasks.filter((t) => occupiesStation(t.state))
  const assigned = new Set<string>()
  for (const t of occupying) {
    const st = stations.find((s) => s.id === t.stationId && !s.taskId)
    if (st) {
      st.taskId = t.id
      assigned.add(t.id)
    }
  }
  for (const t of occupying) {
    if (assigned.has(t.id)) continue
    const st = stations.find((s) => !s.taskId)
    if (st) {
      st.taskId = t.id
      assigned.add(t.id)
    }
  }
  const queued = tasks
    .filter((t) => t.state === 'queued')
    .slice()
    .sort((a, b) => (earlier(a, b) ? -1 : earlier(b, a) ? 1 : 0))
  return { stations, queue: queued.map((t) => t.id), stationCount: n }
}

export function claimNext(
  tasks: Task[],
  count = DEFAULT_STATION_COUNT,
): { tasks: Task[]; claimed: Task | null } {
  const board = deriveBoard(tasks, count)
  const free = board.stations.find((s) => !s.taskId)
  if (!free) return { tasks, claimed: null }
  const queued = tasks
    .filter((t) => t.state === 'queued')
    .slice()
    .sort((a, b) => (earlier(a, b) ? -1 : earlier(b, a) ? 1 : 0))
  const next = queued.find((t) => isRunnable(t, tasks))
  if (!next) return { tasks, claimed: null }
  const claimed: Task = { ...next, state: 'running', stationId: free.id }
  return {
    tasks: tasks.map((t) => (t.id === claimed.id ? claimed : t)),
    claimed,
  }
}

export function drain(tasks: Task[], count = DEFAULT_STATION_COUNT): Task[] {
  let cur = tasks
  for (;;) {
    const { tasks: next, claimed } = claimNext(cur, count)
    if (!claimed) return next
    cur = next
  }
}

export function pauseTask(tasks: Task[], id: string, count = DEFAULT_STATION_COUNT): Task[] {
  const next = tasks.map((t) =>
    t.id === id && PAUSEABLE.has(t.state)
      ? { ...t, state: 'paused' as const, stationId: undefined }
      : t,
  )
  return drain(next, count)
}

export function resumeTask(tasks: Task[], id: string, count = DEFAULT_STATION_COUNT): Task[] {
  const next = tasks.map((t) =>
    t.id === id && t.state === 'paused'
      ? { ...t, state: 'queued' as const, stationId: undefined }
      : t,
  )
  return drain(next, count)
}

export function abandonTask(tasks: Task[], id: string, count = DEFAULT_STATION_COUNT): Task[] {
  const next = tasks.map((t) =>
    t.id === id && t.state !== 'done'
      ? { ...t, state: 'abandoned' as const, stationId: undefined }
      : t,
  )
  return drain(next, count)
}

export interface TaskSummaryView {
  tryIt: string
  built: string[]
  checked: { text: string; evidence: string }[]
  stillWrong: { text: string; reason: string }[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

export function errorFromResult(result: unknown): string | undefined {
  const rec = asRecord(result)
  if (!rec) return undefined
  const err = rec.error
  return typeof err === 'string' ? err : undefined
}

export function taskSummary(task: Task): TaskSummaryView | null {
  if (task.state !== 'done' && task.state !== 'checking' && task.state !== 'failed') {
    return null
  }
  const rec = asRecord(task.result)
  const summary = rec ? asRecord(rec.summary) : null
  const verification = rec ? asRecord(rec.verification) : null
  const criteriaRaw = verification?.criteria
  const criteria = Array.isArray(criteriaRaw)
    ? criteriaRaw.map((c) => {
        const row = asRecord(c)
        return {
          text: String(row?.text ?? ''),
          met: Boolean(row?.met),
          evidence: String(row?.evidence ?? ''),
        }
      })
    : []
  const tryIt =
    (typeof summary?.try_it === 'string' && summary.try_it) ||
    task.worktreePath ||
    task.goal.workspace.worktree_path ||
    ''
  const built = Array.isArray(summary?.built)
    ? summary.built.map(String)
    : []
  const checked = Array.isArray(summary?.checked)
    ? (summary.checked as unknown[]).map((c) => {
        const row = asRecord(c)
        return { text: String(row?.text ?? ''), evidence: String(row?.evidence ?? '') }
      })
    : criteria.filter((c) => c.met).map((c) => ({ text: c.text, evidence: c.evidence }))
  const stillWrong = Array.isArray(summary?.still_wrong)
    ? (summary.still_wrong as unknown[]).map((c) => {
        const row = asRecord(c)
        return {
          text: String(row?.text ?? ''),
          reason: String(row?.evidence ?? row?.reason ?? ''),
        }
      })
    : criteria.filter((c) => !c.met).map((c) => ({ text: c.text, reason: c.evidence }))
  if (task.state === 'failed' && stillWrong.length === 0) {
    stillWrong.push({
      text: '任务失败',
      reason: errorFromResult(task.result) ?? 'process failed',
    })
  }
  return { tryIt, built, checked, stillWrong }
}
