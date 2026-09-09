import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskView } from './TaskView'
import type { AppStore } from '../hooks/useAppState'
import { draftGoal, factsFromPart, plannedWorktreePath } from '../domain/dispatch'
import { rankingProject } from '../domain/fixtures'
import type { GoalCard, Task, TaskState } from '../domain/types'

function goal(id: string): GoalCard {
  const project = rankingProject()
  const part = project.parts[0]!
  return draftGoal({
    taskId: id,
    project,
    partId: part.id,
    wireId: part.wires[0]!.id,
    userIntentVerbatim: ['run'],
    attachments: [],
    facts: factsFromPart(project, part.id),
    advice: {
      diagnosis: '事实不足',
      next_step: 'do',
      entry_point: '.',
      shared_risk: 'none',
      done_criteria: ['a', 'b', 'c'],
    },
    worktreePath: plannedWorktreePath(id),
  })
}

function task(partial: Partial<Task> & { id: string; state: TaskState }): Task {
  const g = partial.goal ?? goal(partial.id)
  return {
    projectId: 'p-demo',
    partId: 'p1-ll',
    wireId: 'w1',
    worktreePath: plannedWorktreePath(partial.id),
    ...partial,
    goal: g,
  }
}

function miniStore(overrides: Record<string, unknown> = {}): AppStore {
  return {
    selectedProjectId: 'p-demo',
    selectedProject: { name: '示例项目' },
    tasks: [],
    selectedTaskId: undefined,
    stationCount: 2,
    stations: [
      { id: '1', label: '工位 1' },
      { id: '2', label: '工位 2' },
    ],
    dispatchTarget: 'this-pc',
    selectTask: vi.fn(),
    setStationCount: vi.fn(),
    ...overrides,
  } as unknown as AppStore
}

describe('TaskView board', () => {
  it('renders two station rows by default', () => {
    render(<TaskView store={miniStore()} />)
    expect(screen.getByTestId('station-工位 1')).toBeInTheDocument()
    expect(screen.getByTestId('station-工位 2')).toBeInTheDocument()
    expect(screen.queryByTestId('station-工位 3')).not.toBeInTheDocument()
  })

  it('shows a queued task behind two busy stations', () => {
    const t1 = task({ id: 't1', state: 'running', stationId: '1' })
    const t2 = task({ id: 't2', state: 'running', stationId: '2' })
    const t3 = task({
      id: 't3',
      state: 'queued',
      goal: goal('t3'),
    })
    render(<TaskView store={miniStore({ tasks: [t1, t2, t3] })} />)
    expect(screen.getByTestId('task-queue')).toBeInTheDocument()
    expect(screen.getByTestId('queued-t3')).toBeInTheDocument()
    expect(screen.getByTestId('station-工位 1').textContent).toContain('正在实现')
    expect(screen.getByTestId('station-工位 2').textContent).toContain('正在实现')
  })

  it('a failed task shows only its own failure', () => {
    const running = task({ id: 't_run', state: 'running', stationId: '1' })
    const failed = task({
      id: 't_fail',
      state: 'failed',
      result: { error: 'exit 1: unique-failure-token', exit_code: 1 },
    })
    render(<TaskView store={miniStore({ tasks: [running, failed] })} />)
    expect(screen.getByTestId('failure-t_fail').textContent).toContain('unique-failure-token')
    expect(screen.queryByTestId('failure-t_run')).not.toBeInTheDocument()
    expect(screen.getByTestId('station-工位 1').textContent).not.toContain('unique-failure-token')
    expect(screen.getByTestId('station-工位 2').textContent).not.toContain('unique-failure-token')
  })

  it('a finished task shows the four fixed sections from the verification result', () => {
    const done = task({
      id: 't_done',
      state: 'done',
      result: {
        verification: {
          all_met: true,
          criteria: [
            { text: 'README.md records the change', met: true, evidence: 'git:README.md' },
          ],
        },
        summary: {
          try_it: '/tmp/tinman-data/worktrees/t_done',
          built: ['README.md'],
          checked: [
            { text: 'README.md records the change', evidence: 'git:README.md' },
          ],
          still_wrong: [],
        },
      },
    })
    render(<TaskView store={miniStore({ tasks: [done] })} />)
    const card = screen.getByTestId('task-summary-t_done')
    expect(card.textContent).toContain('打开试用')
    expect(card.textContent).toContain('做成了什么')
    expect(card.textContent).toContain('检查了什么')
    expect(card.textContent).toContain('还有什么没做好')
    expect(card.textContent).toContain('/tmp/tinman-data/worktrees/t_done')
    expect(card.textContent).toContain('README.md')
    expect(card.textContent).toContain('git:README.md')
    const order = ['打开试用', '做成了什么', '检查了什么', '还有什么没做好']
    const text = card.textContent ?? ''
    let last = -1
    for (const heading of order) {
      const at = text.indexOf(heading)
      expect(at).toBeGreaterThan(last)
      last = at
    }
  })
})
