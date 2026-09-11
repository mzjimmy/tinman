/**
 * Round 9 / 缺口5 — 舰队级一个大脑.
 *
 * Today each workspace is judged alone: one LLM profile per workspace, no shared
 * goal, and no notion that A 的右臂挡住 B 的左腿. So the fleet ranking can send
 * the user to push a leg that is blocked by a different project they own.
 *
 * Links are derived from SCAN FACTS (one project's dependency list naming
 * another project), never from a model's opinion, and they reorder the ranking
 * only — they never touch a criterion.
 */
import { describe, expect, it } from 'vitest'
import { makeFacts, makePart, makeProject, makeWire } from './fixtures'
import { applyFleetBlocking, detectFleetLinks, fleetBrief } from './fleetBrain'
import { fleetRanking } from './shortLeg'
import type { Facts } from '../lib/api'
import type { Project } from './types'

function provider(): Project {
  return makeProject({
    id: 'p-core',
    name: 'core-api',
    root: '/repos/core-api',
    mapConfirmed: true,
    parts: [
      makePart({
        id: 'core-ra',
        slot: 'right_arm',
        label: '对外接口',
        weight: 2,
        status: 'in_progress',
        wires: [makeWire({ id: 'w-core-api', label: 'HTTP', met: 2, total: 4 })],
      }),
    ],
  })
}

function consumer(): Project {
  return makeProject({
    id: 'p-web',
    name: 'web',
    root: '/repos/web',
    mapConfirmed: true,
    parts: [
      makePart({
        id: 'web-ll',
        slot: 'left_leg',
        label: '基础设施',
        weight: 3,
        status: 'in_progress',
        wires: [makeWire({ id: 'w-web-ci', label: 'CI', met: 0, total: 5 })],
      }),
    ],
  })
}

function factsDependingOnCoreApi(): Facts {
  return makeFacts({
    dependencies: [
      { path: 'package.json', kind: 'npm', data: { dependencies: { 'core-api': '^1.0.0' } } },
    ],
  })
}

describe('detectFleetLinks (R9-C2): the fleet notices one project holding up another', () => {
  it('links a provider to the project that depends on it', () => {
    const links = detectFleetLinks([provider(), consumer()], {
      'p-web': factsDependingOnCoreApi(),
      'p-core': makeFacts(),
    })
    expect(links).toHaveLength(1)
    expect(links[0]!.fromProjectId).toBe('p-core')
    expect(links[0]!.toProjectId).toBe('p-web')
  })

  it('blames the provider外部接口, because that is what a consumer consumes', () => {
    const links = detectFleetLinks([provider(), consumer()], {
      'p-web': factsDependingOnCoreApi(),
      'p-core': makeFacts(),
    })
    expect(links[0]!.fromPartId).toBe('core-ra')
  })

  it('explains the link in a sentence the user can act on', () => {
    const links = detectFleetLinks([provider(), consumer()], {
      'p-web': factsDependingOnCoreApi(),
      'p-core': makeFacts(),
    })
    expect(links[0]!.reason).toContain('core-api')
    expect(links[0]!.reason).not.toMatch(/\d+\s*%/)
  })

  it('says nothing when the projects do not reference each other', () => {
    expect(
      detectFleetLinks([provider(), consumer()], { 'p-web': makeFacts(), 'p-core': makeFacts() }),
    ).toEqual([])
  })

  it('never links a project to itself', () => {
    const selfRef = makeFacts({
      dependencies: [{ path: 'package.json', kind: 'npm', data: { dependencies: { web: '^1' } } }],
    })
    expect(detectFleetLinks([consumer()], { 'p-web': selfRef })).toEqual([])
  })

  it('ignores a provider whose map is not confirmed', () => {
    const raw = { ...provider(), mapConfirmed: false }
    expect(
      detectFleetLinks([raw, consumer()], { 'p-web': factsDependingOnCoreApi() }),
    ).toEqual([])
  })
})

describe('applyFleetBlocking (R9-C2): a blocking part outranks one that blocks nobody', () => {
  it('lifts the provider part above a locally-worse leg it is holding up', () => {
    const projects = [provider(), consumer()]
    const links = detectFleetLinks(projects, {
      'p-web': factsDependingOnCoreApi(),
      'p-core': makeFacts(),
    })
    const base = fleetRanking(projects)
    // On local score alone the web leg wins: weight 3, nothing met.
    expect(base[0]!.partId).toBe('web-ll')

    const lifted = applyFleetBlocking(base, links)
    expect(lifted[0]!.partId).toBe('core-ra')
  })

  it('leaves the order alone when there are no links', () => {
    const projects = [provider(), consumer()]
    const base = fleetRanking(projects)
    expect(applyFleetBlocking(base, []).map((e) => e.partId)).toEqual(base.map((e) => e.partId))
  })

  it('INVARIANT: reordering the fleet never changes a score input from criteria', () => {
    const projects = [provider(), consumer()]
    const links = detectFleetLinks(projects, {
      'p-web': factsDependingOnCoreApi(),
      'p-core': makeFacts(),
    })
    const base = fleetRanking(projects)
    const before = new Map(base.map((e) => [e.partId, e.progress]))
    for (const e of applyFleetBlocking(base, links)) {
      expect(e.progress).toBe(before.get(e.partId))
    }
  })

  it('does not invent entries or drop any', () => {
    const projects = [provider(), consumer()]
    const links = detectFleetLinks(projects, {
      'p-web': factsDependingOnCoreApi(),
      'p-core': makeFacts(),
    })
    const base = fleetRanking(projects)
    const lifted = applyFleetBlocking(base, links)
    expect(lifted.map((e) => e.partId).sort()).toEqual(base.map((e) => e.partId).sort())
  })
})

describe('fleetBrief (R9-C2): one paragraph for the whole fleet', () => {
  it('names the project to push and why, without a percentage', () => {
    const projects = [provider(), consumer()]
    const links = detectFleetLinks(projects, {
      'p-web': factsDependingOnCoreApi(),
      'p-core': makeFacts(),
    })
    const brief = fleetBrief(applyFleetBlocking(fleetRanking(projects), links), links)
    expect(brief).toContain('core-api')
    expect(brief).not.toMatch(/\d+\s*%/)
  })

  it('says so plainly when the fleet is empty', () => {
    expect(fleetBrief([], []).trim()).not.toBe('')
  })
})
