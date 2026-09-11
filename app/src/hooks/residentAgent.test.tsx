/**
 * Round 5 — the resident layer, wired into the running product.
 *
 * Round 4 built autoMap/gaps/drift/patrol as pure domain modules and wired none
 * of them, so a user opening the app saw exactly what they saw before. These
 * tests are written against the store and the real components: they fail unless
 * the import path, the map sheet, and a timer-driven patrol actually use them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { open } from '@tauri-apps/plugin-dialog'
import { api, isTauri, type Facts, type WorkspaceDto } from '../lib/api'
import { AppShell } from '../components/AppShell'
import { useAppState, type AppStore } from './useAppState'
import { ALL_SLOTS } from '../domain/types'

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
    onTaskOutput: vi.fn(async () => () => {}),
    onTaskState: vi.fn(async () => () => {}),
    api: {
      ...actual.api,
      getAppPrefs: vi.fn(async () => ({})),
      setAppPrefs: vi.fn(async () => {}),
      listWorkspaces: vi.fn(async () => []),
      appPaths: vi.fn(async () => ({ data_dir: '/tmp/d', worktrees_dir: '/tmp/d/w' })),
      createWorkspace: vi.fn(),
      scanWorkspace: vi.fn(),
      listFiles: vi.fn(async () => ({ name: 'root', path: '/', kind: 'dir' })),
      gitChanges: vi.fn(async () => ({ status: '', diff: '' })),
      getFacts: vi.fn(async () => null),
      getWorkspace: vi.fn(),
      listLlmCalls: vi.fn(async () => []),
      listTasks: vi.fn(async () => []),
      llmCall: vi.fn(),
      updatePrefs: vi.fn(async () => ({})),
      confirmMap: vi.fn(),
    },
  }
})

const WS: WorkspaceDto = {
  id: 'ws-r5',
  name: 'demo',
  root_path: '/tmp/demo',
  created_at: '2026-09-11T00:00:00Z',
  llm_profile_id: 'p1',
  prefs: {},
  parts: [],
}

function facts(overrides: Partial<Facts> = {}): Facts {
  return {
    root: '/tmp/demo',
    scanned_at: '2026-09-11T00:00:00Z',
    duration_ms: 100,
    file_count: 10,
    by_extension: {},
    loc_by_language: {},
    tree: [
      { name: 'src', kind: 'dir', files: 5 },
      { name: 'api', kind: 'dir', files: 3 },
    ],
    dependencies: [],
    entry_points: { npm_scripts: {}, makefile_targets: [], dockerfile: false, readme_commands: [] },
    tests: { files: [], pass: null, fail: null, note: 'not executed' },
    git: {
      branch: 'main',
      last_commit_at: '2026-09-10T00:00:00Z',
      last_commit_subject: 'x',
      uncommitted: false,
      top_files_30d: [],
    },
    markers: [],
    spec_docs: [],
    design_files: [],
    reference_images: [],
    routes: [],
    api_endpoints: ['GET /health'],
    pages: ['src/pages/Login.tsx'],
    ...overrides,
  }
}

function Harness({ capture }: { capture: { current: AppStore | null } }) {
  const store = useAppState()
  capture.current = store
  return <AppShell store={store} />
}

async function importAFolder() {
  const capture = { current: null as AppStore | null }
  render(<Harness capture={capture} />)
  await waitFor(() => expect(capture.current?.ready).toBe(true))
  await act(async () => {
    fireEvent.click(screen.getByLabelText('add local folder'))
  })
  await waitFor(() => expect(capture.current?.mapOpen).toBe(true))
  return capture
}

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(open).mockReset().mockResolvedValue('/tmp/demo')
  vi.mocked(api.createWorkspace).mockReset().mockResolvedValue(WS)
  vi.mocked(api.scanWorkspace).mockReset().mockResolvedValue(facts())
  vi.mocked(api.getWorkspace).mockReset().mockResolvedValue(WS)
  vi.mocked(api.llmCall).mockReset()
  vi.mocked(api.confirmMap).mockReset().mockResolvedValue(WS)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('R5-A: importing a folder drafts the architecture without asking the user to type', () => {
  it('calls map_architecture on import', async () => {
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'unavailable',
      reason: 'no_key',
      detail: null,
      reject_reason: null,
      call_id: null,
      duration_ms: 1,
    })
    await importAFolder()
    const purposes = vi.mocked(api.llmCall).mock.calls.map((c) => c[1])
    expect(purposes).toContain('map_architecture')
  })

  it('opens the map sheet already filled in, every slot present', async () => {
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'unavailable',
      reason: 'no_key',
      detail: null,
      reject_reason: null,
      call_id: null,
      duration_ms: 1,
    })
    const capture = await importAFolder()
    await waitFor(() => expect(capture.current?.mapDraft).toBeDefined())
    const draft = capture.current!.mapDraft!
    expect(draft.parts.map((p) => p.slot).sort()).toEqual([...ALL_SLOTS].sort())
    const present = draft.parts.filter((p) => p.present)
    expect(present.length).toBeGreaterThan(0)
    for (const p of present) {
      expect(p.wires.length).toBeGreaterThan(0)
      for (const w of p.wires) {
        expect(w.criteria.filter((c) => c.text.trim()).length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('a no-key LLM still yields a usable draft, credited to the heuristic', async () => {
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'unavailable',
      reason: 'no_key',
      detail: null,
      reject_reason: null,
      call_id: null,
      duration_ms: 1,
    })
    const capture = await importAFolder()
    await waitFor(() => expect(capture.current?.mapDraftSource).toBe('heuristic'))
  })

  it('a usable model proposal is credited to the model', async () => {
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'available',
      purpose: 'map_architecture',
      advice: null,
      output: {
        parts: [
          {
            slot: 'torso',
            present: true,
            label: '模型命名的核心',
            weight: 3,
            modulePaths: ['src/'],
            wires: [
              {
                label: '核心流程',
                criteria: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
              },
            ],
          },
        ],
      },
      call_id: 'c1',
      duration_ms: 5,
    })
    const capture = await importAFolder()
    await waitFor(() => expect(capture.current?.mapDraftSource).toBe('llm'))
    const torso = capture.current!.mapDraft!.parts.find((p) => p.slot === 'torso')!
    expect(torso.label).toBe('模型命名的核心')
  })

  it('an LLM error does not break the import', async () => {
    vi.mocked(api.llmCall).mockRejectedValue(new Error('boom'))
    const capture = await importAFolder()
    await waitFor(() => expect(capture.current?.mapDraft).toBeDefined())
    expect(capture.current!.mapDraftSource).toBe('heuristic')
    expect(document.querySelector('.error-banner')).toBeNull()
  })

  it('the drafted sheet can be confirmed with no typing at all', async () => {
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'unavailable',
      reason: 'no_key',
      detail: null,
      reject_reason: null,
      call_id: null,
      duration_ms: 1,
    })
    const confirmMap = vi.fn(async () => WS)
    vi.mocked(api.confirmMap).mockImplementation(confirmMap)
    await importAFolder()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认架构地图' }))
    })
    // No "每条线路需要 3–6 条验收项" — the draft already satisfies the sheet.
    expect(document.querySelector('.form-error')).toBeNull()
    expect(confirmMap).toHaveBeenCalled()
  })
})

describe('R5-B: the sheet explains the repo in words, not in a percentage', () => {
  it('shows the plain-language gaps next to the draft', async () => {
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'unavailable',
      reason: 'no_key',
      detail: null,
      reject_reason: null,
      call_id: null,
      duration_ms: 1,
    })
    const capture = await importAFolder()
    await waitFor(() => expect((capture.current?.gaps ?? []).length).toBeGreaterThan(0))
    const sheet = document.querySelector('.map-sheet')!
    expect(sheet.textContent).toContain('没有注册接口')
  })

  it('INVARIANT: no gap string ever states a progress number', async () => {
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'unavailable',
      reason: 'no_key',
      detail: null,
      reject_reason: null,
      call_id: null,
      duration_ms: 1,
    })
    const capture = await importAFolder()
    await waitFor(() => expect((capture.current?.gaps ?? []).length).toBeGreaterThan(0))
    for (const g of capture.current!.gaps) {
      expect(g.text).not.toMatch(/\d+\s*%/)
    }
  })
})

describe('R5-B2: a late model draft must not overwrite what the user already typed', () => {
  it('keeps the user edit when map_architecture returns after they started', async () => {
    let release: (v: unknown) => void = () => {}
    const pending = new Promise((r) => {
      release = r
    })
    vi.mocked(api.llmCall).mockImplementation(async () => {
      await pending
      return {
        status: 'available',
        purpose: 'map_architecture',
        advice: null,
        output: {
          parts: [
            {
              slot: 'torso',
              present: true,
              label: '模型后到的名字',
              weight: 3,
              modulePaths: [],
              wires: [
                { label: 'w', criteria: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] },
              ],
            },
          ],
        },
        call_id: 'c',
        duration_ms: 1,
      }
    })
    await importAFolder()

    const nameField = screen.getByLabelText('torso label') as HTMLInputElement
    await act(async () => {
      fireEvent.change(nameField, { target: { value: '用户自己写的名字' } })
    })

    await act(async () => {
      release(null)
      await Promise.resolve()
    })

    expect((screen.getByLabelText('torso label') as HTMLInputElement).value).toBe('用户自己写的名字')
  })
})

describe('R5-C: a resident patrol actually runs', () => {
  it('rescans a due workspace on its own, with no user action', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(api.listWorkspaces).mockResolvedValue([
      { id: 'ws-r5', name: 'demo', root_path: '/tmp/demo', created_at: 'x', llm_profile_id: null, prefs: { mapConfirmed: true } },
    ])
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'unavailable',
      reason: 'no_key',
      detail: null,
      reject_reason: null,
      call_id: null,
      duration_ms: 1,
    })
    const capture = { current: null as AppStore | null }
    render(<Harness capture={capture} />)
    await waitFor(() => expect(capture.current?.ready).toBe(true))
    const before = vi.mocked(api.scanWorkspace).mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000)
    })

    expect(vi.mocked(api.scanWorkspace).mock.calls.length).toBeGreaterThan(before)
  })

  it('exposes a patrol state the user can see and switch off', async () => {
    const capture = { current: null as AppStore | null }
    render(<Harness capture={capture} />)
    await waitFor(() => expect(capture.current?.ready).toBe(true))
    expect(typeof capture.current!.patrolEnabled).toBe('boolean')
    await act(async () => {
      capture.current!.setPatrolEnabled(false)
    })
    await waitFor(() => expect(capture.current!.patrolEnabled).toBe(false))
  })

  it('a switched-off patrol does not scan', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(api.listWorkspaces).mockResolvedValue([
      { id: 'ws-r5', name: 'demo', root_path: '/tmp/demo', created_at: 'x', llm_profile_id: null, prefs: { mapConfirmed: true } },
    ])
    const capture = { current: null as AppStore | null }
    render(<Harness capture={capture} />)
    await waitFor(() => expect(capture.current?.ready).toBe(true))
    await act(async () => {
      capture.current!.setPatrolEnabled(false)
    })
    const before = vi.mocked(api.scanWorkspace).mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000)
    })
    expect(vi.mocked(api.scanWorkspace).mock.calls.length).toBe(before)
  })

  it('INVARIANT: a patrol pass never changes a met criterion', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const confirmed: WorkspaceDto = {
      ...WS,
      prefs: { mapConfirmed: true },
      parts: [
        {
          id: 'part-torso',
          workspace_id: 'ws-r5',
          slot: 'torso',
          label: '核心',
          weight: 3,
          planned_start: null,
          status: 'in_progress',
          wires: [
            {
              id: 'w1',
              part_id: 'part-torso',
              label: '核心流程',
              criteria: [
                { text: 'a', met: true, evidence: 'e' },
                { text: 'b', met: false, evidence: '' },
              ],
              progress: 50,
              status: 'in_progress',
              updated_at: '2026-09-10T00:00:00Z',
            },
          ],
        },
      ],
    }
    vi.mocked(api.listWorkspaces).mockResolvedValue([
      { id: 'ws-r5', name: 'demo', root_path: '/tmp/demo', created_at: 'x', llm_profile_id: null, prefs: { mapConfirmed: true } },
    ])
    vi.mocked(api.getWorkspace).mockResolvedValue(confirmed)
    const capture = { current: null as AppStore | null }
    render(<Harness capture={capture} />)
    await waitFor(() => expect(capture.current?.ready).toBe(true))

    const metBefore = capture.current!.projects
      .flatMap((p) => p.parts.flatMap((pt) => pt.wires.flatMap((w) => w.criteria.map((c) => c.met))))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000)
    })

    const metAfter = capture.current!.projects
      .flatMap((p) => p.parts.flatMap((pt) => pt.wires.flatMap((w) => w.criteria.map((c) => c.met))))
    expect(metAfter).toEqual(metBefore)
  })
})
