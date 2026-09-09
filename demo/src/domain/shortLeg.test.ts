import { describe, expect, it } from 'vitest'
import { getDemoProjects } from '../data/demoData'
import { shortLegScore } from '../domain/shortLeg'
import { fleetRanking, sortProjectsByShortLeg } from '../domain/shortLeg'
import type { Part } from '../domain/types'

describe('shortLeg (C4)', () => {
  it('applies S = weight × u × b with blocked 1.5', () => {
    const projects = getDemoProjects()
    const demo = projects[0]!
    const blocked = demo.parts.find((p) => p.status === 'blocked')!
    const score = shortLegScore(blocked, true)
    expect(score).toBeGreaterThan(0)
    const manualU = 1 - 20 / 100
    expect(score).toBeCloseTo(3 * manualU * 1.5, 1)
  })

  it('excludes planned_start not reached from ranking', () => {
    const ranking = fleetRanking(getDemoProjects())
    const obs = getDemoProjects().find((p) => p.id === 'p-obs')!
    const planned = obs.parts.find((p) => p.plannedStart === '2026-12-01')!
    expect(ranking.some((r) => r.partId === planned.id)).toBe(false)
  })

  it('truncates ranking to top 5', () => {
    expect(fleetRanking(getDemoProjects(), 5).length).toBeLessThanOrEqual(5)
  })

  it('sorts fleet by max short leg descending', () => {
    const sorted = sortProjectsByShortLeg(getDemoProjects())
    const scores = sorted.map((p) =>
      Math.max(
        ...p.parts.map((part: Part) => shortLegScore(part, p.mapConfirmed)),
      ),
    )
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]!).toBeGreaterThanOrEqual(scores[i]!)
    }
  })
})
