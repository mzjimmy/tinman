import { describe, expect, it } from 'vitest'
import { blockCoefficient, fleetRanking, shortLegScore, sortProjectsByShortLeg } from './shortLeg'
import { isLagging } from './progress'
import { makePart, makeProject, makeWire, rankingProject } from './fixtures'
import type { Part } from './types'

describe('shortLeg (C4)', () => {
  it('applies S = weight × u × b with blocked 1.5', () => {
    const blocked = makePart({
      slot: 'left_leg',
      weight: 3,
      status: 'blocked',
      wires: [makeWire({ met: 1, total: 5, status: 'blocked' })],
    })
    const score = shortLegScore(blocked, true)
    const manualU = 1 - 20 / 100
    expect(blockCoefficient(blocked)).toBe(1.5)
    expect(score).toBeCloseTo(3 * manualU * 1.5, 5)
  })

  it('applies stalled coefficient 1.2', () => {
    const stalled = makePart({
      slot: 'torso',
      weight: 2,
      status: 'in_progress',
      wires: [makeWire({ met: 1, total: 4, lastCommitDays: 45 })],
    })
    expect(blockCoefficient(stalled)).toBe(1.2)
    const u = 1 - 25 / 100
    expect(shortLegScore(stalled, true)).toBeCloseTo(2 * u * 1.2, 5)
  })

  it('excludes planned_start not reached from ranking', () => {
    const planned = makePart({
      id: 'future',
      slot: 'right_arm',
      weight: 4,
      status: 'pending',
      plannedStart: '2099-01-01',
      wires: [makeWire({ met: 0, total: 3 })],
    })
    const started = makePart({
      id: 'now',
      slot: 'torso',
      weight: 1,
      status: 'in_progress',
      wires: [makeWire({ met: 1, total: 4 })],
    })
    const project = makeProject({
      id: 'p-obs',
      mapConfirmed: true,
      parts: [planned, started],
    })
    const ranking = fleetRanking([project])
    expect(ranking.some((r) => r.partId === 'future')).toBe(false)
    expect(ranking.some((r) => r.partId === 'now')).toBe(true)
  })

  it('marks a started part 20pp below median as lagging', () => {
    const low = makePart({
      id: 'low',
      slot: 'left_leg',
      status: 'in_progress',
      wires: [makeWire({ met: 1, total: 5 })],
    })
    const a = makePart({
      slot: 'torso',
      status: 'in_progress',
      wires: [makeWire({ met: 4, total: 5 })],
    })
    const b = makePart({
      slot: 'head',
      status: 'in_progress',
      wires: [makeWire({ met: 4, total: 5 })],
    })
    expect(isLagging(low, [low, a, b])).toBe(true)
  })

  it('truncates ranking to top 5', () => {
    const projects = Array.from({ length: 8 }, (_, i) =>
      makeProject({
        id: `p-${i}`,
        name: `P${i}`,
        mapConfirmed: true,
        parts: [
          makePart({
            id: `part-${i}`,
            slot: 'torso',
            weight: 8 - i,
            status: 'in_progress',
            wires: [makeWire({ met: 1, total: 5 })],
          }),
        ],
      }),
    )
    expect(fleetRanking(projects, 5)).toHaveLength(5)
  })

  it('sorts fleet by max short leg descending', () => {
    const sorted = sortProjectsByShortLeg([
      rankingProject(),
      makeProject({
        id: 'done',
        mapConfirmed: true,
        parts: [
          makePart({
            slot: 'torso',
            weight: 3,
            status: 'done',
            wires: [makeWire({ met: 1, total: 1, status: 'done' })],
          }),
        ],
      }),
    ])
    const scores = sorted.map((p) =>
      Math.max(...p.parts.map((part: Part) => shortLegScore(part, p.mapConfirmed)), 0),
    )
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]!).toBeGreaterThanOrEqual(scores[i]!)
    }
  })
})
