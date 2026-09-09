import { describe, expect, it, beforeEach } from 'vitest'
import {
  confirmDispatch,
  draftGoal,
  factsFromPart,
  plannedWorktreePath,
  resetTaskCounter,
  simulateGenerateGoal,
  simulateRankingSelect,
} from './dispatch'
import { fleetRanking } from './shortLeg'
import { makeState, rankingProject } from './fixtures'

describe('dispatch (C6)', () => {
  beforeEach(() => resetTaskCounter(142))

  it('completes ranking → generate → confirm with goal shape', () => {
    let state = makeState({ projects: [rankingProject()] })
    const top = fleetRanking(state.projects)[0]!
    state = simulateRankingSelect(state, top.projectId, top.partId)
    expect(state.view).toBe('robot')

    const project = state.projects.find((p) => p.id === top.projectId)!
    const part = project.parts.find((p) => p.id === top.partId)!
    const wireId = part.wires[0]!.id
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
    expect(placed.goal.workspace.worktree_path).toContain('/worktrees/')
    expect(placed.goal.workspace.worktree_path).not.toContain(project.root)
  })

  it('draftGoal matches MD §9.1 fields', () => {
    const project = rankingProject()
    const part = project.parts[0]!
    const wire = part.wires[0]!
    const goal = draftGoal({
      taskId: 't_0142',
      project,
      partId: part.id,
      wireId: wire.id,
      userIntentVerbatim: ['提交后自动跑测试，失败要告诉我哪一条'],
      attachments: [],
      facts: factsFromPart(project, part.id),
      advice: null,
      worktreePath: plannedWorktreePath('t_0142'),
    })
    expect(goal.task_id).toMatch(/^t_/)
    expect(goal.authorization.allow_spend).toBe(false)
    expect(goal.done_criteria.length).toBeGreaterThan(0)
  })

  it('c1_three_clicks_from_ranking_to_dispatch', () => {
    const actions: string[] = []
    let state = makeState({
      projects: [rankingProject()],
      composerDraft: '提交后自动跑测试，失败要告诉我哪一条',
    })
    const top = fleetRanking(state.projects)[0]!
    const project = state.projects.find((p) => p.id === top.projectId)!
    const part = project.parts.find((p) => p.id === top.partId)!

    actions.push('ranking-row')
    state = simulateRankingSelect(state, top.projectId, top.partId)
    expect(state.view).toBe('robot')
    expect(state.selectedPartId).toBe(top.partId)

    actions.push('generate-task')
    state = simulateGenerateGoal(state, project, part.wires[0]!.id)
    expect(state.showGoalCard).toBe(true)
    expect(state.goalDraft).toBeDefined()
    expect(state.goalDraft?.user_intent_verbatim).toEqual([
      '提交后自动跑测试，失败要告诉我哪一条',
    ])

    actions.push('confirm-dispatch')
    state = confirmDispatch(state, state.goalDraft!)
    expect(state.tasks).toHaveLength(1)
    expect(state.view).toBe('task')
    expect(state.showGoalCard).toBe(false)
    expect(state.rightPanel).toBe('terminal')
    expect(state.selectedTaskId).toBe(state.tasks[0]!.id)

    expect(actions).toEqual(['ranking-row', 'generate-task', 'confirm-dispatch'])
    expect(actions).toHaveLength(3)
  })
})
