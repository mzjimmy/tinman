import { describe, expect, it } from 'vitest'
import { ALL_SLOTS } from './types'
import { makeFacts } from './fixtures'
import { autoDraft, heuristicProposal, sanitizeLlmProposal, slotForModule } from './autoMap'

describe('autoMap (R4-C1): the draft the user only has to accept', () => {
  it('routes recognisable top-level modules to their metaphor slot', () => {
    const facts = makeFacts()
    expect(slotForModule('api/', facts)).toBe('right_arm')
    expect(slotForModule('infra/', facts)).toBe('left_leg')
    expect(slotForModule('components/', facts)).toBe('left_arm')
    expect(slotForModule('deploy/', facts)).toBe('right_leg')
    expect(slotForModule('domain/', facts)).toBe('torso')
  })

  it('never invents an eighth slot and never guesses wildly', () => {
    const facts = makeFacts()
    const odd = slotForModule('zzz-unknowable/', facts)
    expect(odd === null || ALL_SLOTS.includes(odd)).toBe(true)
  })

  it('produces a complete seven-slot proposal with zero human typing', () => {
    const proposal = heuristicProposal(
      makeFacts({
        tree: [
          { name: 'src', kind: 'dir', files: 200 },
          { name: 'api', kind: 'dir', files: 40 },
          { name: 'infra', kind: 'dir', files: 12 },
        ],
        api_endpoints: ['POST /login', 'GET /session'],
        pages: ['src/pages/Login.tsx'],
      }),
    )
    expect(proposal.parts).toHaveLength(7)
    expect(proposal.parts.map((p) => p.slot).sort()).toEqual([...ALL_SLOTS].sort())

    const present = proposal.parts.filter((p) => p.present)
    expect(present.length).toBeGreaterThan(0)
    for (const p of present) {
      expect(p.label.trim()).not.toBe('')
      expect(p.wires.length).toBeGreaterThan(0)
      for (const w of p.wires) {
        expect(w.label.trim()).not.toBe('')
        expect(w.criteria.length).toBeGreaterThanOrEqual(3)
        expect(w.criteria.length).toBeLessThanOrEqual(6)
        for (const c of w.criteria) expect(c.text.trim()).not.toBe('')
      }
    }
  })

  it('assigns every discovered directory to at most one slot', () => {
    const proposal = heuristicProposal(makeFacts())
    const seen = new Map<string, string>()
    for (const p of proposal.parts) {
      for (const m of p.modulePaths) {
        expect(seen.has(m)).toBe(false)
        seen.set(m, p.slot)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  it('INVARIANT: a drafted criterion is never pre-satisfied and carries no evidence', () => {
    const proposal = heuristicProposal(makeFacts())
    for (const p of proposal.parts) {
      for (const w of p.wires) {
        for (const c of w.criteria) {
          expect(c.met).toBe(false)
          expect(c.evidence).toBe('')
        }
      }
    }
  })

  it('INVARIANT: a drafted criterion never states a progress number', () => {
    const proposal = heuristicProposal(makeFacts())
    const texts = proposal.parts.flatMap((p) => [
      p.label,
      ...p.wires.flatMap((w) => [w.label, ...w.criteria.map((c) => c.text)]),
    ])
    for (const t of texts) {
      expect(t).not.toMatch(/\d+\s*%/)
      expect(t).not.toMatch(/进度|完成度/)
    }
  })
})

describe('sanitizeLlmProposal (R4-C1): model output is data, not authority', () => {
  it('accepts a well-shaped proposal and forces criteria unmet', () => {
    const got = sanitizeLlmProposal({
      parts: [
        {
          slot: 'right_arm',
          present: true,
          label: '对外接口',
          weight: 2,
          modulePaths: ['api/'],
          wires: [
            {
              label: '登录接口',
              criteria: [
                { text: 'POST /login 返回 200', met: true, evidence: 'trust me' },
                { text: '错误密码返回 401', met: true, evidence: 'x' },
                { text: '未登录访问 /app 跳转登录页', met: true, evidence: 'y' },
              ],
            },
          ],
        },
      ],
    })
    expect(got).not.toBeNull()
    const part = got!.parts.find((p) => p.slot === 'right_arm')!
    expect(part.wires[0]!.criteria.every((c) => c.met === false)).toBe(true)
    expect(part.wires[0]!.criteria.every((c) => c.evidence === '')).toBe(true)
  })

  it('drops slots outside the fixed seven', () => {
    const got = sanitizeLlmProposal({
      parts: [
        { slot: 'tail', present: true, label: 'x', weight: 2, modulePaths: [], wires: [] },
        { slot: 'torso', present: true, label: '核心', weight: 3, modulePaths: [], wires: [] },
      ],
    })
    expect(got).not.toBeNull()
    expect(got!.parts.every((p) => (ALL_SLOTS as readonly string[]).includes(p.slot))).toBe(true)
    expect(got!.parts.some((p) => p.slot === 'torso')).toBe(true)
  })

  it('drops a wire whose criteria count falls outside 3–6', () => {
    const got = sanitizeLlmProposal({
      parts: [
        {
          slot: 'torso',
          present: true,
          label: '核心',
          weight: 3,
          modulePaths: [],
          wires: [
            { label: '太少', criteria: [{ text: 'a', met: false, evidence: '' }] },
            {
              label: '刚好',
              criteria: [
                { text: 'a', met: false, evidence: '' },
                { text: 'b', met: false, evidence: '' },
                { text: 'c', met: false, evidence: '' },
              ],
            },
          ],
        },
      ],
    })
    const torso = got!.parts.find((p) => p.slot === 'torso')!
    expect(torso.wires.map((w) => w.label)).toEqual(['刚好'])
  })

  it('clamps weight into the sheet-legal range', () => {
    const got = sanitizeLlmProposal({
      parts: [{ slot: 'head', present: true, label: 'h', weight: 999, modulePaths: [], wires: [] }],
    })
    const head = got!.parts.find((p) => p.slot === 'head')!
    expect(head.weight).toBeLessThanOrEqual(8)
    expect(head.weight).toBeGreaterThanOrEqual(0.5)
  })

  it('returns null for output that is not a proposal at all', () => {
    expect(sanitizeLlmProposal(null)).toBeNull()
    expect(sanitizeLlmProposal('done')).toBeNull()
    expect(sanitizeLlmProposal({ diagnosis: 'x' })).toBeNull()
  })
})

describe('autoDraft (R4-C1): the import path never leaves the user an empty sheet', () => {
  it('prefers the model proposal when one is usable', () => {
    const { proposal, source } = autoDraft(makeFacts(), {
      parts: [
        {
          slot: 'torso',
          present: true,
          label: '模型给的核心',
          weight: 3,
          modulePaths: ['src/'],
          wires: [
            {
              label: 'w',
              criteria: [
                { text: 'a', met: false, evidence: '' },
                { text: 'b', met: false, evidence: '' },
                { text: 'c', met: false, evidence: '' },
              ],
            },
          ],
        },
      ],
    })
    expect(source).toBe('llm')
    expect(proposal.parts.find((p) => p.slot === 'torso')!.label).toBe('模型给的核心')
    expect(proposal.parts).toHaveLength(7)
  })

  it('falls back to the heuristic when the model is unavailable', () => {
    const { proposal, source } = autoDraft(makeFacts(), null)
    expect(source).toBe('heuristic')
    expect(proposal.parts).toHaveLength(7)
    expect(proposal.parts.some((p) => p.present && p.wires.length > 0)).toBe(true)
  })

  it('falls back to the heuristic when the model output is rejected', () => {
    const { proposal, source } = autoDraft(makeFacts(), { nonsense: true })
    expect(source).toBe('heuristic')
    expect(proposal.parts).toHaveLength(7)
  })

  it('keeps heuristic slots the model omitted, so no slot is left blank', () => {
    const { proposal } = autoDraft(makeFacts(), {
      parts: [
        {
          slot: 'torso',
          present: true,
          label: '只给了躯干',
          weight: 3,
          modulePaths: [],
          wires: [
            {
              label: 'w',
              criteria: [
                { text: 'a', met: false, evidence: '' },
                { text: 'b', met: false, evidence: '' },
                { text: 'c', met: false, evidence: '' },
              ],
            },
          ],
        },
      ],
    })
    expect(proposal.parts.map((p) => p.slot).sort()).toEqual([...ALL_SLOTS].sort())
  })
})
