/**
 * Memory-exhaustion regression: a chatty child process must not be able to grow
 * the webview heap without bound. The task-output subscription is the hot path —
 * one event per line, for hours.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { TASK_LINE_CAP, LOG_LINE_TEXT_CAP } from '../domain/logBuffer'
import { useAppState, type AppStore } from './useAppState'
import type { TaskOutputEvent } from '../lib/api'

const { hooks } = vi.hoisted(() => ({
  hooks: { output: undefined as ((e: TaskOutputEvent) => void) | undefined },
}))

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
    onTaskOutput: vi.fn(async (handler: (e: TaskOutputEvent) => void) => {
      hooks.output = handler
      return () => {
        hooks.output = undefined
      }
    }),
    onFactsUpdated: vi.fn(async () => () => {}),
    api: {
      ...actual.api,
      getAppPrefs: vi.fn(async () => ({})),
      setAppPrefs: vi.fn(async () => {}),
      listWorkspaces: vi.fn(async () => []),
      appPaths: vi.fn(async () => ({
        data_dir: '/tmp/tinman-data',
        worktrees_dir: '/tmp/tinman-data/worktrees',
      })),
      listFiles: vi.fn(async () => ({ name: 'root', path: '/', kind: 'dir' })),
      gitChanges: vi.fn(async () => ({ status: '', diff: '' })),
      getFacts: vi.fn(async () => null),
      listLlmCalls: vi.fn(async () => []),
      listTasks: vi.fn(async () => []),
      readTaskLog: vi.fn(async () => []),
    },
  }
})

function Harness({ capture }: { capture: { current: AppStore | null } }) {
  const store = useAppState()
  capture.current = store
  return null
}

async function mounted() {
  const capture: { current: AppStore | null } = { current: null }
  render(<Harness capture={capture} />)
  await act(async () => {
    await Promise.resolve()
  })
  return capture
}

describe('task output is bounded', () => {
  it('caps retained lines per task no matter how many arrive', async () => {
    const capture = await mounted()
    expect(hooks.output).toBeTypeOf('function')
    const emit = hooks.output!
    await act(async () => {
      for (let i = 0; i < TASK_LINE_CAP + 1000; i += 1) {
        emit({ task_id: 'task-1', stream: 'stdout', text: `line ${i}` })
      }
    })
    const lines = capture.current?.taskLines['task-1'] ?? []
    expect(lines.length).toBe(TASK_LINE_CAP)
    expect(lines[lines.length - 1].text).toBe(`line ${TASK_LINE_CAP + 999}`)
    cleanup()
  })

  it('truncates one monstrous newline-free line', async () => {
    const capture = await mounted()
    const emit = hooks.output!
    await act(async () => {
      emit({ task_id: 'task-2', stream: 'stdout', text: 'y'.repeat(4 * 1024 * 1024) })
    })
    const lines = capture.current?.taskLines['task-2'] ?? []
    expect(lines).toHaveLength(1)
    expect(lines[0].text.length).toBeLessThanOrEqual(LOG_LINE_TEXT_CAP + 64)
    cleanup()
  })
})
