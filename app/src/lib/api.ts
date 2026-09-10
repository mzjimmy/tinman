import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ArchitectureProposal } from '../domain/proposal'
import type {
  FrameworkAdvice,
  GoalCard,
  LlmProfile,
  LlmPurpose,
  LlmUnavailableReason,
  TaskState,
} from '../domain/types'

export type { LlmProfile }

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export interface ScanProgress {
  files_seen: number
  phase: string
  message: string
}

export interface Facts {
  root: string
  scanned_at: string
  duration_ms: number
  file_count: number
  by_extension: Record<string, number>
  loc_by_language: Record<string, number>
  tree: { name: string; kind: string; files: number }[]
  dependencies: { path: string; kind: string; data: unknown }[]
  entry_points: {
    npm_scripts: Record<string, string>
    makefile_targets: string[]
    dockerfile: boolean
    readme_commands: string[]
  }
  tests: { files: string[]; pass: number | null; fail: number | null; note: string }
  git: {
    branch: string | null
    last_commit_at: string | null
    last_commit_subject: string | null
    uncommitted: boolean
    top_files_30d: { path: string; commits: number }[]
  }
  markers: { kind: string; path: string; line: number }[]
  spec_docs: string[]
  design_files: string[]
  reference_images: string[]
  routes: string[]
  api_endpoints: string[]
  pages: string[]
}

export interface WireDto {
  id: string
  part_id: string
  label: string
  criteria: { text: string; met: boolean; evidence: string }[]
  progress: number
  status: string
  updated_at: string
}

export interface PartDto {
  id: string
  workspace_id: string
  slot: string
  label: string
  weight: number
  planned_start: string | null
  status: string
  wires: WireDto[]
}

export interface WorkspaceDto {
  id: string
  name: string
  root_path: string
  created_at: string
  llm_profile_id: string | null
  prefs: Record<string, unknown>
  parts: PartDto[]
}

export interface WorkspaceSummary {
  id: string
  name: string
  root_path: string
  created_at: string
  llm_profile_id: string | null
  prefs: Record<string, unknown>
}

export interface FileNode {
  name: string
  path: string
  kind: string
  children?: FileNode[]
}

export interface GitChanges {
  status: string
  diff: string
}

export type LlmCallResult =
  | {
      status: 'available'
      purpose: LlmPurpose
      advice: FrameworkAdvice | null
      output: unknown
      call_id: string
      duration_ms: number
    }
  | {
      status: 'unavailable'
      reason: LlmUnavailableReason
      detail: string | null
      reject_reason: string | null
      call_id: string | null
      duration_ms: number
    }

export interface LlmCallRow {
  id: string
  workspace_id: string
  purpose: string
  provider_id: string | null
  model: string | null
  request_json: string
  response_text: string | null
  verdict: string
  reject_reason: string | null
  duration_ms: number
  created_at: string
}

export interface TaskRecord {
  id: string
  workspace_id: string
  part_id: string | null
  wire_id: string | null
  goal_json: GoalCard
  state: TaskState
  station: string | null
  worktree_path: string | null
  dispatched_at: string | null
  finished_at: string | null
  result_json: unknown | null
}

export interface AppPaths {
  data_dir: string
  worktrees_dir: string
}

export interface TaskOutputEvent {
  task_id: string
  stream: string
  text: string
}

export interface OutputLine {
  stream: string
  text: string
}

export const api = {
  listWorkspaces: () => invoke<WorkspaceSummary[]>('list_workspaces'),
  getWorkspace: (id: string) => invoke<WorkspaceDto>('get_workspace', { id }),
  createWorkspace: (root_path: string, name?: string) =>
    invoke<WorkspaceDto>('create_workspace', { root_path, name }),
  scanWorkspace: (id: string) => invoke<Facts>('scan_workspace', { id }),
  getFacts: (id: string) => invoke<Facts | null>('get_facts', { id }),
  confirmMap: (id: string, proposal: ArchitectureProposal, name?: string) =>
    invoke<WorkspaceDto>('confirm_map', { id, proposal, name }),
  updatePrefs: (id: string, patch: Record<string, unknown>) =>
    invoke<Record<string, unknown>>('update_prefs', { id, patch }),
  getAppPrefs: () => invoke<Record<string, unknown>>('get_app_prefs'),
  setAppPrefs: (prefs: Record<string, unknown>) => invoke<void>('set_app_prefs', { prefs }),
  setCriterionMet: (wire_id: string, index: number, met: boolean, evidence?: string) =>
    invoke<WireDto>('set_criterion_met', { wire_id, index, met, evidence }),
  listFiles: (id: string) => invoke<FileNode>('list_files', { id }),
  gitChanges: (id: string) => invoke<GitChanges>('git_changes', { id }),
  renameWorkspace: (id: string, name: string) => invoke<void>('rename_workspace', { id, name }),
  llmCall: (workspace_id: string, purpose: LlmPurpose, input: unknown) =>
    invoke<LlmCallResult>('llm_call', { workspace_id, purpose, input }),
  listLlmCalls: (workspace_id: string) => invoke<LlmCallRow[]>('list_llm_calls', { workspace_id }),
  addCriterion: (wire_id: string, text: string) => invoke<WireDto>('add_criterion', { wire_id, text }),
  setLlmKey: (key_ref: string, secret: string) => invoke<void>('set_llm_key', { key_ref, secret }),
  setWorkspaceLlmProfile: (id: string, llm_profile_id: string | null) =>
    invoke<void>('set_workspace_llm_profile', { id, llm_profile_id }),
  appPaths: () => invoke<AppPaths>('app_paths'),
  listTasks: (workspace_id: string) => invoke<TaskRecord[]>('list_tasks', { workspace_id }),
  getTask: (id: string) => invoke<TaskRecord>('get_task', { id }),
  readTaskLog: (task_id: string) => invoke<OutputLine[]>('read_task_log', { task_id }),
  removeWorktree: (task_id: string) => invoke<void>('remove_worktree', { task_id }),
  dispatchTask: (
    workspace_id: string,
    part_id: string,
    wire_id: string,
    goal: GoalCard,
    agent_id: string,
  ) => invoke<TaskRecord>('dispatch_task', { workspace_id, part_id, wire_id, goal, agent_id }),
  pauseTask: (task_id: string) => invoke<TaskRecord>('pause_task', { task_id }),
  resumeTask: (task_id: string) => invoke<TaskRecord>('resume_task', { task_id }),
  abandonTask: (task_id: string) => invoke<TaskRecord>('abandon_task', { task_id }),
}

export function profilesFromPrefs(prefs: Record<string, unknown>): LlmProfile[] {
  const arr = prefs.llm_profiles
  if (!Array.isArray(arr)) return []
  const out: LlmProfile[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    if (typeof p.id !== 'string' || typeof p.model !== 'string' || typeof p.base_url !== 'string') {
      continue
    }
    if (p.kind !== 'openai_compatible' && p.kind !== 'ollama' && p.kind !== 'deepseek') continue
    out.push({
      id: p.id,
      kind: p.kind,
      base_url: p.base_url,
      model: p.model,
      key_ref: typeof p.key_ref === 'string' ? p.key_ref : null,
    })
  }
  return out
}

export function onScanProgress(handler: (p: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>('scan-progress', (e) => handler(e.payload))
}

export function onMenu(handler: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>('menu', (e) => handler(e.payload))
}

export function onTaskOutput(handler: (e: TaskOutputEvent) => void): Promise<UnlistenFn> {
  return listen<TaskOutputEvent>('task-output', (e) => handler(e.payload))
}

export function onTaskState(handler: (t: TaskRecord) => void): Promise<UnlistenFn> {
  return listen<TaskRecord>('task-state', (e) => handler(e.payload))
}
