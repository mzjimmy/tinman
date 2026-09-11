import { describe, expect, it } from 'vitest'
import { makeFacts, makePart, makeProject, makeWire } from './fixtures'
import { applyDrift, detectDrift, driftSummary } from './drift'
import { partProgress } from './progress'
import type { Project } from './types'

function mappedProject(): Project {
  return makeProject({
    id: 'p-drift',
    mapConfirmed: true,
    parts: [
      makePart({
        id: 'part-torso',
        slot: 'torso',
        label: '核心',
        weight: 3,
        status: 'in_progress',
        wires: [makeWire({ id: 'w-core', label: '核心域', met: 2, total: 5 })],
        facts: { files: ['src/'], tests: '0 test files (not executed)', lastCommit: '—', todoCount: 0 },
      }),
      makePart({
        id: 'part-ra',
        slot: 'right_arm',
        label: '对外接口',
        weight: 2,
        status: 'pending',
        wires: [makeWire({ id: 'w-api', label: 'HTTP', met: 0, total: 4 })],
        facts: { files: ['api/'], tests: '—', lastCommit: '—', todoCount: 0 },
      }),
    ],
  })
}

describe('drift (R4-C4): the map is re-checked against the repo, never silently rewritten', () => {
  it('reports a directory that appeared since the map was confirmed', () => {
    const prev = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }, { name: 'api', kind: 'dir', files: 5 }] })
    const next = makeFacts({
      tree: [
        { name: 'src', kind: 'dir', files: 10 },
        { name: 'api', kind: 'dir', files: 5 },
        { name: 'billing', kind: 'dir', files: 22 },
      ],
    })
    const findings = detectDrift(mappedProject(), prev, next)
    const added = findings.find((f) => f.kind === 'module_added')
    expect(added).toBeDefined()
    expect(added!.module).toBe('billing/')
  })

  it('reports a mapped directory that has disappeared', () => {
    const prev = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }, { name: 'api', kind: 'dir', files: 5 }] })
    const next = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }] })
    const findings = detectDrift(mappedProject(), prev, next)
    const removed = findings.find((f) => f.kind === 'module_removed')
    expect(removed).toBeDefined()
    expect(removed!.module).toBe('api/')
    expect(removed!.slot).toBe('right_arm')
  })

  it('reports a wire whose criteria have gone stale while its code kept moving', () => {
    const project = mappedProject()
    const prev = makeFacts()
    const next = makeFacts({
      git: {
        branch: 'main',
        last_commit_at: '2026-09-10T00:00:00Z',
        last_commit_subject: 'rework core',
        uncommitted: false,
        top_files_30d: [{ path: 'src/core/engine.ts', commits: 31 }],
      },
    })
    const findings = detectDrift(project, prev, next)
    const stale = findings.find((f) => f.kind === 'wire_stale')
    expect(stale).toBeDefined()
    expect(stale!.wireId).toBe('w-core')
  })

  it('says nothing when the repo has not moved', () => {
    const same = makeFacts()
    expect(detectDrift(mappedProject(), same, same)).toEqual([])
  })

  it('treats a first scan (no previous facts) as no drift, not as everything-added', () => {
    expect(detectDrift(mappedProject(), null, makeFacts())).toEqual([])
  })

  it('every finding is phrased for a reader who cannot read the code', () => {
    const prev = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }] })
    const next = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }, { name: 'billing', kind: 'dir', files: 22 }] })
    const findings = detectDrift(mappedProject(), prev, next)
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.text.trim()).not.toBe('')
      expect(f.evidence.length).toBeGreaterThan(0)
      expect(f.text).not.toMatch(/\d+\s*%/)
    }
    expect(driftSummary(findings).trim()).not.toBe('')
  })

  it('INVARIANT: applying drift never satisfies or unsatisfies a criterion', () => {
    const project = mappedProject()
    const before = project.parts.map((p) => partProgress(p))
    const metBefore = project.parts.flatMap((p) => p.wires.flatMap((w) => w.criteria.map((c) => c.met)))

    const prev = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }] })
    const next = makeFacts({
      tree: [
        { name: 'src', kind: 'dir', files: 10 },
        { name: 'billing', kind: 'dir', files: 22 },
      ],
    })
    const findings = detectDrift(project, prev, next)
    const after = applyDrift(project, findings)

    expect(after.parts.map((p) => partProgress(p))).toEqual(before)
    expect(after.parts.flatMap((p) => p.wires.flatMap((w) => w.criteria.map((c) => c.met)))).toEqual(metBefore)
  })

  it('INVARIANT: applying drift never confirms a map on the user behalf', () => {
    const project = makeProject({ id: 'p-unconfirmed', mapConfirmed: false })
    const prev = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }] })
    const next = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }, { name: 'new', kind: 'dir', files: 3 }] })
    const after = applyDrift(project, detectDrift(project, prev, next))
    expect(after.mapConfirmed).toBe(false)
  })
})

describe('drift (R4 round 2): findings are readable, and they are actually stored', () => {
  function twoWireProject(): Project {
    return makeProject({
      id: 'p-noise',
      mapConfirmed: true,
      parts: [
        makePart({
          id: 'part-torso',
          slot: 'torso',
          label: '核心',
          weight: 3,
          status: 'in_progress',
          wires: [
            makeWire({ id: 'w-a', label: '核心域 A', met: 1, total: 4 }),
            makeWire({ id: 'w-b', label: '核心域 B', met: 0, total: 4 }),
          ],
          facts: { files: ['src/'], tests: '—', lastCommit: '—', todoCount: 0 },
        }),
      ],
    })
  }

  it('raises a stale wire at most once, however many of its files are hot', () => {
    // A non-expert reading four identical sentences learns nothing the first one
    // did not already say.
    const prev = makeFacts()
    const next = makeFacts({
      git: {
        branch: 'main',
        last_commit_at: '2026-09-10T00:00:00Z',
        last_commit_subject: 'rework core',
        uncommitted: false,
        top_files_30d: [
          { path: 'src/core/engine.ts', commits: 31 },
          { path: 'src/core/rules.ts', commits: 22 },
          { path: 'src/core/io.ts', commits: 12 },
        ],
      },
    })
    const stale = detectDrift(twoWireProject(), prev, next).filter((f) => f.kind === 'wire_stale')
    expect(stale.map((f) => f.wireId).sort()).toEqual(['w-a', 'w-b'])
  })

  it('applyDrift actually stores the findings where a reader can reach them', () => {
    // The two invariants below prove applyDrift does no harm; without this, a
    // function that returned the project untouched would satisfy the whole suite.
    const prev = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }] })
    const next = makeFacts({
      tree: [
        { name: 'src', kind: 'dir', files: 10 },
        { name: 'billing', kind: 'dir', files: 22 },
      ],
    })
    const findings = detectDrift(mappedProject(), prev, next)
    expect(findings.length).toBeGreaterThan(0)
    const after = applyDrift(mappedProject(), findings)
    expect(after.driftFindings).toEqual(findings)
  })

  it('stored findings survive the round trip through workspace prefs', () => {
    const prev = makeFacts({ tree: [{ name: 'src', kind: 'dir', files: 10 }] })
    const next = makeFacts({
      tree: [
        { name: 'src', kind: 'dir', files: 10 },
        { name: 'billing', kind: 'dir', files: 22 },
      ],
    })
    const after = applyDrift(mappedProject(), detectDrift(mappedProject(), prev, next))
    expect(JSON.parse(JSON.stringify(after)).driftFindings).toEqual(after.driftFindings)
  })
})
