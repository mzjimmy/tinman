import { describe, expect, it } from 'vitest'
import { getDemoProjects } from '../data/demoData'
import {
  displayProgressForPart,
  displayProgressForProject,
  partProgress,
  projectProgress,
  wireProgress,
} from '../domain/progress'
import type { Part, Wire } from '../domain/types'

function makeWire(met: number, total: number): Wire {
  return {
    id: 'w',
    label: 'test',
    status: 'in_progress',
    criteria: Array.from({ length: total }, (_, i) => ({
      text: `c${i}`,
      met: i < met,
      evidence: '',
    })),
  }
}

describe('progress (C3)', () => {
  it('derives wire progress from criteria', () => {
    expect(wireProgress(makeWire(2, 4))).toBe(50)
  })

  it('derives part progress as average of wires', () => {
    const part: Part = {
      id: 'p',
      slot: 'torso',
      label: 'core',
      weight: 3,
      status: 'in_progress',
      wires: [makeWire(1, 2), makeWire(3, 4)],
    }
    expect(partProgress(part)).toBe(Math.round((50 + 75) / 2))
  })

  it('marks part with no wires as pending via zero progress', () => {
    const part: Part = {
      id: 'p',
      slot: 'backpack',
      label: 'bp',
      weight: 1,
      status: 'pending',
      wires: [],
    }
    expect(partProgress(part)).toBe(0)
  })

  it('derives project progress weighted by part weight', () => {
    const project = getDemoProjects()[0]!
    expect(projectProgress(project)).toBeGreaterThan(0)
  })

  it('unconfirmed map exposes displayProgress 0', () => {
    const project = getDemoProjects().find((p) => p.id === 'p-sdk')!
    const part = project.parts.find((p) => p.slot === 'torso')!
    expect(displayProgressForProject(project)).toBe(0)
    expect(displayProgressForPart(part, false)).toBe(0)
  })
})
