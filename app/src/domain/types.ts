export const ALL_SLOTS = [
  'head',
  'torso',
  'left_arm',
  'right_arm',
  'left_leg',
  'right_leg',
  'backpack',
] as const

export type Slot = (typeof ALL_SLOTS)[number]

export type PartStatus = 'unmapped' | 'pending' | 'in_progress' | 'done' | 'blocked'

export interface Criterion {
  text: string
  met: boolean
  evidence: string
}

export interface Wire {
  id: string
  label: string
  criteria: Criterion[]
  status: Exclude<PartStatus, 'unmapped'>
  updatedAt?: string
  lastCommitDays?: number
}

export interface PartFacts {
  files: string[]
  tests: string
  lastCommit: string
  todoCount: number
}

export interface FrameworkAdvice {
  diagnosis: string
  next_step: string
  entry_point: string
  shared_risk: string
  done_criteria: string[]
}

export type LlmPurpose = 'map_architecture' | 'advise_part' | 'draft_goal' | 'verify_delivery'

export type LlmUnavailableReason = 'no_key' | 'no_profile' | 'offline' | 'rejected'

export type LlmAdviceView =
  | { status: 'available'; advice: FrameworkAdvice }
  | { status: 'unavailable'; reason: LlmUnavailableReason; detail?: string }
  | { status: 'idle' }

export interface Part {
  id: string
  slot: Slot
  label: string
  weight: number
  plannedStart?: string
  status: PartStatus
  wires: Wire[]
  facts?: PartFacts
  advice?: FrameworkAdvice
}

export interface Project {
  id: string
  name: string
  root: string
  parts: Part[]
  mapConfirmed: boolean
  recentTasks: { label: string; ago: string }[]
  lastActivityAt?: string
  mapDraft?: import('./proposal').ArchitectureProposal
  llmProfileId?: string | null
}

export interface GoalCard {
  task_id: string
  project: { name: string; root: string }
  target: { slot: Slot; part: string; wire: string }
  user_intent_verbatim: string[]
  attachments: string[]
  facts: Record<string, unknown>
  framework_advice: {
    next_step: string
    entry_point: string
    shared_risk: string
  }
  done_criteria: string[]
  assumptions: string[]
  workspace: { worktree_path: string; branch: string }
  delivery_format: string
  authorization: { allow_push: false; allow_deploy: false; allow_spend: false }
}

export type TaskState =
  | 'queued'
  | 'waiting_dispatch'
  | 'running'
  | 'checking'
  | 'done'
  | 'failed'
  | 'paused'
  | 'abandoned'

export interface LlmProfile {
  id: string
  kind: 'openai_compatible' | 'ollama'
  base_url: string
  model: string
  key_ref?: string | null
}

export interface TaskOutputLine {
  task_id: string
  stream: 'stdout' | 'stderr' | string
  text: string
}

export interface Task {
  id: string
  projectId: string
  partId: string
  wireId: string
  goal: GoalCard
  state: TaskState
  stationId?: string
  worktreePath?: string
  dispatchedAt?: string
  finishedAt?: string
  result?: unknown
  command?: string
}

export interface Station {
  id: string
  label: string
  taskId?: string
}

export type ViewMode = 'robot' | 'fleet' | 'task'

export interface DerivedPart {
  part: Part
  progress: number
  displayProgress: number
  status: PartStatus
  shortLegScore: number
  lagging: boolean
  plannedNotStarted: boolean
  rankEligible: boolean
}

export interface DerivedProject {
  project: Project
  parts: DerivedPart[]
  progress: number
  displayProgress: number
  maxShortLeg: number
  hasBlocked: boolean
}

export interface ShortLegEntry {
  projectId: string
  projectName: string
  partId: string
  partLabel: string
  slot: Slot
  progress: number
  status: PartStatus
  score: number
  lagging: boolean
}

export interface AppState {
  theme: 'light' | 'dark' | 'system'
  view: ViewMode
  selectedProjectId: string
  selectedPartId?: string
  selectedWireId?: string
  projects: Project[]
  stations: Station[]
  tasks: Task[]
  queue: string[]
  goalDraft?: GoalCard
  rightPanel?: 'changes' | 'browser' | 'terminal' | 'files' | 'facts'
  leftCollapsed: boolean
  fleetSort: 'shortleg' | 'name' | 'recent'
  showGoalCard: boolean
  stubDialog?: string
  composerDraft?: string
  llmProfile?: string
  dispatchTarget?: string
  attachments?: string[]
  selectedTaskId?: string
  taskLines?: Record<string, TaskOutputLine[]>
}

export const SLOT_LABELS: Record<Slot, string> = {
  head: '头 · 决策 / 算法',
  torso: '躯干 · 核心域',
  left_arm: '左臂 · 前端 UI',
  right_arm: '右臂 · 对外接口',
  left_leg: '左腿 · 基础设施',
  right_leg: '右腿 · 部署发布',
  backpack: '背包 · 可选扩展',
}

export const STATUS_LABELS: Record<PartStatus, string> = {
  unmapped: '未映射',
  pending: '未开工',
  in_progress: '进行中',
  done: '已完成',
  blocked: '受阻',
}

export const DEFAULT_WEIGHTS: Record<Slot, number> = {
  head: 2,
  torso: 3,
  left_arm: 2,
  right_arm: 2,
  left_leg: 2,
  right_leg: 2,
  backpack: 1,
}
