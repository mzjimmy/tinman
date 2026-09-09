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

const { mockMenu } = vi.hoisted(() => ({
  mockMenu: { handler: undefined as ((id: string) => void) | undefined },
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
    api: {
      ...actual.api,
      getAppPrefs: vi.fn(async () => ({})),
      setAppPrefs: vi.fn(async () => {}),
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
  vi.mocked(isTauri).mockReturnValue(false)
  vi.mocked(open).mockReset()
  vi.mocked(api.createWorkspace).mockReset()
  vi.mocked(api.scanWorkspace).mockReset()
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
