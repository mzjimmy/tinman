/**
 * WP1: addFolder failure honesty.
 *
 * addFolder itself has no timers. waitFor only flushes the open()/IPC
 * microtasks — no wall-clock sleep.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { open } from '@tauri-apps/plugin-dialog'
import { api, isTauri } from '../lib/api'
import { AppShell } from '../components/AppShell'
import { StubDialog } from '../components/TaskView'
import { useAppState, type AppStore } from './useAppState'

const { mockMenu, mockFacts } = vi.hoisted(() => ({
  mockMenu: { handler: undefined as ((id: string) => void) | undefined },
  mockFacts: { handler: undefined as ((e: unknown) => void) | undefined },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTitle: vi.fn(async () => {}) }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    onMenu: vi.fn(async (handler: (id: string) => void) => {
      mockMenu.handler = handler
      return () => {
        mockMenu.handler = undefined
      }
    }),
    onScanProgress: vi.fn(async () => () => {}),
    onTaskOutput: vi.fn(async () => () => {}),
    onTaskState: vi.fn(async () => () => {}),
    onFactsUpdated: vi.fn(async (handler: (e: unknown) => void) => {
      mockFacts.handler = handler
      return () => {
        mockFacts.handler = undefined
      }
    }),
    api: {
      ...actual.api,
      getAppPrefs: vi.fn(async () => ({})),
      setAppPrefs: vi.fn(async () => {}),
      updatePrefs: vi.fn(async () => ({})),
      listWorkspaces: vi.fn(async () => []),
      appPaths: vi.fn(async () => ({
        data_dir: '/tmp/tinman-data',
        worktrees_dir: '/tmp/tinman-data/worktrees',
      })),
      createWorkspace: vi.fn(),
      scanWorkspace: vi.fn(),
      listFiles: vi.fn(async () => ({ name: 'root', path: '/', kind: 'dir' })),
      gitChanges: vi.fn(async () => ({ status: '', diff: '' })),
      getFacts: vi.fn(async () => null),
      getWorkspace: vi.fn(),
      listLlmCalls: vi.fn(async () => []),
      listTasks: vi.fn(async () => []),
      setWorkspaceLlmProfile: vi.fn(async () => {}),
      setLlmKey: vi.fn(async () => {}),
      llmCall: vi.fn(),
    },
  }
})

function Harness({ capture }: { capture: { current: AppStore | null } }) {
  const store = useAppState()
  capture.current = store
  return <AppShell store={store} />
}

function assertDesktopHint() {
  const dialog = screen.getByRole('dialog')
  const text = dialog.textContent ?? ''
  expect(text).not.toMatch(/round 2/i)
  expect(text).toContain('npm run tauri dev')
  expect(text).toMatch(/桌面应用/)
  expect(dialog.querySelector('h3')?.textContent).toMatch(/[\u4e00-\u9fff]/)
}

function closeHint() {
  fireEvent.click(screen.getByRole('button', { name: '知道了' }))
  expect(screen.queryByRole('dialog')).toBeNull()
}

async function renderBrowser() {
  vi.mocked(isTauri).mockReturnValue(false)
  const capture = { current: null as AppStore | null }
  render(<Harness capture={capture} />)
  await waitFor(() => expect(capture.current).not.toBeNull())
  return capture
}

async function renderDesktop() {
  vi.mocked(isTauri).mockReturnValue(true)
  const capture = { current: null as AppStore | null }
  render(<Harness capture={capture} />)
  await waitFor(() => expect(capture.current?.ready).toBe(true))
  return capture
}

beforeEach(() => {
  mockMenu.handler = undefined
  mockFacts.handler = undefined
  vi.mocked(isTauri).mockReturnValue(false)
  vi.mocked(open).mockReset()
  vi.mocked(api.createWorkspace).mockReset()
  vi.mocked(api.scanWorkspace).mockReset()
  vi.mocked(api.llmCall).mockReset()
})

afterEach(() => {
  cleanup()
})

describe('addFolder honesty', () => {
  it('c1_non_tauri_every_add_folder_entry_shows_desktop_hint', async () => {
    const capture = await renderBrowser()

    fireEvent.click(screen.getByLabelText('add local folder'))
    assertDesktopHint()
    closeHint()

    // WP2 removed the duplicate "New Project" button: it and the "+" icon were
    // the same action rendered twice in one 260px rail. Guard the property that
    // replaced it — the rail exposes exactly one add-folder entry, so no second
    // control can drift out of sync with the hint above.
    expect(screen.queryByRole('button', { name: 'New Project' })).toBeNull()
    const railEntries = Array.from(
      document.querySelectorAll<HTMLElement>('.left-bar button'),
    ).filter((b) => /add local folder|New Project|添加本地文件夹/i.test(
      `${b.getAttribute('aria-label') ?? ''}${b.textContent ?? ''}`,
    ))
    expect(railEntries).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Robot' }))
    fireEvent.click(screen.getByRole('button', { name: '添加本地文件夹' }))
    assertDesktopHint()
    closeHint()

    // File → Add Local Folder… is a native menu. In the desktop app it fires
    // onMenu('add-folder') which calls addFolder. jsdom never subscribes
    // (listen is gated on isTauri), so this is the same function the menu uses.
    await act(async () => {
      await capture.current!.addFolder()
    })
    assertDesktopHint()
  })

  it('c2_dialog_error_shows_banner_and_clears_overlay', async () => {
    vi.mocked(open).mockRejectedValue(new Error('dialog-open-sentinel'))
    await renderDesktop()
    await waitFor(() => expect(mockMenu.handler).toEqual(expect.any(Function)))

    await act(async () => {
      mockMenu.handler!('add-folder')
    })

    await waitFor(() => {
      expect(document.querySelector('.error-banner')?.textContent).toContain('dialog-open-sentinel')
    })
    expect(document.querySelector('.scan-overlay')).toBeNull()
  })

  it('c2_cancel_is_silent_no_error_no_overlay_no_project', async () => {
    vi.mocked(open).mockResolvedValue(null)
    const capture = await renderDesktop()
    const before = capture.current!.projects.length

    await act(async () => {
      fireEvent.click(screen.getByLabelText('add local folder'))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.querySelector('.error-banner')).toBeNull()
    expect(document.querySelector('.scan-overlay')).toBeNull()
    expect(capture.current!.projects.length).toBe(before)
    expect(capture.current!.scanning).toBe(false)
  })

  it('c3_create_workspace_error_shows_banner_and_clears_overlay', async () => {
    vi.mocked(open).mockResolvedValue('/tmp/tinman-c3-create')
    vi.mocked(api.createWorkspace).mockRejectedValue(new Error('create-workspace-sentinel'))
    await renderDesktop()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('add local folder'))
    })

    await waitFor(() => {
      expect(document.querySelector('.error-banner')?.textContent).toContain(
        'create-workspace-sentinel',
      )
    })
    expect(document.querySelector('.scan-overlay')).toBeNull()
  })

  it('c3_scan_error_shows_banner_and_clears_overlay', async () => {
    vi.mocked(open).mockResolvedValue('/tmp/tinman-c3-scan')
    vi.mocked(api.createWorkspace).mockResolvedValue({
      id: 'ws-c3',
      name: 'tinman-c3-scan',
      root_path: '/tmp/tinman-c3-scan',
      created_at: '2026-01-01T00:00:00Z',
      llm_profile_id: null,
      prefs: {},
      parts: [],
    })
    vi.mocked(api.scanWorkspace).mockRejectedValue(new Error('scan-workspace-sentinel'))
    await renderDesktop()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('add local folder'))
    })

    await waitFor(() => {
      expect(document.querySelector('.error-banner')?.textContent).toContain('scan-workspace-sentinel')
    })
    expect(document.querySelector('.scan-overlay')).toBeNull()
  })

  it('c4_stub_dialog_body_does_not_mention_round_2', async () => {
    await renderBrowser()
    fireEvent.click(screen.getByRole('button', { name: 'Automations' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).not.toMatch(/round 2/i)
    expect(dialog.querySelector('h3')?.textContent).toBe('Automations')

    cleanup()
    render(<StubDialog label="Customize" onClose={() => undefined} />)
    expect(screen.getByRole('dialog').textContent).not.toMatch(/round 2/i)
  })
})

/**
 * R2 / C1 — saving a profile must auto-select it (state + db + projects map),
 * and save failures must surface via the error banner, not be swallowed.
 *
 * Tests run in browser mode by default (isTauri = false), which exercises the
 * state-only path. A separate test in desktop mode exercises the db write.
 */
describe('saveLlmProfile (R2 C1)', () => {
  it('c1_browser_save_sets_llmProfile_state_to_new_id', async () => {
    const capture = await renderBrowser()
    expect(capture.current!.llmProfile).toBe('')
    expect(capture.current!.llmProfiles).toHaveLength(0)

    await act(async () => {
      await capture.current!.saveLlmProfile(
        {
          id: 'deep',
          kind: 'deepseek',
          base_url: 'https://api.deepseek.com',
          model: 'deepseek-chat',
          key_ref: 'deep',
        },
        'sk-secret',
      )
    })

    expect(capture.current!.llmProfile).toBe('deep')
    expect(capture.current!.llmProfiles.map((p) => p.id)).toEqual(['deep'])
  })

  it('c1_desktop_save_calls_setWorkspaceLlmProfile_and_updates_projects', async () => {
    // Desktop mode + a real workspace selected so setWorkspaceLlmProfile is
    // called against the current workspace id.
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(api.listWorkspaces).mockResolvedValue([
      {
        id: 'ws-1',
        name: 'ws-1',
        root_path: '/tmp/ws-1',
        created_at: '2026-01-01T00:00:00Z',
        llm_profile_id: null,
        prefs: {},
      },
    ])
    vi.mocked(api.getWorkspace).mockResolvedValue({
      id: 'ws-1',
      name: 'ws-1',
      root_path: '/tmp/ws-1',
      created_at: '2026-01-01T00:00:00Z',
      llm_profile_id: null,
      prefs: {},
      parts: [],
    })
    vi.mocked(api.getAppPrefs).mockResolvedValue({})
    vi.mocked(api.setWorkspaceLlmProfile).mockClear()
    vi.mocked(api.setAppPrefs).mockClear()

    const capture = { current: null as AppStore | null }
    render(<Harness capture={capture} />)
    await waitFor(() => expect(capture.current?.ready).toBe(true))
    await waitFor(() => expect(capture.current?.selectedProjectId).toBe('ws-1'))

    await act(async () => {
      await capture.current!.saveLlmProfile(
        {
          id: 'deep',
          kind: 'deepseek',
          base_url: 'https://api.deepseek.com',
          model: 'deepseek-chat',
          key_ref: 'deep',
        },
        'sk-secret',
      )
    })

    expect(capture.current!.llmProfile).toBe('deep')
    expect(api.setWorkspaceLlmProfile).toHaveBeenCalledWith('ws-1', 'deep')
    const project = capture.current!.projects.find((p) => p.id === 'ws-1')
    expect(project?.llmProfileId).toBe('deep')
    // keychain path: secret is set with the resolved key_ref
    expect(api.setLlmKey).toHaveBeenCalledWith('deep', 'sk-secret')
  })

  it('c1_save_failure_surfaces_via_setError_banner', async () => {
    // Initial load: getAppPrefs/setAppPrefs succeed so no error banner is up.
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(api.getAppPrefs).mockResolvedValue({})
    vi.mocked(api.setAppPrefs).mockClear()
    vi.mocked(api.setAppPrefs).mockResolvedValue(undefined)

    const capture = { current: null as AppStore | null }
    render(<Harness capture={capture} />)
    await waitFor(() => expect(capture.current?.ready).toBe(true))
    // Sanity: no error banner before the failing save
    expect(document.querySelector('.error-banner')).toBeNull()

    // Now flip setAppPrefs to reject — saveLlmProfile is the next path that
    // calls it (persistChrome only re-fires on selectedProject/view changes).
    let rejectOnce = false
    vi.mocked(api.setAppPrefs).mockImplementation(async () => {
      if (!rejectOnce) {
        rejectOnce = true
        throw new Error('save-prefs-sentinel')
      }
    })

    // saveLlmProfile should catch the rejection internally; we still await
    // so the unhandled-rejection warning doesn't escape the test runner.
    let captured: unknown = undefined
    await act(async () => {
      try {
        await capture.current!.saveLlmProfile(
          {
            id: 'broken',
            kind: 'ollama',
            base_url: 'http://127.0.0.1:11434/v1',
            model: 'qwen2.5',
            key_ref: null,
          },
        )
      } catch (e) {
        captured = e
      }
    })
    void captured

    await waitFor(() => {
      expect(document.querySelector('.error-banner')?.textContent).toContain(
        'save-prefs-sentinel',
      )
    })
  })
})

/**
 * R2 / C1 (post-fix) — composer send must not be blocked by the
 * "当前部件没有线路，无法发送" gate when the user has a project and a
 * (possibly empty-wires) part selected. Wires are the dispatch target,
 * not a prerequisite for asking the LLM to draft a goal. Regression
 * covers:
 *   - selectedPartId set, part has no wires → no blocking banner, goalDraft
 *     is produced and api.llmCall runs draft_goal
 *   - selectedProjectId set, no selectedPartId → auto-resolve a part and
 *     still produce a goalDraft
 *   - empty draft stays a no-op (regression guard for the new gate shape)
 *
 * The previous gate short-circuited on `part.wires.length === 0`. The
 * replacement gate is "no project" (error) or "project has zero parts"
 * (error). Everything in between reaches generateGoal.
 */
describe('sendComposer (C1 composer send gate)', () => {
  function partDto(opts: {
    id: string
    slot: string
    label: string
    wires: Array<{
      id: string
      label: string
      criteria: { text: string; met: boolean; evidence: string }[]
      progress: number
      status: string
    }>
  }) {
    return {
      id: opts.id,
      workspace_id: 'ws-1',
      slot: opts.slot,
      label: opts.label,
      weight: 2,
      planned_start: null,
      status: opts.wires.length === 0 ? 'unmapped' : 'pending',
      wires: opts.wires.map((w) => ({
        id: w.id,
        part_id: opts.id,
        label: w.label,
        criteria: w.criteria,
        progress: w.progress,
        status: w.status,
        updated_at: '2026-01-01T00:00:00Z',
      })),
    }
  }

  function workspaceDto(parts: ReturnType<typeof partDto>[]) {
    return {
      id: 'ws-1',
      name: 'ws-1',
      root_path: '/tmp/ws-1',
      created_at: '2026-01-01T00:00:00Z',
      llm_profile_id: null,
      prefs: {},
      parts,
    }
  }

  async function bootDesktop(parts: ReturnType<typeof partDto>[]) {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(api.listWorkspaces).mockResolvedValue([
      {
        id: 'ws-1',
        name: 'ws-1',
        root_path: '/tmp/ws-1',
        created_at: '2026-01-01T00:00:00Z',
        llm_profile_id: null,
        prefs: {},
      },
    ])
    vi.mocked(api.getWorkspace).mockResolvedValue(workspaceDto(parts))
    vi.mocked(api.getAppPrefs).mockResolvedValue({})
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'unavailable',
      reason: 'no_profile',
      detail: null,
      reject_reason: null,
      call_id: null,
      duration_ms: 0,
    })
    const capture = { current: null as AppStore | null }
    render(<Harness capture={capture} />)
    await waitFor(() => expect(capture.current?.ready).toBe(true))
    await waitFor(() => expect(capture.current?.selectedProjectId).toBe('ws-1'))
    return capture
  }

  it('c1_selected_part_with_no_wires_does_not_set_blocking_banner_and_drafts_goal', async () => {
    const ghost = partDto({ id: 'p-ghost', slot: 'head', label: '决策 / 算法', wires: [] })
    const capture = await bootDesktop([ghost])

    act(() => {
      capture.current!.selectPart('p-ghost')
    })
    act(() => {
      capture.current!.setComposerDraft('分析这个项目')
    })
    await act(async () => {
      await capture.current!.sendComposer()
    })

    // The exact blocking string must not be set.
    expect(capture.current!.error).not.toBe('当前部件没有线路，无法发送')
    // The goal draft must exist, with the user's intent captured verbatim.
    expect(capture.current!.goalDraft).toBeDefined()
    expect(capture.current!.goalDraft!.user_intent_verbatim).toEqual(['分析这个项目'])
    // draft_goal is the analyze-project path — it must actually have run,
    // not been short-circuited.
    expect(api.llmCall).toHaveBeenCalledWith(
      'ws-1',
      'draft_goal',
      expect.objectContaining({ intent: '分析这个项目' }),
    )
    // The goal card surfaces so the user can see what got proposed.
    expect(capture.current!.showGoalCard).toBe(true)
    // No error-banner element in the DOM.
    expect(document.querySelector('.error-banner')).toBeNull()
  })

  it('c1_no_part_selected_with_project_auto_resolves_to_a_part_and_drafts_goal', async () => {
    // Mixed: a ghost part (no wires) and a real part with one wire.
    // The auto-resolver must prefer the part that has wires.
    const ghost = partDto({ id: 'p-ghost', slot: 'head', label: '决策 / 算法', wires: [] })
    const real = partDto({
      id: 'p-real',
      slot: 'torso',
      label: '核心域',
      wires: [
        {
          id: 'w-real',
          label: '核心',
          criteria: [{ text: '跑通', met: false, evidence: '' }],
          progress: 0,
          status: 'pending',
        },
      ],
    })
    const capture = await bootDesktop([ghost, real])

    act(() => {
      capture.current!.setComposerDraft('分析这个项目')
    })
    await act(async () => {
      await capture.current!.sendComposer()
    })

    expect(capture.current!.error).not.toBe('当前部件没有线路，无法发送')
    expect(capture.current!.goalDraft).toBeDefined()
    // Auto-resolved to the part with wires (p-real), not the empty-wires ghost.
    expect(capture.current!.selectedPartId).toBe('p-real')
    expect(capture.current!.selectedWireId).toBe('w-real')
    expect(capture.current!.goalDraft!.user_intent_verbatim).toEqual(['分析这个项目'])
  })

  it('c1_no_part_selected_with_only_empty_wires_parts_still_drafts_a_goal', async () => {
    // Edge case: every part is empty. The gate must still let the LLM draft.
    const ghost1 = partDto({ id: 'p-g1', slot: 'head', label: 'A', wires: [] })
    const ghost2 = partDto({ id: 'p-g2', slot: 'torso', label: 'B', wires: [] })
    const capture = await bootDesktop([ghost1, ghost2])

    act(() => {
      capture.current!.setComposerDraft('分析这个项目')
    })
    await act(async () => {
      await capture.current!.sendComposer()
    })

    expect(capture.current!.error).not.toBe('当前部件没有线路，无法发送')
    expect(capture.current!.goalDraft).toBeDefined()
    // Falls back to project.parts[0].
    expect(capture.current!.selectedPartId).toBe('p-g1')
    // No wire existed, so the goal targets the 未知线路 fallback.
    expect(capture.current!.goalDraft!.target.wire).toBe('未知线路')
  })

  it('c1_empty_draft_still_a_noop_with_new_gate', async () => {
    const ghost = partDto({ id: 'p-ghost', slot: 'head', label: '决策 / 算法', wires: [] })
    const capture = await bootDesktop([ghost])

    act(() => {
      capture.current!.selectPart('p-ghost')
    })
    act(() => {
      capture.current!.setComposerDraft('   ')
    })
    await act(async () => {
      await capture.current!.sendComposer()
    })

    expect(capture.current!.error).toBeUndefined()
    expect(capture.current!.goalDraft).toBeUndefined()
    expect(api.llmCall).not.toHaveBeenCalled()
  })

  it('c1_part_with_wires_still_uses_first_wire_when_no_selectedWireId', async () => {
    const real = partDto({
      id: 'p-real',
      slot: 'torso',
      label: '核心域',
      wires: [
        { id: 'w-1', label: 'W1', criteria: [], progress: 0, status: 'pending' },
        { id: 'w-2', label: 'W2', criteria: [], progress: 0, status: 'pending' },
      ],
    })
    const capture = await bootDesktop([real])

    act(() => {
      capture.current!.selectPart('p-real')
    })
    act(() => {
      capture.current!.setComposerDraft('分析这个项目')
    })
    await act(async () => {
      await capture.current!.sendComposer()
    })

    expect(capture.current!.error).toBeUndefined()
    expect(capture.current!.goalDraft).toBeDefined()
    expect(capture.current!.selectedWireId).toBe('w-1')
  })
})

function sampleFacts(): import('../lib/api').Facts {
  return {
    root: '/tmp/tinman-auto',
    scanned_at: '2026-09-11T00:00:00Z',
    duration_ms: 12,
    file_count: 6,
    by_extension: { ts: 5, json: 1 },
    loc_by_language: { TypeScript: 20 },
    tree: [
      { name: 'src', kind: 'dir', files: 3 },
      { name: 'web', kind: 'dir', files: 2 },
      { name: 'docker', kind: 'dir', files: 1 },
    ],
    dependencies: [],
    entry_points: { npm_scripts: {}, makefile_targets: [], dockerfile: true, readme_commands: [] },
    tests: { files: [], pass: null, fail: null, note: 'existence only; tests were not executed' },
    git: {
      branch: 'main',
      last_commit_at: '2026-09-10T00:00:00Z',
      last_commit_subject: 'init',
      uncommitted: false,
      top_files_30d: [],
    },
    markers: [{ kind: 'TODO', path: 'src/main.ts', line: 2 }],
    spec_docs: [],
    design_files: [],
    reference_images: [],
    routes: [],
    api_endpoints: [],
    pages: [],
  }
}

describe('auto architecture draft + resident facts', () => {
  it('addFolder prefills the map from scan facts and asks map_architecture without blocking on the model', async () => {
    vi.mocked(open).mockResolvedValue('/tmp/tinman-auto')
    vi.mocked(api.createWorkspace).mockResolvedValue({
      id: 'ws-auto',
      name: 'tinman-auto',
      root_path: '/tmp/tinman-auto',
      created_at: '2026-09-11T00:00:00Z',
      llm_profile_id: null,
      prefs: { mapConfirmed: false },
      parts: [],
    })
    vi.mocked(api.scanWorkspace).mockResolvedValue(sampleFacts())
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'unavailable',
      reason: 'no_profile',
      detail: null,
      reject_reason: null,
      call_id: null,
      duration_ms: 0,
    })
    const capture = await renderDesktop()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('add local folder'))
    })

    await waitFor(() => expect(capture.current!.mapOpen).toBe(true))
    const draft = capture.current!.mapDraft
    expect(draft).toBeDefined()
    const bySlot = Object.fromEntries((draft?.parts ?? []).map((p) => [p.slot, p]))
    expect(bySlot.torso?.modulePaths).toContain('src/')
    expect(bySlot.left_arm?.modulePaths).toContain('web/')
    expect(bySlot.right_leg?.modulePaths).toContain('docker/')
    expect(capture.current!.mapDraftSource).toBe('heuristic')
    expect(capture.current!.mapGaps.some((g) => g.includes('测试'))).toBe(true)
    await waitFor(() => {
      expect(api.llmCall).toHaveBeenCalledWith('ws-auto', 'map_architecture', expect.anything())
    })
    expect(screen.getByRole('button', { name: '确认这份草稿' })).toBeInTheDocument()
  })

  it('upgrades the draft when map_architecture returns a valid overlay', async () => {
    vi.mocked(open).mockResolvedValue('/tmp/tinman-auto')
    vi.mocked(api.createWorkspace).mockResolvedValue({
      id: 'ws-auto',
      name: 'tinman-auto',
      root_path: '/tmp/tinman-auto',
      created_at: '2026-09-11T00:00:00Z',
      llm_profile_id: 'p1',
      prefs: { mapConfirmed: false },
      parts: [],
    })
    vi.mocked(api.scanWorkspace).mockResolvedValue(sampleFacts())
    vi.mocked(api.llmCall).mockResolvedValue({
      status: 'available',
      purpose: 'map_architecture',
      advice: null,
      output: {
        parts: [
          {
            slot: 'torso',
            present: true,
            label: '核心域（模型）',
            modulePaths: ['src/'],
            wires: [
              {
                label: '域模型',
                criteria: ['实体可序列化', '迁移可回放', '无直接进度写入'],
              },
            ],
          },
        ],
      },
      call_id: 'c1',
      duration_ms: 20,
    })
    const capture = await renderDesktop()
    await act(async () => {
      fireEvent.click(screen.getByLabelText('add local folder'))
    })
    await waitFor(() => {
      expect(capture.current!.mapDraftSource).toBe('llm')
    })
    expect(capture.current!.mapDraft?.parts.find((p) => p.slot === 'torso')?.label).toBe(
      '核心域（模型）',
    )
  })

  it('facts-updated with a new directory on a confirmed map stores a drift draft and does not flip criteria', async () => {
    const torso = {
      id: 'part-t',
      workspace_id: 'ws-1',
      slot: 'torso',
      label: '核心',
      weight: 3,
      planned_start: null,
      status: 'in_progress',
      wires: [
        {
          id: 'w-t',
          part_id: 'part-t',
          label: '域模型',
          criteria: [
            { text: '实体可序列化', met: true, evidence: 'src/e.ts' },
            { text: '迁移可回放', met: false, evidence: '' },
            { text: '无直接进度写入', met: false, evidence: '' },
          ],
          progress: 33,
          status: 'in_progress',
          updated_at: '2026-09-11T00:00:00Z',
        },
      ],
    }
    const ws = {
      id: 'ws-1',
      name: 'ws-1',
      root_path: '/tmp/ws-1',
      created_at: '2026-01-01T00:00:00Z',
      llm_profile_id: null,
      prefs: { mapConfirmed: true, modulesBySlot: { torso: ['src/'] } },
      parts: [torso],
    }
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(api.listWorkspaces).mockResolvedValue([
      {
        id: 'ws-1',
        name: 'ws-1',
        root_path: '/tmp/ws-1',
        created_at: '2026-01-01T00:00:00Z',
        llm_profile_id: null,
        prefs: { mapConfirmed: true },
      },
    ])
    vi.mocked(api.getWorkspace).mockResolvedValue(ws)
    vi.mocked(api.getFacts).mockResolvedValue(sampleFacts())
    vi.mocked(api.getAppPrefs).mockResolvedValue({})
    const capture = { current: null as AppStore | null }
    render(<Harness capture={capture} />)
    await waitFor(() => expect(capture.current?.ready).toBe(true))
    await waitFor(() => expect(mockFacts.handler).toEqual(expect.any(Function)))

    const nextFacts = {
      ...sampleFacts(),
      tree: [
        { name: 'src', kind: 'dir', files: 3 },
        { name: 'demo', kind: 'dir', files: 1 },
      ],
    }
    vi.mocked(api.getFacts).mockResolvedValue(nextFacts)

    await act(async () => {
      mockFacts.handler!({
        workspace_id: 'ws-1',
        facts: nextFacts,
        fingerprint: 'demo\nsrc',
        previous_fingerprint: 'src',
        drift: true,
        map_confirmed: true,
      })
    })

    await waitFor(() => {
      expect(capture.current!.mapDriftAdded).toContain('demo/')
    })
    const torsoWire = capture.current!.projects
      .find((p) => p.id === 'ws-1')
      ?.parts.find((p) => p.slot === 'torso')
      ?.wires[0]
    expect(torsoWire?.criteria.filter((c) => c.met)).toHaveLength(1)
    expect(capture.current!.mapOpen).toBe(false)
  })
})

