import { describe, expect, it } from 'vitest'
import {
  GOAL_ADVICE_KEYS,
  GOAL_AUTH_KEYS,
  GOAL_CARD_KEYS,
  GOAL_TARGET_KEYS,
  GOAL_WORKSPACE_KEYS,
  draftGoal,
  factsFromPart,
} from './dispatch'
import { rankingProject } from './fixtures'
import type { FrameworkAdvice } from './types'

const INTENT = 'keep this   exactly — do not summarise'

function keysOf(v: object): string[] {
  return Object.keys(v).sort()
}

function hasProgressField(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasProgressField)
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).some(
      ([k, val]) => k === 'progress' || k === '进度' || k === '完成度' || hasProgressField(val),
    )
  }
  return false
}

describe('goal card §9.1 (C2)', () => {
  const project = rankingProject()
  const part = project.parts[0]!
  const wire = part.wires[0]!
  const advice: FrameworkAdvice = {
    diagnosis: 'left_leg is short because README has no CI listed in facts.',
    next_step: 'Add a failing test for the dispatch path.',
    entry_point: 'app/src-tauri/src/dispatch.rs',
    shared_risk: 'db.rs task rows must not share the wire table.',
    done_criteria: ['worktree is outside the scan root', 'argv cannot contain push', 'exit 0 is checking'],
  }

  it('generated card has exactly the §9.1 keys, no extras, no missing', () => {
    const goal = draftGoal({
      taskId: 't_0142',
      project,
      partId: part.id,
      wireId: wire.id,
      userIntentVerbatim: [INTENT],
      attachments: ['shot.png'],
      facts: factsFromPart(project, part.id),
      advice,
      worktreePath: '/tmp/tinman-data/worktrees/t_0142',
    })
    expect(keysOf(goal)).toEqual([...GOAL_CARD_KEYS].sort())
    expect(keysOf(goal.target)).toEqual([...GOAL_TARGET_KEYS].sort())
    expect(keysOf(goal.framework_advice)).toEqual([...GOAL_ADVICE_KEYS].sort())
    expect(keysOf(goal.workspace)).toEqual([...GOAL_WORKSPACE_KEYS].sort())
    expect(keysOf(goal.authorization)).toEqual([...GOAL_AUTH_KEYS].sort())
    expect(goal.task_id).toBe('t_0142')
    expect(goal.workspace.branch).toBe('tinman/t_0142')
    expect(goal.workspace.worktree_path).toBe('/tmp/tinman-data/worktrees/t_0142')
    expect(goal.attachments).toEqual(['shot.png'])
    expect(goal.framework_advice.next_step).toBe(advice.next_step)
    expect(goal.framework_advice.entry_point).toBe(advice.entry_point)
    expect(goal.framework_advice.shared_risk).toBe(advice.shared_risk)
    expect(goal.done_criteria).toEqual(advice.done_criteria)
  })

  it('authorization flags are all false and there is no progress number', () => {
    const goal = draftGoal({
      taskId: 't_0142',
      project,
      partId: part.id,
      wireId: wire.id,
      userIntentVerbatim: [INTENT],
      attachments: [],
      facts: factsFromPart(project, part.id),
      advice,
      worktreePath: '/tmp/tinman-data/worktrees/t_0142',
    })
    expect(goal.authorization).toEqual({
      allow_push: false,
      allow_deploy: false,
      allow_spend: false,
    })
    expect(hasProgressField(goal)).toBe(false)
    expect(JSON.stringify(goal)).not.toMatch(/[%％]/)
    expect(JSON.stringify(goal)).not.toMatch(/"progress"/)
  })

  it('user_intent_verbatim is the composer text unmodified', () => {
    const goal = draftGoal({
      taskId: 't_0142',
      project,
      partId: part.id,
      wireId: wire.id,
      userIntentVerbatim: [INTENT],
      attachments: [],
      facts: { last_commit: 'abc' },
      advice: null,
      adviceUnavailableReason: 'no_key',
      worktreePath: '/tmp/tinman-data/worktrees/t_0142',
    })
    expect(goal.user_intent_verbatim).toEqual([INTENT])
    expect(goal.user_intent_verbatim[0]).toBe(INTENT)
    expect(goal.assumptions.some((a) => a.includes('ASSUMED:') && a.includes('no_key'))).toBe(
      true,
    )
  })
})
