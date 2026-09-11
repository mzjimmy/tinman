/**
 * Round 9 / 缺口4 — 验收清单的主人改成 agent.
 *
 * Today the user must pick a part AND a wire before a goal card exists, and the
 * acceptance list is whatever a human typed into the map sheet. For someone who
 * does not read code that is the whole barrier: they can say 「登录别再崩」 and
 * nothing else.
 *
 * So: intent in, target out, checklist drafted by the machine. The human reads
 * 做了什么 / 还差什么, not checkbox engineering. Progress still moves only when
 * evidence flips a criterion — nothing here writes one.
 */
import { describe, expect, it } from 'vitest'
import { makeFacts, makePart, makeProject, makeWire } from './fixtures'
import { draftCriteriaFromIntent, progressNarrative, targetFromIntent } from './intent'
import type { Project } from './types'

function fleet(): Project[] {
  return [
    makeProject({
      id: 'p-app',
      name: '应用',
      mapConfirmed: true,
      parts: [
        makePart({
          id: 'part-login',
          slot: 'left_arm',
          label: '前端 UI',
          weight: 2,
          status: 'in_progress',
          wires: [makeWire({ id: 'w-login', label: '登录页', met: 1, total: 4 })],
        }),
        makePart({
          id: 'part-infra',
          slot: 'left_leg',
          label: '基础设施',
          weight: 3,
          status: 'in_progress',
          wires: [makeWire({ id: 'w-ci', label: 'CI', met: 0, total: 5, lastCommitDays: 60 })],
        }),
      ],
    }),
  ]
}

describe('targetFromIntent (R9-C1): the user says what they want, not where it lives', () => {
  it('routes a plain sentence to the wire it is actually about', () => {
    const t = targetFromIntent('登录别再崩了', fleet())
    expect(t).not.toBeNull()
    expect(t!.partId).toBe('part-login')
    expect(t!.wireId).toBe('w-login')
    expect(t!.confidence).toBe('matched')
  })

  it('explains its choice in a sentence a non-coder can judge', () => {
    const t = targetFromIntent('登录别再崩了', fleet())
    expect(t!.why.trim()).not.toBe('')
    expect(t!.why).not.toMatch(/\d+\s*%/)
  })

  it('falls back to the current short leg when the words match nothing', () => {
    const t = targetFromIntent('随便做点什么', fleet())
    expect(t).not.toBeNull()
    // left_leg: weight 3, 0/5 met, stalled — the highest short-leg score here.
    expect(t!.partId).toBe('part-infra')
    expect(t!.confidence).toBe('shortleg')
  })

  it('refuses to guess when no map has been confirmed', () => {
    const unconfirmed = [makeProject({ id: 'p-raw', mapConfirmed: false })]
    expect(targetFromIntent('登录别再崩了', unconfirmed)).toBeNull()
  })

  it('picks across projects, not just inside the selected one', () => {
    const two = [
      ...fleet(),
      makeProject({
        id: 'p-pay',
        name: '支付',
        mapConfirmed: true,
        parts: [
          makePart({
            id: 'part-pay',
            slot: 'right_arm',
            label: '对外接口',
            weight: 2,
            status: 'in_progress',
            wires: [makeWire({ id: 'w-refund', label: '退款接口', met: 0, total: 3 })],
          }),
        ],
      }),
    ]
    const t = targetFromIntent('退款接口要能用', two)
    expect(t!.projectId).toBe('p-pay')
    expect(t!.wireId).toBe('w-refund')
  })
})

describe('draftCriteriaFromIntent (R9-C1): the machine owns the checklist', () => {
  it('turns a vague intent into checkable lines', () => {
    const part = fleet()[0]!.parts[0]!
    const criteria = draftCriteriaFromIntent('登录别再崩了', part, makeFacts({ routes: ['/app', '/login'] }))
    expect(criteria.length).toBeGreaterThanOrEqual(3)
    expect(criteria.length).toBeLessThanOrEqual(6)
    for (const c of criteria) expect(c.trim()).not.toBe('')
  })

  it('keeps the user words visible so they can tell it understood them', () => {
    const part = fleet()[0]!.parts[0]!
    const criteria = draftCriteriaFromIntent('登录别再崩了', part, makeFacts())
    expect(criteria.join(' ')).toContain('登录')
  })

  it('INVARIANT: a drafted criterion never states a progress number', () => {
    const part = fleet()[0]!.parts[0]!
    for (const c of draftCriteriaFromIntent('登录别再崩了', part, makeFacts())) {
      expect(c).not.toMatch(/\d+\s*%/)
      expect(c).not.toMatch(/进度|完成度/)
    }
  })

  it('works with no facts at all', () => {
    const part = fleet()[0]!.parts[0]!
    expect(draftCriteriaFromIntent('登录别再崩了', part).length).toBeGreaterThanOrEqual(3)
  })
})

describe('progressNarrative (R9-C1): 做了什么 / 还差什么, not checkbox engineering', () => {
  it('splits the checklist into what is done and what is left, in words', () => {
    const part = makePart({
      slot: 'torso',
      status: 'in_progress',
      wires: [makeWire({ id: 'w', met: 2, total: 5 })],
    })
    const n = progressNarrative(part)
    expect(n.done).toHaveLength(2)
    expect(n.remaining).toHaveLength(3)
  })

  it('INVARIANT: the narrative never prints a percentage', () => {
    const part = makePart({
      slot: 'torso',
      status: 'in_progress',
      wires: [makeWire({ met: 2, total: 5 })],
    })
    const n = progressNarrative(part)
    for (const line of [...n.done, ...n.remaining]) {
      expect(line).not.toMatch(/\d+\s*%/)
    }
  })

  it('says so plainly when nothing has been accepted yet', () => {
    const part = makePart({ slot: 'torso', wires: [makeWire({ met: 0, total: 3 })] })
    const n = progressNarrative(part)
    expect(n.done).toEqual([])
    expect(n.remaining).toHaveLength(3)
  })
})
