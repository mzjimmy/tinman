import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  displayProgressForPart,
  displayProgressForProject,
  partDisplayStatus,
  partProgress,
  projectProgress,
  wireProgress,
  withCriteria,
} from './progress'
import { makePart, makeProject, makeWire } from './fixtures'
import type { Part, Wire } from './types'

describe('progress (C3)', () => {
  it('derives wire progress from criteria — 2 of 5 is 40', () => {
    expect(wireProgress(makeWire({ met: 2, total: 5 }))).toBe(40)
  })

  it('derives wire progress from criteria — 2 of 4 is 50', () => {
    expect(wireProgress(makeWire({ met: 2, total: 4 }))).toBe(50)
  })

  it('derives part progress as average of wires', () => {
    const part: Part = makePart({
      slot: 'torso',
      status: 'in_progress',
      wires: [makeWire({ met: 1, total: 2 }), makeWire({ met: 3, total: 4 })],
    })
    expect(partProgress(part)).toBe(Math.round((50 + 75) / 2))
  })

  it('marks part with no wires as pending, not 0%', () => {
    const part = makePart({ slot: 'backpack', status: 'pending', wires: [] })
    expect(partProgress(part)).toBe(0)
    expect(partDisplayStatus(part)).toBe('pending')
  })

  it('derives project progress weighted by part weight', () => {
    const project = makeProject({
      mapConfirmed: true,
      parts: [
        makePart({
          slot: 'torso',
          weight: 3,
          status: 'in_progress',
          wires: [makeWire({ met: 1, total: 2 })],
        }),
        makePart({
          slot: 'head',
          weight: 1,
          status: 'done',
          wires: [makeWire({ met: 1, total: 1 })],
        }),
        makePart({ slot: 'backpack', status: 'unmapped', wires: [] }),
      ],
    })
    expect(projectProgress(project)).toBe(Math.round((3 * 50 + 1 * 100) / 4))
  })

  it('unconfirmed map exposes displayProgress 0', () => {
    const part = makePart({
      slot: 'torso',
      status: 'in_progress',
      wires: [makeWire({ met: 4, total: 5 })],
    })
    const project = makeProject({ mapConfirmed: false, parts: [part] })
    expect(displayProgressForProject(project)).toBe(0)
    expect(displayProgressForPart(part, false)).toBe(0)
  })

  it('has no API by which a caller can set progress directly', () => {
    type WireKeys = keyof Wire
    type HasProgress = 'progress' extends WireKeys ? true : false
    expectTypeOf<HasProgress>().toEqualTypeOf<false>()
    type WithCriteriaArgs = Parameters<typeof withCriteria>
    type Second = WithCriteriaArgs[1]
    type SecondHasProgress = 'progress' extends keyof Second ? true : false
    expectTypeOf<SecondHasProgress>().toEqualTypeOf<false>()
    const wire = makeWire({ met: 1, total: 5 })
    const next = withCriteria(wire, wire.criteria.map((c, i) => ({ ...c, met: i < 2 })))
    expect(wireProgress(next)).toBe(40)
    expect('progress' in next).toBe(false)
  })
})
