import { ALL_SLOTS, type AppState, type Part, type PartStatus, type Project, type Slot, type Wire } from './types'

export function makeWire(opts: {
  id?: string
  label?: string
  met: number
  total: number
  status?: Exclude<PartStatus, 'unmapped'>
  lastCommitDays?: number
}): Wire {
  const total = opts.total
  const met = opts.met
  return {
    id: opts.id ?? `w-${Math.random().toString(16).slice(2)}`,
    label: opts.label ?? 'wire',
    status: opts.status ?? (met >= total ? 'done' : met > 0 ? 'in_progress' : 'pending'),
    lastCommitDays: opts.lastCommitDays,
    criteria: Array.from({ length: total }, (_, i) => ({
      text: `c${i + 1}`,
      met: i < met,
      evidence: i < met ? `evidence/${i + 1}` : '',
    })),
  }
}

export function makePart(opts: {
  id?: string
  slot: Slot
  label?: string
  weight?: number
  status?: PartStatus
  wires?: Wire[]
  plannedStart?: string
  facts?: Part['facts']
}): Part {
  return {
    id: opts.id ?? `part-${opts.slot}`,
    slot: opts.slot,
    label: opts.label ?? opts.slot,
    weight: opts.weight ?? 2,
    status: opts.status ?? 'pending',
    wires: opts.wires ?? [],
    plannedStart: opts.plannedStart,
    facts: opts.facts,
  }
}

export function ghostParts(): Part[] {
  return ALL_SLOTS.map((slot) => makePart({ slot, status: 'unmapped', weight: 1, wires: [] }))
}

export function makeProject(opts: Partial<Project> & { name?: string } = {}): Project {
  return {
    id: opts.id ?? 'p-1',
    name: opts.name ?? '项目',
    root: opts.root ?? '/tmp/proj',
    parts: opts.parts ?? ghostParts(),
    mapConfirmed: opts.mapConfirmed ?? true,
    recentTasks: opts.recentTasks ?? [],
    lastActivityAt: opts.lastActivityAt,
  }
}

export function rankingProject(): Project {
  return makeProject({
    id: 'p-demo',
    name: '示例项目',
    mapConfirmed: true,
    parts: [
      makePart({
        id: 'p1-ll',
        slot: 'left_leg',
        label: '基础设施',
        weight: 3,
        status: 'blocked',
        wires: [makeWire({ id: 'w1', label: 'CI', met: 1, total: 5, status: 'blocked', lastCommitDays: 45 })],
      }),
      makePart({
        id: 'p1-t',
        slot: 'torso',
        label: '核心',
        weight: 3,
        status: 'in_progress',
        wires: [makeWire({ id: 'w3', met: 7, total: 10, status: 'in_progress' })],
      }),
      makePart({
        id: 'p1-h',
        slot: 'head',
        label: '算法',
        weight: 2,
        status: 'done',
        wires: [makeWire({ id: 'w6', met: 3, total: 3, status: 'done' })],
      }),
      makePart({ id: 'p1-la', slot: 'left_arm', status: 'unmapped', wires: [] }),
      makePart({ id: 'p1-ra', slot: 'right_arm', status: 'unmapped', wires: [] }),
      makePart({ id: 'p1-rl', slot: 'right_leg', status: 'unmapped', wires: [] }),
      makePart({ id: 'p1-bp', slot: 'backpack', status: 'unmapped', wires: [] }),
    ],
  })
}

export function makeState(overrides: Partial<AppState> = {}): AppState {
  const project = rankingProject()
  return {
    theme: 'dark',
    view: 'fleet',
    selectedProjectId: project.id,
    projects: [project],
    stations: [
      { id: 's1', label: 'This PC' },
      { id: 's2', label: 'station' },
    ],
    tasks: [],
    queue: [],
    rightPanel: 'facts',
    leftCollapsed: false,
    fleetSort: 'shortleg',
    showGoalCard: false,
    ...overrides,
  }
}
