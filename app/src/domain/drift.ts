import type { Facts } from '../lib/api'
import { modulesFromFacts } from '../lib/mapWorkspace'
import { SLOT_LABELS, type DriftFinding, type Project, type Slot } from './types'

export type { DriftFinding, DriftKind } from './types'

const STALE_COMMIT_FLOOR = 5

function fileUnderModule(filePath: string, modulePath: string): boolean {
  const prefix = modulePath.endsWith('/') ? modulePath : `${modulePath}/`
  const bare = modulePath.replace(/\/+$/, '')
  return filePath === bare || filePath.startsWith(prefix)
}

function slotForMappedModule(project: Project, modulePath: string): Slot | undefined {
  for (const part of project.parts) {
    const files = part.facts?.files ?? []
    if (files.some((f) => f === modulePath || fileUnderModule(modulePath, f) || fileUnderModule(f, modulePath))) {
      return part.slot
    }
  }
  return undefined
}

export function detectDrift(project: Project, prev: Facts | null, next: Facts): DriftFinding[] {
  if (prev == null) return []

  const findings: DriftFinding[] = []
  const prevMods = modulesFromFacts(prev)
  const nextMods = modulesFromFacts(next)
  const prevSet = new Set(prevMods)
  const nextSet = new Set(nextMods)

  for (const modulePath of prevMods.filter((m) => !nextSet.has(m)).sort()) {
    const slot = slotForMappedModule(project, modulePath)
    const where = slot ? SLOT_LABELS[slot] : '某个部位'
    findings.push({
      kind: 'module_removed',
      module: modulePath,
      slot,
      text: `原先映射在「${where}」上的目录 ${modulePath} 已经从仓库里消失。`,
      evidence: [`上次扫描有 ${modulePath}`, '这次扫描里这个目录不在了'],
    })
  }

  for (const modulePath of nextMods.filter((m) => !prevSet.has(m)).sort()) {
    findings.push({
      kind: 'module_added',
      module: modulePath,
      text: `仓库里新出现了目录 ${modulePath}，还没有映射到机器人的任何部位。`,
      evidence: [`这次扫描出现 ${modulePath}`],
    })
  }

  const prevCommits = new Map(prev.git.top_files_30d.map((f) => [f.path, f.commits]))
  for (const part of project.parts) {
    const modules = part.facts?.files ?? []
    if (modules.length === 0) continue
    let hottest: { path: string; commits: number } | null = null
    for (const file of next.git.top_files_30d) {
      const before = prevCommits.get(file.path) ?? 0
      if (file.commits < STALE_COMMIT_FLOOR || file.commits <= before) continue
      if (!modules.some((m) => fileUnderModule(file.path, m))) continue
      if (!hottest || file.commits > hottest.commits) hottest = file
    }
    if (!hottest) continue
    for (const wire of part.wires) {
      findings.push({
        kind: 'wire_stale',
        slot: part.slot,
        wireId: wire.id,
        text: `「${wire.label}」的验收标准可能过时：对应代码最近一直在改。`,
        evidence: [`${hottest.path}（30 天内 ${hottest.commits} 次提交）`],
      })
    }
  }

  return findings
}

export function applyDrift(project: Project, findings: DriftFinding[]): Project {
  return Object.assign({ ...project }, { driftFindings: findings.slice() })
}

export function driftSummary(findings: DriftFinding[]): string {
  if (findings.length === 0) return '对照扫描没有发现映射过时。'
  return `对照扫描发现这些变化需要你过目：${findings.map((f) => f.text).join('；')}`
}
