/**
 * C6 acceptance sweep — one describe per spec §12 item.
 *
 * Items that already have a test are referenced here by file and test name
 * rather than duplicated. New assertions for this package live in this file
 * under the names the work-package brief asked for (c1_… / c2_… / c3_… / c4_… / c5_…).
 *
 * Not machine-checkable, and why:
 * - Item 3 is a human study: three people, five projects, 15 seconds to name
 *   which project's which part is shortest. jsdom cannot run that.
 * - Item 1's "within 10 seconds" after adding a real local folder in the app
 *   window is not asserted here. scanner.rs::scan_100k_line_repo_under_10s
 *   times a synthetic tree; scan_this_repo_is_read_only_and_populated dropped
 *   a wall-clock bound because this checkout sits on a virtualised mount.
 * - Item 12's real 1024px window is not asserted here. jsdom does not do
 *   layout; the stylesheet + preserveAspectRatio checks below are a regression
 *   guard, not a substitute for a real window (round 1 already recorded that
 *   it never verified this in a live window).
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppShell } from './components/AppShell'
import { FleetView } from './components/FleetView'
import { PartPanel } from './components/PartPanel'
import { RightPanel } from './components/RightPanel'
import { RobotSvg } from './components/RobotSvg'
import { TaskView } from './components/TaskView'
import { draftGoal, factsFromPart, plannedWorktreePath } from './domain/dispatch'
import { makePart, makeProject, makeWire, rankingProject } from './domain/fixtures'
import { abandonTask, pauseTask, resumeTask } from './domain/queue'
import { deriveProject, fleetRanking } from './domain/shortLeg'
import type { FrameworkAdvice, GoalCard, Project, Task, TaskState } from './domain/types'
import type { AppStore } from './hooks/useAppState'

const here = dirname(fileURLToPath(import.meta.url))

function src(rel: string): string {
  return readFileSync(resolve(here, rel), 'utf8')
}

function assertNamedTest(rel: string, needle: string) {
  const text = src(rel)
  expect(text, `expected ${rel} to contain ${needle}`).toContain(needle)
}

function goalFor(id: string): GoalCard {
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
  const g = partial.goal ?? goalFor(partial.id)
  return {
    projectId: 'p-demo',
    partId: 'p1-ll',
    wireId: 'w1',
    worktreePath: plannedWorktreePath(partial.id),
    command: `stub /tmp/tinman-data/tasks/${partial.id}/goal.json`,
    ...partial,
    goal: g,
  }
}

function fakeStore(overrides: Record<string, unknown> = {}): AppStore {
  const projects = (overrides.projects as Project[] | undefined) ?? [rankingProject()]
  const project = projects[0]!
  const derived = deriveProject(project)
  return {
    filter: '',
    setFilter: vi.fn(),
    leftCollapsed: false,
    setLeftCollapsed: vi.fn(),
    addFolder: vi.fn(),
    openStub: vi.fn(),
    toggleTheme: vi.fn(),
    theme: 'system',
    projects,
    selectedProjectId: project.id,
    selectedProject: project,
    selectProject: vi.fn(),
    selectPart: vi.fn(),
    setView: vi.fn(),
    view: 'robot',
    derived,
    ranking: fleetRanking(projects),
    selectedPartId: project.parts[0]?.id,
    shortLegSlot: derived.parts[0]?.part.slot,
    setMapOpen: vi.fn(),
    mapOpen: false,
    rescan: vi.fn(),
    rightPanel: 'facts',
    setRight: vi.fn(),
    composerDraft: '',
    setComposerDraft: vi.fn(),
    attachments: [],
    setAttachments: vi.fn(),
    llmProfile: '',
    setLlmProfile: vi.fn(),
    llmProfiles: [],
    dispatchTarget: 'this-pc',
    setDispatchTarget: vi.fn(),
    scanning: false,
    scan: null,
    error: undefined,
    clearError: vi.fn(),
    stubDialog: undefined,
    closeStub: vi.fn(),
    partAdvice: { status: 'unavailable', reason: 'no_profile' },
    facts: undefined,
    files: null,
    changes: null,
    tasks: [],
    selectedTaskId: undefined,
    taskLines: {},
    stations: [
      { id: '1', label: '工位 1' },
      { id: '2', label: '工位 2' },
    ],
    stationCount: 2,
    setStationCount: vi.fn(),
    queue: [],
    settingsOpen: false,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    saveLlmProfile: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    abandonTask: vi.fn(),
    takeOver: vi.fn(),
    removeWorktree: vi.fn(),
    ...overrides,
  } as unknown as AppStore
}

describe('acceptance 1: add a local repo, facts + map sheet, then robot fill', () => {
  it('covered by scanner.rs::scan_this_repo_is_read_only_and_populated and scan_100k_line_repo_under_10s', () => {
    assertNamedTest(
      '../src-tauri/src/scanner.rs',
      'fn scan_this_repo_is_read_only_and_populated',
    )
    assertNamedTest('../src-tauri/src/scanner.rs', 'fn scan_100k_line_repo_under_10s')
    assertNamedTest(
      './components/MapSheet.test.tsx',
      "it('fills from a proposal object without restructuring'",
    )
  })

  it('after map confirmation the robot renders a fill for a part with met criteria', () => {
    const project = makeProject({
      mapConfirmed: true,
      parts: [
        makePart({
          slot: 'torso',
          status: 'in_progress',
          wires: [makeWire({ met: 2, total: 5 })],
        }),
      ],
    })
    const { container } = render(
      <RobotSvg uid="acc1" parts={deriveProject(project).parts} mapConfirmed />,
    )
    expect(container.querySelector('.fill')).not.toBeNull()
    expect(container.textContent).not.toContain('待确认架构地图')
  })
})

describe('acceptance 2: unconfirmed map is all dark, no invented progress', () => {
  it("covered by RobotSvg.test.tsx::renders all-dark robot with notice and no progress figures", () => {
    assertNamedTest(
      './components/RobotSvg.test.tsx',
      "it('renders all-dark robot with notice and no progress figures'",
    )
    assertNamedTest('./domain/progress.test.ts', "it('unconfirmed map exposes displayProgress 0'")
  })
})

describe('acceptance 3: five projects, three people, 15-second ranking', () => {
  // Not machine-checkable: a human study. The ranking table and short-leg
  // formula are covered by domain/shortLeg.test.ts; whether three people can
  // name the shortest part in 15 seconds is not something a unit test can run.
  it('not machine-checkable — human ranking study', () => {
    assertNamedTest('./domain/shortLeg.test.ts', "it('truncates ranking to top 5'")
  })
})

describe('acceptance 4: fleet ranking to dispatched task in at most three clicks', () => {
  it('covered by domain/dispatch.test.ts::c1_three_clicks_from_ranking_to_dispatch', () => {
    assertNamedTest('./domain/dispatch.test.ts', "it('c1_three_clicks_from_ranking_to_dispatch'")
  })
})

describe('acceptance 5: five LLM fields, diagnosis cites a clickable fact', () => {
  it("covered by PartPanel.test.tsx::renders all five advice fields when available", () => {
    assertNamedTest(
      './components/PartPanel.test.tsx',
      "it('renders all five advice fields when available'",
    )
  })

  it('diagnosis cites at least one real, clickable fact', () => {
    const advice: FrameworkAdvice = {
      diagnosis: 'left_leg is short because src/db.rs has no passing CI listed in facts.',
      next_step: 'Add the validation gate before any provider call.',
      entry_point: 'app/src-tauri/src/llm.rs',
      shared_risk: 'db.rs schema',
      done_criteria: ['a', 'b', 'c'],
    }
    const project = makeProject({
      mapConfirmed: true,
      parts: [
        makePart({
          id: 'part-leg',
          slot: 'left_leg',
          status: 'in_progress',
          wires: [makeWire({ id: 'w-1', met: 1, total: 5 })],
          facts: {
            files: ['src/db.rs', 'src/lib.rs'],
            tests: 'none listed',
            lastCommit: 'abc',
            todoCount: 0,
          },
        }),
      ],
    })
    const part = deriveProject(project).parts[0]!
    render(<PartPanel part={part} advice={{ status: 'available', advice }} />)
    const cite = screen.getByTestId('fact-cite')
    expect(cite.tagName).toMatch(/BUTTON|A/)
    expect(cite.textContent).toContain('src/db.rs')
    expect(cite).toBeEnabled()
  })
})

describe('acceptance 6: validation gate intercepts code and percentages', () => {
  it('covered by llm.rs c4_gate_rejects_fenced_code and c4_gate_rejects_percentage', () => {
    assertNamedTest('../src-tauri/src/llm.rs', 'fn c4_gate_rejects_fenced_code')
    assertNamedTest('../src-tauri/src/llm.rs', 'fn c4_gate_rejects_percentage')
    assertNamedTest('../src-tauri/src/llm.rs', 'fn c4_gate_rejects_progress_fraction')
  })
})

describe('acceptance 7: two concurrent tasks, independent worktrees, separate checks', () => {
  it('covered by verify.rs::c5_two_concurrent_tasks_have_independent_worktrees', () => {
    assertNamedTest(
      '../src-tauri/src/verify.rs',
      'fn c5_two_concurrent_tasks_have_independent_worktrees',
    )
  })
})

describe('acceptance 8: fill rises by met criteria; numbers trace to evidence', () => {
  it('covered by verify.rs::c4_part_fill_rises_by_the_met_ratio_after_write_back and PartPanel evidence test', () => {
    assertNamedTest(
      '../src-tauri/src/verify.rs',
      'fn c4_part_fill_rises_by_the_met_ratio_after_write_back',
    )
    assertNamedTest(
      './components/PartPanel.test.tsx',
      "it('after a verified task the wire shows evidence and fill matches the met ratio'",
    )
    assertNamedTest('../src-tauri/src/verify.rs', 'fn c4_no_path_sets_progress_directly')
  })
})

describe('acceptance 9: a blocked part pulses in the robot view and the fleet card', () => {
  it('c3_blocked_part_pulses_in_robot_view', () => {
    const project = rankingProject()
    const derived = deriveProject(project)
    expect(derived.hasBlocked).toBe(true)
    const blocked = derived.parts.find((p) => p.status === 'blocked')
    expect(blocked).toBeDefined()
    const { container } = render(
      <RobotSvg uid="pulse-robot" parts={derived.parts} mapConfirmed />,
    )
    const unit = container.querySelector('.unit.blocked')
    expect(unit).not.toBeNull()
    expect(unit?.getAttribute('data-status')).toBe('blocked')
    const css = src('./index.css')
    expect(css).toMatch(/\.unit\.blocked\s*\{[^}]*animation:\s*blocked-pulse/)
  })

  it('c3_blocked_part_pulses_in_fleet_card', () => {
    const project = rankingProject()
    const derived = deriveProject(project)
    expect(derived.hasBlocked).toBe(true)
    const { container } = render(<FleetView store={fakeStore({ projects: [project], view: 'fleet' })} />)
    const card = container.querySelector('.fleet-card.blocked-card')
    expect(card).not.toBeNull()
    const css = src('./index.css')
    expect(css).toMatch(/\.fleet-card\.blocked-card\s*\{[^}]*animation:\s*blocked-pulse/)
    expect(container.querySelector('.unit.blocked')).not.toBeNull()
  })
})

describe('acceptance 10: force-quit recovery of stations, queue and history', () => {
  it('covered by queue.rs::c5_task_left_running_by_a_crash_is_recovered_not_left_running', () => {
    assertNamedTest(
      '../src-tauri/src/queue.rs',
      'fn c5_task_left_running_by_a_crash_is_recovered_not_left_running',
    )
    assertNamedTest('../src-tauri/src/queue.rs', 'fn c5_stations_and_queue_rebuild_from_the_database')
  })
})

describe('acceptance 11: no network, no provider — shell works, LLM degrades', () => {
  it('c4_offline_shell_renders_without_error_banner', () => {
    const project = rankingProject()
    const derived = deriveProject(project)
    const base = {
      projects: [project],
      selectedProject: project,
      selectedProjectId: project.id,
      selectedPartId: project.parts[0]!.id,
      derived,
      ranking: fleetRanking([project]),
      error: undefined,
      llmProfiles: [] as const,
      partAdvice: { status: 'unavailable' as const, reason: 'no_profile' as const },
    }
    const { rerender } = render(<AppShell store={fakeStore({ ...base, view: 'robot' })} />)

    expect(document.querySelector('.error-banner')).toBeNull()
    expect(document.querySelector('.robot-svg')).not.toBeNull()
    expect(screen.getAllByTestId('llm-advice')[0]!.textContent).toMatch(
      /未选择模型|未配置模型|模型不可用/,
    )
    expect(screen.getAllByTestId('llm-profile-empty')[0]!.textContent).toMatch(/未配置模型/)
    expect(document.body.textContent).not.toContain('Extra High Fast')
    expect(document.body.textContent).not.toContain('Local stub')

    rerender(<AppShell store={fakeStore({ ...base, view: 'fleet' })} />)
    expect(document.querySelector('.error-banner')).toBeNull()
    expect(document.querySelector('.fleet-view')).not.toBeNull()
    expect(document.body.textContent).toContain('最短腿排行')

    rerender(<AppShell store={fakeStore({ ...base, view: 'task' })} />)
    expect(document.querySelector('.error-banner')).toBeNull()
    expect(document.querySelector('.task-view')).not.toBeNull()
    expect(screen.getByTestId('station-工位 1')).toBeInTheDocument()
  })
})

describe('acceptance 12: 1024px drops to two columns; robot aspect preserved', () => {
  it('c5_stylesheet_drops_to_two_columns_at_1024_without_hiding_the_right_bar', () => {
    const css = src('./index.css')
    const match = css.match(/@media \(max-width: 1024px\)\s*\{([\s\S]*?)\n\}/)
    expect(match, 'missing @media (max-width: 1024px) block').not.toBeNull()
    const block = match![1]!
    expect(block).toMatch(/grid-template-columns:\s*1fr 200px/)
    expect(block).not.toMatch(/\.right-bar[^{]*\{[^}]*display:\s*none/)
    expect(css).toMatch(/\.workspace\s*\{[^}]*grid-template-columns:\s*260px 1fr 200px/)
  })

  it('c5_robot_svg_preserves_aspect_ratio', () => {
    const project = makeProject({ mapConfirmed: true, parts: [] })
    const { container } = render(
      <RobotSvg uid="acc12" parts={deriveProject(project).parts} mapConfirmed />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 260')
  })
})

describe('completion state: READY badge, lit eyes, one-shot activation', () => {
  it('all-done robot shows READY, lit eyes, and the ready class for ready-pop', () => {
    const project = makeProject({
      mapConfirmed: true,
      parts: [
        makePart({
          slot: 'head',
          status: 'done',
          wires: [makeWire({ met: 1, total: 1, status: 'done' })],
        }),
      ],
    })
    const { container } = render(
      <RobotSvg uid="ready" parts={deriveProject(project).parts} mapConfirmed />,
    )
    expect(container.textContent).toContain('READY')
    expect(container.querySelector('.ready-badge')).not.toBeNull()
    expect(container.querySelector('svg.robot-svg.ready')).not.toBeNull()
    const eyes = container.querySelectorAll('.eye.on')
    expect(eyes.length).toBe(2)
    const css = src('./index.css')
    expect(css).toMatch(/\.robot-svg\.ready\s*\{[^}]*animation:\s*ready-pop/)
  })
})

describe('C1 interruption actions', () => {
  it('c1_pause_resume_round_trip', () => {
    const running = task({ id: 't_run', state: 'running', stationId: '1' })
    const paused = pauseTask([running], 't_run', 2)
    expect(paused).toHaveLength(1)
    expect(paused[0]!.state).toBe('paused')
    expect(paused[0]!.stationId).toBeUndefined()
    expect(paused[0]!.worktreePath).toBe(running.worktreePath)

    const resumed = resumeTask(paused, 't_run', 2)
    expect(resumed[0]!.state).toBe('running')
    expect(resumed[0]!.stationId).toBe('1')

    const pauseTaskFn = vi.fn()
    const resumeTaskFn = vi.fn()
    const { rerender } = render(
      <TaskView
        store={fakeStore({
          tasks: [running],
          pauseTask: pauseTaskFn,
          resumeTask: resumeTaskFn,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /暂停进程并释放工位/ }))
    expect(pauseTaskFn).toHaveBeenCalledWith('t_run')

    rerender(
      <TaskView
        store={fakeStore({
          tasks: [{ ...running, state: 'paused', stationId: undefined }],
          pauseTask: pauseTaskFn,
          resumeTask: resumeTaskFn,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /恢复/ }))
    expect(resumeTaskFn).toHaveBeenCalledWith('t_run')
  })

  it('c1_abandon_keeps_the_worktree', () => {
    const running = task({
      id: 't_ab',
      state: 'running',
      stationId: '1',
      worktreePath: '/tmp/tinman-data/worktrees/t_ab',
    })
    const after = abandonTask([running], 't_ab', 2)
    expect(after[0]!.state).toBe('abandoned')
    expect(after[0]!.worktreePath).toBe('/tmp/tinman-data/worktrees/t_ab')
    expect(after[0]!.stationId).toBeUndefined()

    const abandon = vi.fn()
    const removeWorktree = vi.fn()
    render(
      <TaskView
        store={fakeStore({
          tasks: [running],
          abandonTask: abandon,
          removeWorktree,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /放弃并保留 worktree/ }))
    expect(abandon).toHaveBeenCalledWith('t_ab')
    expect(removeWorktree).not.toHaveBeenCalled()
  })

  it('c1_takeover_shows_worktree_path_and_command', () => {
    const running = task({
      id: 't_to',
      state: 'running',
      stationId: '1',
      worktreePath: '/tmp/tinman-data/worktrees/t_to',
      command: 'stub /tmp/tinman-data/tasks/t_to/goal.json',
    })
    const takeOver = vi.fn()
    render(
      <TaskView
        store={fakeStore({
          tasks: [running],
          takeOver,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /手动接管/ }))
    expect(takeOver).toHaveBeenCalledWith('t_to')

    render(
      <RightPanel
        store={fakeStore({
          rightPanel: 'terminal',
          tasks: [running],
          selectedTaskId: running.id,
        })}
      />,
    )
    expect(screen.getByTestId('terminal-worktree').textContent).toBe(running.worktreePath)
    expect(screen.getByTestId('terminal-command').textContent).toContain(running.command)
    expect(screen.getByTestId('terminal-command').textContent).toContain(running.worktreePath)
  })
})

describe('C2 composer selector and station count', () => {
  it('c2_selector_lists_profiles_and_sets_workspace_profile', () => {
    const setLlmProfile = vi.fn()
    render(
      <AppShell
        store={fakeStore({
          llmProfiles: [
            {
              id: 'local-ollama',
              kind: 'ollama',
              base_url: 'http://127.0.0.1:11434/v1',
              model: 'qwen2.5',
            },
            {
              id: 'cloud',
              kind: 'openai_compatible',
              base_url: 'https://api.example/v1',
              model: 'gpt-x',
              key_ref: 'tinman-cloud',
            },
          ],
          llmProfile: 'local-ollama',
          setLlmProfile,
        })}
      />,
    )
    const select = screen.getByLabelText('llm profile')
    expect(select).toHaveValue('local-ollama')
    expect(select.textContent).toContain('qwen2.5')
    expect(select.textContent).toContain('gpt-x')
    expect(select.textContent).not.toContain('Extra High Fast')
    fireEvent.change(select, { target: { value: 'cloud' } })
    expect(setLlmProfile).toHaveBeenCalledWith('cloud')
  })

  it('c2_selector_with_no_profiles_says_so', () => {
    const openSettings = vi.fn()
    render(
      <AppShell
        store={fakeStore({
          llmProfiles: [],
          openSettings,
        })}
      />,
    )
    const empty = screen.getByTestId('llm-profile-empty')
    expect(empty.textContent).toMatch(/未配置模型/)
    expect(screen.queryByLabelText('llm profile')).toBeNull()
    expect(document.body.textContent).not.toContain('Extra High Fast')
    fireEvent.click(screen.getByRole('button', { name: /配置模型/ }))
    expect(openSettings).toHaveBeenCalled()
  })

  it('c2_station_count_defaults_to_two_and_persists', () => {
    const setStationCount = vi.fn()
    render(<TaskView store={fakeStore({ stationCount: 2, setStationCount })} />)
    const input = screen.getByLabelText('工位数') as HTMLInputElement
    expect(input.value).toBe('2')
    fireEvent.change(input, { target: { value: '4' } })
    expect(setStationCount).toHaveBeenCalledWith(4)
    assertNamedTest('../src-tauri/src/queue.rs', 'fn configurable_station_count_from_prefs')
    assertNamedTest('../src-tauri/src/queue.rs', 'fn c1_default_station_count_is_two')
  })
})
