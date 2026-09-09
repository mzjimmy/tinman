import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ArchitectureProposal } from '../domain/proposal'

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
}

export function onScanProgress(handler: (p: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>('scan-progress', (e) => handler(e.payload))
}

export function onMenu(handler: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>('menu', (e) => handler(e.payload))
}
