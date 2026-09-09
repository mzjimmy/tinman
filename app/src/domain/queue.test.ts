import { describe, expect, it } from 'vitest'
import { confirmDispatch, draftGoal, factsFromPart, plannedWorktreePath } from './dispatch'
import { makeState, rankingProject } from './fixtures'
import {
  abandonTask,
  claimNext,
  DEFAULT_STATION_COUNT,
  deriveBoard,
  drain,
  isRunnable,
  pauseTask,
  resumeTask,
} from './queue'
import type { GoalCard, Task } from './types'

function goalFor(id: string, wireId: string, risk: string): GoalCard {
  const project = rankingProject()
  const part = project.parts[0]!
  return draftGoal({
    taskId: id,
    project,
    partId: part.id,
    wireId,
    userIntentVerbatim: [`intent ${id}`],
    attachments: [],
    facts: factsFromPart(project, part.id),
    advice: {
      diagnosis: '事实不足',
      next_step: 'do',
      entry_point: '.',
      shared_risk: risk,
      done_criteria: ['a', 'b', 'c'],
    },
    worktreePath: plannedWorktreePath(id),
  })
}

describe('queue claim order', () => {
  it('defaults to two stations', () => {
    const board = deriveBoard([], DEFAULT_STATION_COUNT)
    expect(board.stations).toHaveLength(2)
    expect(board.stations.map((s) => s.id)).toEqual(['1', '2'])
  })

  it('third dispatch queues when two stations are busy, then a freed station claims it', () => {
    let state = makeState({ projects: [rankingProject()] })
    expect(state.stations).toHaveLength(2)

    const g1 = goalFor('t_one', 'w-a', 'alpha')
    const g2 = goalFor('t_two', 'w-b', 'beta')
    const g3 = goalFor('t_three', 'w-c', 'gamma')

    state = confirmDispatch(state, g1)
    state = confirmDispatch(state, g2)
    state = confirmDispatch(state, g3)

    const running = state.tasks.filter((t) => t.state === 'running')
    const queued = state.tasks.filter((t) => t.state === 'queued')
    expect(running).toHaveLength(2)
    expect(queued).toHaveLength(1)
    expect(queued[0]!.id).toBe('t_three')
    expect(state.queue).toEqual(['t_three'])
    expect(state.stations.filter((s) => s.taskId)).toHaveLength(2)

    const failedId = running[0]!.id
    const keptId = running[1]!.id
    const tasks = state.tasks.map((t) =>
      t.id === failedId ? { ...t, state: 'failed' as const } : t,
    )
    const drained = drain(tasks, 2)
    const board = deriveBoard(drained, 2)
    const three = drained.find((t) => t.id === 't_three')!
    expect(three.state).toBe('running')
    expect(board.queue).toEqual([])
    expect(drained.find((t) => t.id === keptId)!.state).toBe('running')
    expect(drained.find((t) => t.id === failedId)!.state).toBe('failed')
  })

  it('one failure leaves the other occupying task untouched', () => {
    let state = makeState({ projects: [rankingProject()] })
    state = confirmDispatch(state, goalFor('t_fail', 'w-a', 'alpha'))
    state = confirmDispatch(state, goalFor('t_keep', 'w-b', 'beta'))
    state = confirmDispatch(state, goalFor('t_wait', 'w-c', 'gamma'))
    const keepBefore = state.tasks.find((t) => t.id === 't_keep')!
    const tasks = state.tasks.map((t) =>
      t.id === 't_fail' ? { ...t, state: 'failed' as const } : t,
    )
    const after = drain(tasks, 2)
    const keepAfter = after.find((t) => t.id === 't_keep')!
    expect(keepAfter.state).toBe(keepBefore.state)
    expect(keepAfter.stationId).toBe(keepBefore.stationId)
    expect(after.find((t) => t.id === 't_fail')!.state).toBe('failed')
    expect(after.find((t) => t.id === 't_wait')!.state).toBe('running')
  })

  it('rebuilds stations and queue from the task list', () => {
    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p',
        partId: 'part',
        wireId: 'w-a',
        goal: goalFor('t1', 'w-a', 'alpha'),
        state: 'running',
        stationId: '1',
        dispatchedAt: '2026-09-09T00:00:01+00:00',
      },
      {
        id: 't2',
        projectId: 'p',
        partId: 'part',
        wireId: 'w-b',
        goal: goalFor('t2', 'w-b', 'beta'),
        state: 'queued',
        dispatchedAt: '2026-09-09T00:00:02+00:00',
      },
    ]
    const board = deriveBoard(tasks, 2)
    expect(board.stations[0]!.taskId).toBe('t1')
    expect(board.stations[1]!.taskId).toBeUndefined()
    expect(board.queue).toEqual(['t2'])
    const { claimed } = claimNext(tasks, 2)
    expect(claimed?.id).toBe('t2')
    expect(claimed?.stationId).toBe('2')
  })

  it('c1_pause_resume_round_trip', () => {
    const running: Task = {
      id: 't_run',
      projectId: 'p',
      partId: 'part',
      wireId: 'w-a',
      goal: goalFor('t_run', 'w-a', 'alpha'),
      state: 'running',
      stationId: '1',
      dispatchedAt: '2026-09-09T00:00:01+00:00',
      worktreePath: '/tmp/wt/t_run',
    }
    const paused = pauseTask([running], 't_run', 2)
    expect(paused[0]!.state).toBe('paused')
    expect(paused[0]!.stationId).toBeUndefined()
    const resumed = resumeTask(paused, 't_run', 2)
    expect(resumed[0]!.state).toBe('running')
    expect(resumed[0]!.stationId).toBe('1')
  })

  it('c1_abandon_keeps_the_worktree', () => {
    const running: Task = {
      id: 't_ab',
      projectId: 'p',
      partId: 'part',
      wireId: 'w-a',
      goal: goalFor('t_ab', 'w-a', 'alpha'),
      state: 'running',
      stationId: '1',
      worktreePath: '/tmp/wt/t_ab',
    }
    const after = abandonTask([running], 't_ab', 2)
    expect(after[0]!.state).toBe('abandoned')
    expect(after[0]!.worktreePath).toBe('/tmp/wt/t_ab')
    expect(after[0]!.stationId).toBeUndefined()
  })

  it('paused task frees its station so a queued task can claim it', () => {
    const t1: Task = {
      id: 't1',
      projectId: 'p',
      partId: 'part',
      wireId: 'w-a',
      goal: goalFor('t1', 'w-a', 'alpha'),
      state: 'running',
      stationId: '1',
      dispatchedAt: '2026-09-09T00:00:01+00:00',
    }
    const t2: Task = {
      id: 't2',
      projectId: 'p',
      partId: 'part',
      wireId: 'w-b',
      goal: goalFor('t2', 'w-b', 'beta'),
      state: 'queued',
      dispatchedAt: '2026-09-09T00:00:02+00:00',
    }
    const after = pauseTask([t1, t2], 't1', 2)
    expect(after.find((t) => t.id === 't1')!.state).toBe('paused')
    expect(after.find((t) => t.id === 't2')!.state).toBe('running')
    const board = deriveBoard(after, 2)
    expect(board.stations[0]!.taskId).toBe('t2')
  })

  it('holds a queued task behind a failed owner of the same shared_risk', () => {
    const owner: Task = {
      id: 't_owner',
      projectId: 'p',
      partId: 'part',
      wireId: 'w-shared',
      goal: goalFor('t_owner', 'w-shared', 'db.rs schema'),
      state: 'failed',
      dispatchedAt: '2026-09-09T00:00:01+00:00',
    }
    const dep: Task = {
      id: 't_dep',
      projectId: 'p',
      partId: 'part',
      wireId: 'w-other',
      goal: goalFor('t_dep', 'w-other', 'db.rs schema'),
      state: 'queued',
      dispatchedAt: '2026-09-09T00:00:02+00:00',
    }
    expect(isRunnable(dep, [owner, dep])).toBe(false)
    const { claimed } = claimNext([owner, dep], 2)
    expect(claimed).toBeNull()
  })
})
