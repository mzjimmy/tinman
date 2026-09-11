/**
 * loadTasks used to pull the full log of EVERY task in the workspace at once —
 * on open, on dispatch, and on every pause/resume/abandon. Bounded per task is
 * not enough when there are hundreds of tasks; the fan-out itself needs a cap,
 * with the rest fetched when a task is actually selected.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { api } from '../lib/api'
import { MAX_PRELOADED_LOGS } from '../domain/logBuffer'
import { useAppState, type AppStore } from './useAppState'
import type { TaskRecord } from '../lib/api'

const task = (i: number, state: string): TaskRecord => ({
  id: `task-${i}`,
  workspace_id: 'ws-1',
  part_id: null,
  wire_id: null,
  goal_json: { intent: `goal ${i}`, criteria: [] } as never,
  state: state as never,
  station: null,
  worktree_path: null,
  dispatched_at: null,
  finished_at: null,
  result_json: null,
})

const rows: TaskRecord[] = [
  ...Array.from({ length: 60 }, (_, i) => task(i, 'done')),
  task(99, 'running'),
]

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTitle: vi.fn(async () => {}) }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    isTauri: vi.fn(() => true),
    onMenu: vi.fn(async () => () => {}),
    onScanProgress: vi.fn(async () => () => {}),
    onTaskState: vi.fn(async () => () => {}),
    onTaskOutput: vi.fn(async () => () => {}),
    onFactsUpdated: vi.fn(async () => () => {}),
    api: {
      ...actual.api,
      getAppPrefs: vi.fn(async () => ({ lastWorkspaceId: 'ws-1' })),
      setAppPrefs: vi.fn(async () => {}),
      listWorkspaces: vi.fn(async () => [{ id: 'ws-1', name: 'ws', root: '/tmp/ws' }]),
      getWorkspace: vi.fn(async () => ({
        id: 'ws-1',
        name: 'ws',
        root: '/tmp/ws',
        parts: [],
        llm_profile_id: null,
      })),
      appPaths: vi.fn(async () => ({
        data_dir: '/tmp/tinman-data',
        worktrees_dir: '/tmp/tinman-data/worktrees',
      })),
      listFiles: vi.fn(async () => ({ name: 'root', path: '/', kind: 'dir' })),
      gitChanges: vi.fn(async () => ({ status: '', diff: '' })),
      getFacts: vi.fn(async () => null),
      listLlmCalls: vi.fn(async () => []),
      listTasks: vi.fn(async () => rows),
      readTaskLog: vi.fn(async () => [{ stream: 'stdout', text: 'hi' }]),
    },
  }
})

function Harness({ capture }: { capture: { current: AppStore | null } }) {
  const store = useAppState()
  capture.current = store
  return null
}

describe('log loading fan-out is bounded', () => {
  it('does not read every task log on open', async () => {
    const capture: { current: AppStore | null } = { current: null }
    render(<Harness capture={capture} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const reads = vi.mocked(api.readTaskLog).mock.calls.length
    expect(reads).toBeLessThanOrEqual(MAX_PRELOADED_LOGS)
    expect(reads).toBeGreaterThan(0)
    cleanup()
  })

  it('fetches a task log when that task is selected', async () => {
    const capture: { current: AppStore | null } = { current: null }
    render(<Harness capture={capture} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    vi.mocked(api.readTaskLog).mockClear()
    await act(async () => {
      capture.current?.selectTask('task-3')
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(vi.mocked(api.readTaskLog).mock.calls.map((c) => c[0])).toContain('task-3')
    cleanup()
  })
})
