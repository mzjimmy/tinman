import { describe, expect, it } from 'vitest'
import { emptyProposal } from './proposal'
import {
  gapsFromFacts,
  lastCommitDaysFor,
  mergeDrift,
  parseLlmMap,
  pickSlot,
  proposeFromFacts,
  proposalFromProject,
  treeFingerprint,
  withSlash,
  type FactSlice,
} from './proposeMap'
import { makePart, makeProject, makeWire } from './fixtures'

function facts(partial: Partial<FactSlice> = {}): FactSlice {
  return {
    tree: [],
    tests: { files: [] },
    git: {},
    markers: [],
    ...partial,
  }
}

function hasProgressToken(text: string): boolean {
  return /\d+\s*[%％]/.test(text) || /进度|完成度/.test(text) || /\d+\/\d+\s*完成/.test(text)
}

describe('proposeFromFacts', () => {
  const sample = facts({
    tree: [
      { name: 'src', kind: 'dir', files: 40 },
      { name: 'web', kind: 'dir', files: 12 },
      { name: 'api', kind: 'dir', files: 8 },
      { name: 'docker', kind: 'dir', files: 2 },
      { name: 'infra', kind: 'dir', files: 4 },
      { name: 'models', kind: 'dir', files: 3 },
      { name: 'demo', kind: 'dir', files: 1 },
      { name: 'README.md', kind: 'file', files: 1 },
    ],
    tests: { files: ['web/app.test.tsx'] },
    markers: [{ kind: 'TODO', path: 'src/main.ts', line: 4 }],
    spec_docs: ['docs/spec.md'],
    pages: ['web/index.html'],
    api_endpoints: ['/v1/health'],
    git: { last_commit_subject: 'init', uncommitted: false },
  })

  it('assigns well-known directories onto the seven slots', () => {
    const proposal = proposeFromFacts(sample)
    const bySlot = Object.fromEntries(proposal.parts.map((p) => [p.slot, p]))
    expect(bySlot.head?.modulePaths).toContain('models/')
    expect(bySlot.torso?.modulePaths).toContain('src/')
    expect(bySlot.left_arm?.modulePaths).toContain('web/')
    expect(bySlot.right_arm?.modulePaths).toContain('api/')
    expect(bySlot.left_leg?.modulePaths).toContain('infra/')
    expect(bySlot.right_leg?.modulePaths).toContain('docker/')
    expect(bySlot.backpack?.modulePaths).toContain('demo/')
  })

  it('only marks slots with modules as present, and every wire has 3–6 unmet criteria', () => {
    const proposal = proposeFromFacts(sample)
    for (const p of proposal.parts) {
      expect(p.present).toBe(p.modulePaths.length > 0)
      if (!p.present) {
        expect(p.wires).toEqual([])
        continue
      }
      expect(p.wires.length).toBeGreaterThanOrEqual(1)
      for (const w of p.wires) {
        expect(w.label.trim().length).toBeGreaterThan(0)
        expect(w.criteria.length).toBeGreaterThanOrEqual(3)
        expect(w.criteria.length).toBeLessThanOrEqual(6)
        expect(w.criteria.every((c) => c.met === false && c.evidence === '')).toBe(true)
        expect(w.criteria.every((c) => !hasProgressToken(c.text))).toBe(true)
      }
    }
  })

  it('does not invent a progress number in gaps either', () => {
    const gaps = gapsFromFacts(sample)
    expect(gaps.some((g) => g.includes('TODO'))).toBe(true)
    expect(gaps.every((g) => !hasProgressToken(g))).toBe(true)
  })

  it('changes fingerprint when a top-level directory appears', () => {
    const before = treeFingerprint(sample)
    const after = treeFingerprint({
      ...sample,
      tree: [...sample.tree, { name: 'plugins', kind: 'dir', files: 2 }],
    })
    expect(before).not.toBe(after)
    expect(treeFingerprint(sample)).toBe(before)
  })
})

describe('pickSlot', () => {
  it('maps frontend-ish names to the left arm and deploy-ish names to the right leg', () => {
    expect(pickSlot('frontend')).toBe('left_arm')
    expect(pickSlot('deploy')).toBe('right_leg')
    expect(pickSlot('mystery-extra')).toBe('backpack')
  })
})

describe('parseLlmMap', () => {
  it('accepts snake_case, string criteria, and strips met:true so a draft cannot invent fill', () => {
    const base = proposeFromFacts(
      facts({
        tree: [{ name: 'src', kind: 'dir', files: 2 }],
      }),
    )
    const parsed = parseLlmMap(
      {
        parts: [
          {
            slot: 'torso',
            present: true,
            label: '核心域',
            module_paths: ['src'],
            wires: [
              {
                label: '域模型',
                criteria: [
                  { text: '实体可序列化', met: true, evidence: 'nope' },
                  '迁移可回放',
                ],
              },
            ],
          },
        ],
      },
      base,
    )
    const torso = parsed.parts.find((p) => p.slot === 'torso')!
    expect(torso.label).toBe('核心域')
    expect(torso.modulePaths).toContain('src/')
    const wire = torso.wires[0]!
    expect(wire.label).toBe('域模型')
    expect(wire.criteria[0]).toEqual({ text: '实体可序列化', met: false, evidence: '' })
    expect(wire.criteria.length).toBeGreaterThanOrEqual(3)
    expect(wire.criteria.every((c) => c.met === false)).toBe(true)
  })

  it('falls back to the heuristic base when the model returns nothing usable', () => {
    const base = emptyProposal()
    expect(parseLlmMap('not-json', base)).toEqual(base)
    expect(parseLlmMap({ parts: [] }, base).parts).toHaveLength(7)
  })
})

describe('mergeDrift', () => {
  it('keeps existing wires (including met flags) and only attaches new modules', () => {
    const project = makeProject({
      mapConfirmed: true,
      parts: [
        makePart({
          slot: 'torso',
          label: '核心',
          status: 'in_progress',
          facts: { files: ['src/'], tests: '', lastCommit: '', todoCount: 0 },
          wires: [makeWire({ label: '域模型', met: 2, total: 3 })],
        }),
        makePart({ slot: 'head', status: 'unmapped', wires: [] }),
        makePart({ slot: 'left_arm', status: 'unmapped', wires: [] }),
        makePart({ slot: 'right_arm', status: 'unmapped', wires: [] }),
        makePart({ slot: 'left_leg', status: 'unmapped', wires: [] }),
        makePart({ slot: 'right_leg', status: 'unmapped', wires: [] }),
        makePart({ slot: 'backpack', status: 'unmapped', wires: [] }),
      ],
    })
    const current = proposalFromProject(project)
    const heur = proposeFromFacts(
      facts({
        tree: [
          { name: 'src', kind: 'dir', files: 4 },
          { name: 'demo', kind: 'dir', files: 1 },
        ],
      }),
    )
    const { proposal, added, removed } = mergeDrift(current, heur, ['src/', 'demo/'])
    expect(added).toEqual(['demo/'])
    expect(removed).toEqual([])
    const torso = proposal.parts.find((p) => p.slot === 'torso')!
    expect(torso.wires[0]?.criteria.filter((c) => c.met)).toHaveLength(2)
    const backpack = proposal.parts.find((p) => p.slot === 'backpack')!
    expect(backpack.modulePaths).toContain('demo/')
    expect(backpack.present).toBe(true)
    expect(backpack.wires[0]?.criteria.every((c) => c.met === false)).toBe(true)
  })
})

describe('lastCommitDaysFor', () => {
  const now = Date.parse('2026-09-11T00:00:00Z')

  it('treats a module missing from top_files_30d as stalled while the repo itself is moving', () => {
    const f = facts({
      git: {
        last_commit_at: '2026-09-10T00:00:00Z',
        top_files_30d: [{ path: 'web/App.tsx', commits: 4 }],
      },
    })
    expect(lastCommitDaysFor(['src/'], f, now)).toBe(31)
    expect(lastCommitDaysFor(['web/'], f, now)).toBe(0)
    expect(lastCommitDaysFor([], f, now)).toBe(1)
  })

  it('does not invent a stall when there are no facts', () => {
    expect(lastCommitDaysFor(['src/'], undefined, now)).toBeUndefined()
  })
})

describe('withSlash', () => {
  it('normalises module ids so src and src/ are the same assignment key', () => {
    expect(withSlash('src')).toBe('src/')
    expect(withSlash('src/')).toBe('src/')
  })
})
