/**
 * WP2 shell chrome — structural + CSS contracts.
 * Geometry (C1–C5, C7 px) is not asserted: jsdom returns 0 for every rect.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppShell } from './AppShell'
import { RightPanel } from './RightPanel'
import { rankingProject } from '../domain/fixtures'
import { deriveProject, fleetRanking } from '../domain/shortLeg'
import type { Project } from '../domain/types'
import type { AppStore } from '../hooks/useAppState'

const here = dirname(fileURLToPath(import.meta.url))

function cssText(): string {
  return readFileSync(resolve(here, '../index.css'), 'utf8')
}

function mediaBlock(css: string, query: string): string {
  const token = `@media ${query}`
  const start = css.indexOf(token)
  expect(start, `missing ${token}`).toBeGreaterThanOrEqual(0)
  const brace = css.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < css.length; i++) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(brace + 1, i)
    }
  }
  throw new Error(`unclosed ${token}`)
}

function ruleBody(css: string, selector: string): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  const match = css.match(re)
  expect(match, `missing rule ${selector}`).not.toBeNull()
  return match![1]!
}

/** Same store fixture as acceptance.test.tsx — not a second harness. */
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

describe('WP2 left / right / composer chrome', () => {
  it('c3_left_rail_has_one_add_folder_entry', () => {
    const addFolder = vi.fn()
    render(<AppShell store={fakeStore({ addFolder })} />)
    const left = document.querySelector('.left-bar')
    expect(left).not.toBeNull()
    const buttons = within(left as HTMLElement).getAllByRole('button')
    const hits: HTMLElement[] = []
    for (const btn of buttons) {
      addFolder.mockClear()
      fireEvent.click(btn)
      if (addFolder.mock.calls.length > 0) hits.push(btn)
    }
    expect(hits).toHaveLength(1)
    addFolder.mockClear()
    fireEvent.click(hits[0]!)
    expect(addFolder).toHaveBeenCalledTimes(1)
    expect(hits[0]).toHaveAttribute('aria-label', 'add local folder')
  })

  it('c3_search_button_is_gone', () => {
    const setFilter = vi.fn()
    render(<AppShell store={fakeStore({ setFilter })} />)
    const left = document.querySelector('.left-bar') as HTMLElement
    expect(within(left).queryByRole('button', { name: /^Search$/ })).toBeNull()
    const filter = document.getElementById('project-filter') as HTMLInputElement
    expect(filter).toBeTruthy()
    expect(filter.disabled).toBe(false)
    fireEvent.change(filter, { target: { value: 'alpha' } })
    expect(setFilter).toHaveBeenCalledWith('alpha')
  })

  it('c4_right_rail_panel_nav_is_a_single_group', () => {
    const setRight = vi.fn()
    render(<AppShell store={fakeStore({ setRight, rightPanel: 'facts' })} />)
    const nav = screen.getByTestId('right-panel-nav')
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Changes',
      'Browser',
      'Terminal',
      'Files',
      'Facts',
    ])
    expect(within(nav).getByRole('button', { name: 'Facts' })).toHaveClass('on')
    fireEvent.click(within(nav).getByRole('button', { name: 'Files' }))
    expect(setRight).toHaveBeenCalledWith('files')
  })

  it('c5_composer_controls_share_one_control_class', () => {
    render(<AppShell store={fakeStore()} />)
    const composer = document.querySelector('.composer')
    expect(composer).not.toBeNull()
    const children = Array.from(composer!.children)
    expect(children.length).toBeGreaterThanOrEqual(4)
    for (const child of children) {
      expect(child.classList.contains('ctrl'), child.outerHTML).toBe(true)
    }
  })

  it('existing_aria_labels_survive_the_chrome_pass', () => {
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
          ],
          llmProfile: 'local-ollama',
        })}
      />,
    )
    for (const label of [
      'add local folder',
      'settings',
      'composer',
      'attach',
      'target',
      'llm profile',
    ]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument()
    }
  })

  it('c1_collapse_button_is_not_absolutely_positioned', () => {
    const css = cssText()
    const re = /\.collapse-btn[^{]*\{([^}]*)\}/g
    let seen = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(css))) {
      seen += 1
      expect(match[1]).not.toMatch(/position\s*:\s*absolute/)
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('c6_size_tokens_exist_and_are_used', () => {
    const css = cssText()
    const rootStart = css.indexOf(':root')
    const rootBrace = css.indexOf('{', rootStart)
    let depth = 0
    let rootEnd = rootBrace
    for (let i = rootBrace; i < css.length; i++) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') {
        depth -= 1
        if (depth === 0) {
          rootEnd = i
          break
        }
      }
    }
    const root = css.slice(rootBrace + 1, rootEnd)
    expect(root).toMatch(/--space-1:\s*4px/)
    expect(root).toMatch(/--space-2:\s*8px/)
    expect(root).toMatch(/--space-3:\s*12px/)
    expect(root).toMatch(/--space-4:\s*16px/)
    expect(root).toMatch(/--control-height:\s*32px/)
    expect(root).toMatch(/--control-height-sm:\s*28px/)
    expect(root).toMatch(/--radius-sm:\s*4px/)

    expect(ruleBody(css, '.left-bar')).toMatch(/var\(--space-3\)/)
    expect(ruleBody(css, '.right-panel-nav button')).toMatch(/var\(--control-height-sm\)/)
    expect(ruleBody(css, '.composer')).toMatch(/var\(--space-2\)/)
    expect(ruleBody(css, '.composer > .ctrl')).toMatch(/var\(--control-height\)/)
  })

  it('c7_breakpoints_unchanged', () => {
    const css = cssText()
    expect(ruleBody(css, '.workspace')).toMatch(
      /grid-template-columns:\s*260px 1fr 200px/,
    )
    const mq = mediaBlock(css, '(max-width: 1024px)')
    expect(mq).toMatch(/\.workspace\s*\{[^}]*grid-template-columns:\s*1fr 200px/)
    expect(mq).toMatch(/\.left-bar\s*\{[^}]*display:\s*none/)
  })

  it('d7_group_title_defined_once', () => {
    const css = cssText()
    const defs = css.match(/\.group-title\s*\{/g) ?? []
    expect(defs).toHaveLength(1)
  })

  it('c9_browser_panel_placeholder_has_no_round_2', () => {
    render(<RightPanel store={fakeStore({ rightPanel: 'browser' })} />)
    const body = document.querySelector('.panel-body')
    expect(body).not.toBeNull()
    expect(body!.textContent ?? '').not.toMatch(/round 2/i)
    expect(body!.textContent ?? '').toMatch(/Changes \/ Files \/ Facts/)
  })
})

/**
 * R2 / C2 — composer must offer a send affordance. Enter in the input AND a
 * send button both call store.sendComposer. Empty draft is a no-op.
 */
describe('composer send affordance (R2 C2)', () => {
  it('c2_send_button_is_in_the_composer', () => {
    render(<AppShell store={fakeStore()} />)
    const composer = document.querySelector('.composer') as HTMLElement
    expect(within(composer).getByRole('button', { name: 'send' })).toBeInTheDocument()
  })

  it('c2_enter_in_composer_input_calls_sendComposer', () => {
    const sendComposer = vi.fn()
    render(<AppShell store={fakeStore({ sendComposer })} />)
    const input = screen.getByLabelText('composer') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'add a tests button' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sendComposer).toHaveBeenCalledTimes(1)
  })

  it('c2_clicking_send_button_calls_sendComposer', () => {
    const sendComposer = vi.fn()
    render(<AppShell store={fakeStore({ sendComposer })} />)
    const composer = document.querySelector('.composer') as HTMLElement
    fireEvent.click(within(composer).getByRole('button', { name: 'send' }))
    expect(sendComposer).toHaveBeenCalledTimes(1)
  })

  it('c2_empty_draft_is_a_noop', () => {
    const sendComposer = vi.fn()
    const setComposerDraft = vi.fn()
    render(
      <AppShell
        store={fakeStore({ sendComposer, composerDraft: '', setComposerDraft })}
      />,
    )
    const composer = document.querySelector('.composer') as HTMLElement
    fireEvent.click(within(composer).getByRole('button', { name: 'send' }))
    expect(sendComposer).not.toHaveBeenCalled()
  })
})
