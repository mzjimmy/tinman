import { describe, expect, it, beforeEach } from 'vitest'
import { createSeedState } from '../data/demoData'
import {
  confirmDispatch,
  draftGoal,
  resetTaskCounter,
  simulateGenerateGoal,
  simulateRankingSelect,
} from '../domain/dispatch'
import { fleetRanking } from '../domain/shortLeg'

describe('dispatch (C6)', () => {
  beforeEach(() => resetTaskCounter(142))

  it('completes ranking → generate → confirm with goal shape', () => {
    let state = createSeedState()
    const top = fleetRanking(state.projects)[0]!
    state = simulateRankingSelect(state, top.projectId, top.partId)
    expect(state.view).toBe('robot')

    const project = state.projects.find((p) => p.id === top.projectId)!
    const part = project.parts.find((p) => p.id === top.partId)!
    const wireId = part!.wires[0]!.id
    state = { ...state, selectedWireId: wireId }
    state = simulateGenerateGoal(state, project)
    expect(state.showGoalCard).toBe(true)
    expect(state.goalDraft?.authorization.allow_push).toBe(false)
    expect(state.goalDraft?.target.slot).toBeTruthy()

    const goal = state.goalDraft!
    state = confirmDispatch(state, goal)
    const placed = state.tasks[state.tasks.length - 1]!
    expect(placed).toBeDefined()
    expect(['running', 'queued']).toContain(placed.state)
    expect(state.view).toBe('task')
    expect(state.stations.some((s) => s.taskId === placed.id)).toBe(true)
    expect(placed.goal.authorization.allow_deploy).toBe(false)
    expect(placed.goal.workspace.worktree_path).toContain('/tmp/tinman/')
  })

  it('draftGoal matches MD §9.1 fields', () => {
    const state = createSeedState()
    const project = state.projects[0]!
    const part = project.parts[0]!
    const wire = part.wires[0]!
    const goal = draftGoal(project, part.id, wire.id)
    expect(goal.task_id).toMatch(/^t_/)
    expect(goal.authorization.allow_spend).toBe(false)
    expect(goal.done_criteria.length).toBeGreaterThan(0)
  })
})
