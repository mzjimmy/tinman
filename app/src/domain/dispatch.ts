import type {
  AppState,
  FrameworkAdvice,
  GoalCard,
  LlmUnavailableReason,
  Project,
  Task,
} from './types'
import { deriveBoard, drain, stationCountOf } from './queue'

export const GOAL_CARD_KEYS = [
  'task_id',
  'project',
  'target',
  'user_intent_verbatim',
  'attachments',
  'facts',
  'framework_advice',
  'done_criteria',
  'assumptions',
  'workspace',
  'delivery_format',
  'authorization',
] as const

export const GOAL_TARGET_KEYS = ['slot', 'part', 'wire'] as const
export const GOAL_ADVICE_KEYS = ['next_step', 'entry_point', 'shared_risk'] as const
export const GOAL_WORKSPACE_KEYS = ['worktree_path', 'branch'] as const
export const GOAL_AUTH_KEYS = ['allow_push', 'allow_deploy', 'allow_spend'] as const

export interface DraftGoalInput {
  taskId: string
  project: Project
  partId: string
  wireId: string
  userIntentVerbatim: string[]
  attachments: string[]
  facts: Record<string, unknown>
  advice: FrameworkAdvice | null
  adviceUnavailableReason?: LlmUnavailableReason | 'hand_filled'
  worktreePath: string
}

export function newTaskId(): string {
  const hex = crypto.randomUUID().replace(/-/g, '')
  return `t_${hex.slice(0, 12)}`
}

export function plannedWorktreePath(taskId: string, dataDir = '/tmp/tinman-data'): string {
  return `${dataDir.replace(/\/$/, '')}/worktrees/${taskId}`
}

export function factsFromPart(
  project: Project,
  partId: string,
): Record<string, unknown> {
  const part = project.parts.find((p) => p.id === partId)
  const facts = part?.facts
  if (!facts) {
    return { last_commit: '' }
  }
  return {
    last_commit: facts.lastCommit,
    files: facts.files,
    tests: facts.tests,
    todo_count: facts.todoCount,
  }
}

function handFilledAdvice(
  project: Project,
  partId: string,
  wireId: string,
): { advice: GoalCard['framework_advice']; done_criteria: string[] } {
  const part = project.parts.find((p) => p.id === partId)
  const wire = part?.wires.find((w) => w.id === wireId)
  const criteria = wire?.criteria.map((c) => c.text).filter((t) => t.length > 0) ?? []
  return {
    advice: {
      next_step: criteria[0] ?? '根据事实完成该线路尚未满足的验收项',
      entry_point: part?.facts?.files[0] ?? '.',
      shared_risk: '与相邻部位共用约定，由本任务确定',
    },
    done_criteria:
      criteria.length > 0
        ? criteria
        : ['该线路的验收项全部满足', '不写入扫描根目录', '不 push / deploy / spend'],
  }
}

export function draftGoal(input: DraftGoalInput): GoalCard {
  const part = input.project.parts.find((p) => p.id === input.partId)
  const wire = part?.wires.find((w) => w.id === input.wireId)
  const hand = handFilledAdvice(input.project, input.partId, input.wireId)
  const adviceFields = input.advice
    ? {
        next_step: input.advice.next_step,
        entry_point: input.advice.entry_point,
        shared_risk: input.advice.shared_risk,
      }
    : hand.advice
  const done_criteria = input.advice?.done_criteria?.length
    ? input.advice.done_criteria
    : hand.done_criteria
  const assumptions: string[] = [
    'writes happen only in the worktree copy, never in the scanned tree',
  ]
  if (!input.advice) {
    const why = input.adviceUnavailableReason ?? 'hand_filled'
    assumptions.push(
      `ASSUMED: framework_advice was hand-filled because the LLM was unavailable (${why}). Reverse: configure a model and retry draft_goal.`,
    )
  }
  return {
    task_id: input.taskId,
    project: { name: input.project.name, root: input.project.root },
    target: {
      slot: part?.slot ?? 'left_leg',
      part: part?.label ?? '未知部位',
      wire: wire?.label ?? '未知线路',
    },
    user_intent_verbatim: input.userIntentVerbatim,
    attachments: [...input.attachments],
    facts: { ...input.facts },
    framework_advice: adviceFields,
    done_criteria,
    assumptions,
    workspace: {
      worktree_path: input.worktreePath,
      branch: `tinman/${input.taskId}`,
    },
    delivery_format: '变更说明 + 自测结果 + 未完成项',
    authorization: { allow_push: false, allow_deploy: false, allow_spend: false },
  }
}

export function confirmDispatch(state: AppState, goal: GoalCard): AppState {
  const dispatchedAt = state.tasks.find((t) => t.id === goal.task_id)?.dispatchedAt
  const task: Task = {
    id: goal.task_id,
    projectId: state.selectedProjectId,
    partId: state.selectedPartId ?? '',
    wireId: state.selectedWireId ?? '',
    goal,
    state: 'queued',
    worktreePath: goal.workspace.worktree_path,
    dispatchedAt:
      dispatchedAt ??
      `2026-09-09T00:00:${String(state.tasks.length).padStart(2, '0')}.000Z`,
    command: state.dispatchTarget,
  }
  const count = stationCountOf(state.stations)
  const tasks = drain(
    [...state.tasks.filter((t) => t.id !== task.id), task],
    count,
  )
  const board = deriveBoard(tasks, count)
  return {
    ...state,
    stations: board.stations,
    tasks,
    queue: board.queue,
    goalDraft: undefined,
    showGoalCard: false,
    view: 'task',
    selectedTaskId: task.id,
    rightPanel: 'terminal',
  }
}

export function simulateRankingSelect(
  state: AppState,
  projectId: string,
  partId: string,
): AppState {
  return {
    ...state,
    selectedProjectId: projectId,
    selectedPartId: partId,
    selectedWireId: undefined,
    view: 'robot',
    showGoalCard: false,
    goalDraft: undefined,
  }
}

export function simulateGenerateGoal(
  state: AppState,
  project: Project,
  wireId?: string,
  dataDir = '/tmp/tinman-data',
): AppState {
  const partId = state.selectedPartId ?? project.parts[0]?.id ?? ''
  const part = project.parts.find((p) => p.id === partId)
  const resolvedWire = wireId ?? state.selectedWireId ?? part?.wires[0]?.id ?? ''
  const taskId = newTaskId()
  const goal = draftGoal({
    taskId,
    project,
    partId,
    wireId: resolvedWire,
    userIntentVerbatim: state.composerDraft ? [state.composerDraft] : [],
    attachments: state.attachments ?? [],
    facts: factsFromPart(project, partId),
    advice: null,
    adviceUnavailableReason: 'no_profile',
    worktreePath: plannedWorktreePath(taskId, dataDir),
  })
  return {
    ...state,
    goalDraft: goal,
    showGoalCard: true,
    selectedWireId: resolvedWire,
  }
}

export function completeDemoTask(state: AppState, taskId: string): AppState {
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task) return state

  const count = stationCountOf(state.stations)
  const tasks = drain(
    state.tasks.map((t) => (t.id === taskId ? { ...t, state: 'checking' as const } : t)),
    count,
  )
  const board = deriveBoard(tasks, count)
  return { ...state, tasks, stations: board.stations, queue: board.queue }
}

/** Kept so existing tests compile; ids are UUIDs and do not reset. */
export function resetTaskCounter(_n = 142): void {}

export function commandFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const rec = result as { command?: unknown }
  return typeof rec.command === 'string' ? rec.command : undefined
}

export function taskFromRecord(row: {
  id: string
  workspace_id: string
  part_id: string | null
  wire_id: string | null
  goal_json: GoalCard
  state: Task['state']
  station: string | null
  worktree_path: string | null
  dispatched_at: string | null
  finished_at: string | null
  result_json: unknown | null
}): Task {
  return {
    id: row.id,
    projectId: row.workspace_id,
    partId: row.part_id ?? '',
    wireId: row.wire_id ?? '',
    goal: row.goal_json,
    state: row.state,
    stationId: row.station ?? undefined,
    worktreePath: row.worktree_path ?? undefined,
    dispatchedAt: row.dispatched_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    result: row.result_json ?? undefined,
    command: commandFromResult(row.result_json),
  }
}

export function frameworkAdviceFromLlm(result: {
  status: string
  advice?: FrameworkAdvice | null
  output?: unknown
  reason?: LlmUnavailableReason
}): { advice: FrameworkAdvice | null; reason?: LlmUnavailableReason } {
  if (result.status === 'unavailable') {
    return { advice: null, reason: result.reason }
  }
  if (result.advice) {
    return { advice: result.advice }
  }
  const output = result.output
  if (!output || typeof output !== 'object') {
    return { advice: null, reason: 'rejected' }
  }
  const rec = output as Record<string, unknown>
  const fa = (rec.framework_advice as Record<string, unknown> | undefined) ?? rec
  if (typeof fa.next_step === 'string') {
    const done = rec.done_criteria ?? fa.done_criteria
    return {
      advice: {
        diagnosis: typeof fa.diagnosis === 'string' ? fa.diagnosis : '',
        next_step: fa.next_step,
        entry_point: typeof fa.entry_point === 'string' ? fa.entry_point : '.',
        shared_risk: typeof fa.shared_risk === 'string' ? fa.shared_risk : '',
        done_criteria: Array.isArray(done) ? done.map(String) : [],
      },
    }
  }
  return { advice: null, reason: 'rejected' }
}
