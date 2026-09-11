import { describe, expect, it } from 'vitest'
import { lastCommitDaysFor } from '../domain/proposeMap'
import { partFromDto, projectFromWorkspace } from './mapWorkspace'
import type { Facts, PartDto, WorkspaceDto } from './api'

function facts(partial: Partial<Facts> = {}): Facts {
  return {
    root: '/tmp/proj',
    scanned_at: '2026-09-11T00:00:00Z',
    duration_ms: 8,
    file_count: 3,
    by_extension: { ts: 3 },
    loc_by_language: { TypeScript: 10 },
    tree: [{ name: 'src', kind: 'dir', files: 2 }],
    dependencies: [],
    entry_points: { npm_scripts: {}, makefile_targets: [], dockerfile: false, readme_commands: [] },
    tests: { files: [], pass: null, fail: null, note: 'existence only; tests were not executed' },
    git: {
      branch: 'main',
      last_commit_at: '2026-09-10T00:00:00Z',
      last_commit_subject: 'touch web',
      uncommitted: false,
      top_files_30d: [{ path: 'web/App.tsx', commits: 3 }],
    },
    markers: [],
    spec_docs: [],
    design_files: [],
    reference_images: [],
    routes: [],
    api_endpoints: [],
    pages: [],
    ...partial,
  }
}

function partDto(slot: string, id: string): PartDto {
  return {
    id,
    workspace_id: 'ws-1',
    slot,
    label: slot,
    weight: 2,
    planned_start: null,
    status: 'in_progress',
    wires: [
      {
        id: `w-${id}`,
        part_id: id,
        label: 'wire',
        criteria: [
          { text: 'a', met: false, evidence: '' },
          { text: 'b', met: false, evidence: '' },
          { text: 'c', met: false, evidence: '' },
        ],
        progress: 0,
        status: 'pending',
        updated_at: '2026-09-11T00:00:00Z',
      },
    ],
  }
}

describe('mapWorkspace lastCommitDays', () => {
  it('stalled coefficient input is per-module, not the repo-wide last commit', () => {
    const f = facts()
    const torso = partFromDto(partDto('torso', 't'), f, ['src/'])
    const arm = partFromDto(partDto('left_arm', 'a'), f, ['web/'])
    expect(torso.wires[0]?.lastCommitDays).toBe(lastCommitDaysFor(['src/'], f))
    expect(arm.wires[0]?.lastCommitDays).toBe(0)
    expect(torso.wires[0]?.lastCommitDays).toBeGreaterThan(30)
  })

  it('reads auto-draft metadata back from workspace prefs', () => {
    const ws: WorkspaceDto = {
      id: 'ws-1',
      name: 'ws',
      root_path: '/tmp/ws',
      created_at: '2026-01-01T00:00:00Z',
      llm_profile_id: null,
      prefs: {
        mapConfirmed: false,
        mapDraftSource: 'heuristic',
        mapGaps: ['还没有测试文件，没法从测试看出哪些功能已经稳了'],
      },
      parts: [],
    }
    const project = projectFromWorkspace(ws)
    expect(project.mapDraftSource).toBe('heuristic')
    expect(project.mapGaps?.[0]).toContain('测试文件')
  })
})
