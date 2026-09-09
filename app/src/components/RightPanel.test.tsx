import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RightPanel } from './RightPanel'
import type { AppStore } from '../hooks/useAppState'
import { draftGoal, factsFromPart, plannedWorktreePath } from '../domain/dispatch'
import { rankingProject } from '../domain/fixtures'
import type { Task } from '../domain/types'

function taskWithLines(): Task {
  const project = rankingProject()
  const part = project.parts[0]!
  const wire = part.wires[0]!
  const goal = draftGoal({
    taskId: 't_term',
    project,
    partId: part.id,
    wireId: wire.id,
    userIntentVerbatim: ['run it'],
    attachments: [],
    facts: factsFromPart(project, part.id),
    advice: null,
    worktreePath: plannedWorktreePath('t_term'),
  })
  return {
    id: 't_term',
    projectId: project.id,
    partId: part.id,
    wireId: wire.id,
    goal,
    state: 'running',
    worktreePath: goal.workspace.worktree_path,
    command: 'stub /tmp/tinman-data/tasks/t_term/goal.json',
  }
}

function miniStore(overrides: Record<string, unknown> = {}): AppStore {
  return {
    rightPanel: 'terminal',
    facts: undefined,
    files: null,
    changes: null,
    tasks: [],
    selectedTaskId: undefined,
    taskLines: {},
    ...overrides,
  } as unknown as AppStore
}

describe('RightPanel terminal (C4)', () => {
  it('renders streamed lines, worktree path and command for the selected task', () => {
    const task = taskWithLines()
    render(
      <RightPanel
        store={miniStore({
          tasks: [task],
          selectedTaskId: task.id,
          taskLines: {
            [task.id]: [
              { task_id: task.id, stream: 'stdout', text: 'one' },
              { task_id: task.id, stream: 'stdout', text: 'two' },
              { task_id: task.id, stream: 'stderr', text: 'warn' },
            ],
          },
        })}
      />,
    )
    expect(screen.getByTestId('terminal-pane')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-worktree').textContent).toBe(task.worktreePath)
    expect(screen.getByTestId('terminal-command').textContent).toContain(task.command)
    expect(screen.getByTestId('terminal-command').textContent).toContain(task.worktreePath)
    expect(screen.getByTestId('terminal-log').textContent).toContain('stdout: one')
    expect(screen.getByTestId('terminal-log').textContent).toContain('stdout: two')
    expect(screen.getByTestId('terminal-log').textContent).toContain('stderr: warn')
  })

  it('renders without a task selected', () => {
    render(<RightPanel store={miniStore()} />)
    expect(screen.getByTestId('terminal-pane')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-worktree').textContent).toContain('未选择任务')
    expect(screen.getByTestId('terminal-log').textContent).toContain('未选择任务')
    expect(screen.getByTestId('terminal-command').textContent).toMatch(/worktree|命令|手工/)
  })
})
