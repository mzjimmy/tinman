import { describe, expect, expectTypeOf, it } from 'vitest'
import { wireProgress, withCriteria } from './progress'
import { makeWire } from './fixtures'
import type { Criterion, Wire } from './types'

/** Write-side shape mirroring the Rust WireInput. No progress field. */
export type WireWrite = {
  id?: string
  label: string
  criteria: Criterion[]
  blocked?: boolean
}

describe('persistence (C3)', () => {
  it('round-trips criteria and re-derives progress', () => {
    const wire = makeWire({ met: 2, total: 5, label: 'core' })
    const serialized = JSON.stringify({
      id: wire.id,
      label: wire.label,
      criteria: wire.criteria,
      blocked: false,
    } satisfies WireWrite)
    const loaded = JSON.parse(serialized) as WireWrite
    const restored: Wire = {
      id: loaded.id ?? 'x',
      label: loaded.label,
      criteria: loaded.criteria,
      status: loaded.blocked ? 'blocked' : 'in_progress',
    }
    expect(wireProgress(restored)).toBe(40)
    expect(loaded.criteria).toEqual(wire.criteria)
  })

  it('rejects a progress field on the write type', () => {
    expectTypeOf<WireWrite>().not.toHaveProperty('progress')
    const sample: WireWrite = {
      label: 'ci',
      criteria: makeWire({ met: 2, total: 5 }).criteria,
    }
    expect(Object.prototype.hasOwnProperty.call(sample, 'progress')).toBe(false)
    expect(JSON.stringify(sample)).not.toMatch(/"progress"/)
  })

  it('withCriteria is the only mutation path and ignores any injected progress', () => {
    const wire = makeWire({ met: 0, total: 5 })
    const next = withCriteria(wire, wire.criteria.map((c, i) => ({ ...c, met: i < 2 })))
    expect(wireProgress(next)).toBe(40)
    const smuggled = { ...next, progress: 99 } as Wire & { progress: number }
    expect(wireProgress(smuggled)).toBe(40)
  })
})
