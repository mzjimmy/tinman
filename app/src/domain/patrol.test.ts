import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PATROL_POLICY,
  dueProjects,
  emptyPatrolRecord,
  recordFailure,
  recordSuccess,
} from './patrol'

const T0 = Date.parse('2026-09-11T00:00:00Z')
const MIN = 60_000

describe('patrol (R4-C5): one resident loop across every project, not one call per repo', () => {
  it('a never-scanned project is due immediately', () => {
    const due = dueProjects([emptyPatrolRecord('a')], T0, DEFAULT_PATROL_POLICY)
    expect(due).toEqual(['a'])
  })

  it('a just-scanned project is not due again yet', () => {
    const rec = recordSuccess(emptyPatrolRecord('a'), T0, DEFAULT_PATROL_POLICY)
    expect(dueProjects([rec], T0 + MIN, DEFAULT_PATROL_POLICY)).toEqual([])
  })

  it('becomes due once the interval has elapsed', () => {
    const rec = recordSuccess(emptyPatrolRecord('a'), T0, DEFAULT_PATROL_POLICY)
    expect(dueProjects([rec], T0 + DEFAULT_PATROL_POLICY.intervalMs + 1, DEFAULT_PATROL_POLICY)).toEqual(['a'])
  })

  it('patrols the stalest project first, so the fleet stays evenly fresh', () => {
    const a = recordSuccess(emptyPatrolRecord('a'), T0 - 10 * MIN, DEFAULT_PATROL_POLICY)
    const b = recordSuccess(emptyPatrolRecord('b'), T0 - 90 * MIN, DEFAULT_PATROL_POLICY)
    const c = recordSuccess(emptyPatrolRecord('c'), T0 - 50 * MIN, DEFAULT_PATROL_POLICY)
    const now = T0 + DEFAULT_PATROL_POLICY.intervalMs * 4
    expect(dueProjects([a, b, c], now, DEFAULT_PATROL_POLICY)).toEqual(['b', 'c', 'a'])
  })

  it('backs off exponentially after a failure instead of hammering a broken repo', () => {
    const policy = { ...DEFAULT_PATROL_POLICY, intervalMs: 10 * MIN, maxBackoffMs: 8 * 60 * MIN }
    const once = recordFailure(emptyPatrolRecord('a'), T0, policy)
    const twice = recordFailure(once, T0, policy)
    expect(once.failures).toBe(1)
    expect(twice.failures).toBe(2)
    expect(dueProjects([once], T0 + 15 * MIN, policy)).toEqual([])
    expect(dueProjects([once], T0 + 25 * MIN, policy)).toEqual(['a'])
    expect(dueProjects([twice], T0 + 25 * MIN, policy)).toEqual([])
  })

  it('caps the backoff so a repo is never abandoned forever', () => {
    const policy = { ...DEFAULT_PATROL_POLICY, intervalMs: 10 * MIN, maxBackoffMs: 60 * MIN }
    let rec = emptyPatrolRecord('a')
    for (let i = 0; i < 20; i++) rec = recordFailure(rec, T0, policy)
    expect(dueProjects([rec], T0 + 61 * MIN, policy)).toEqual(['a'])
  })

  it('a success clears the backoff', () => {
    const policy = { ...DEFAULT_PATROL_POLICY, intervalMs: 10 * MIN, maxBackoffMs: 60 * MIN }
    const failed = recordFailure(recordFailure(emptyPatrolRecord('a'), T0, policy), T0, policy)
    const ok = recordSuccess(failed, T0, policy)
    expect(ok.failures).toBe(0)
    expect(dueProjects([ok], T0 + 11 * MIN, policy)).toEqual(['a'])
  })

  it('records are plain serialisable data, so the loop survives a restart', () => {
    const rec = recordSuccess(emptyPatrolRecord('a'), T0, DEFAULT_PATROL_POLICY)
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec)
  })
})
