import {
  ALL_SLOTS,
  DEFAULT_WEIGHTS,
  SLOT_LABELS,
  type Criterion,
  type Project,
  type Slot,
} from './types'
import {
  applyProposal,
  assignModule,
  emptyProposal,
  type ArchitectureProposal,
  type ProposedPart,
} from './proposal'

/** Subset of scan facts the mapper is allowed to read. No progress numbers. */
export interface FactSlice {
  tree: { name: string; kind: string; files: number }[]
  tests: { files: string[] }
  git: {
    last_commit_at?: string | null
    last_commit_subject?: string | null
    uncommitted?: boolean
    top_files_30d?: { path: string; commits: number }[]
  }
  markers: { kind: string; path: string; line: number }[]
  spec_docs?: string[]
  routes?: string[]
  api_endpoints?: string[]
  pages?: string[]
}

export type MapDraftSource = 'llm' | 'heuristic'

const SLOT_HINTS: Record<Slot, string[]> = {
  head: ['head', 'algo', 'algorithm', 'ml', 'ai', 'llm', 'model', 'models', 'planner', 'policy'],
  torso: ['src', 'lib', 'core', 'domain', 'backend', 'server', 'pkg', 'internal', 'crates', 'app'],
  left_arm: ['ui', 'frontend', 'client', 'web', 'components', 'pages', 'views', 'renderer'],
  right_arm: ['api', 'routes', 'gateway', 'proto', 'graphql', 'rpc', 'sdk', 'handlers', 'endpoints'],
  left_leg: ['infra', 'infrastructure', 'db', 'database', 'migrations', 'scripts', 'tools'],
  right_leg: ['deploy', 'deployment', 'docker', 'ops', 'k8s', 'kubernetes', 'terraform', 'helm', 'ci'],
  backpack: ['docs', 'doc', 'examples', 'example', 'demo', 'vendor', 'third_party', 'plugins', 'extensions', 'samples'],
}

const CRITERIA_PADS = [
  '改动只发生在派发工作区，不改扫描根目录',
  '完成时留下可核对的 git 改动或任务日志',
  '不把完成度数字写进仓库或任务卡',
]

export function moduleName(raw: string): string {
  return raw.replace(/^\.\/+/, '').replace(/\/+$/, '')
}

export function withSlash(raw: string): string {
  const name = moduleName(raw)
  return name ? `${name}/` : ''
}

export function pathUnder(file: string, modulePath: string): boolean {
  const f = moduleName(file)
  const m = moduleName(modulePath)
  if (!m) return false
  return f === m || f.startsWith(`${m}/`)
}

export function treeFingerprint(facts: FactSlice): string {
  return facts.tree
    .filter((t) => t.kind === 'dir')
    .map((t) => moduleName(t.name))
    .filter(Boolean)
    .sort()
    .join('\n')
}

export function gapsFromFacts(facts: FactSlice): string[] {
  const gaps: string[] = []
  if (facts.tests.files.length === 0) {
    gaps.push('还没有测试文件，没法从测试看出哪些功能已经稳了')
  }
  if (facts.markers.length > 0) {
    const sample = facts.markers[0]!
    gaps.push(
      `扫描到未完成标记（例如 ${sample.path} 的 ${sample.kind}），可能是还没做完的事`,
    )
  }
  if (facts.git.uncommitted) {
    gaps.push('工作区里有未提交的改动')
  }
  if (!facts.spec_docs?.length) {
    gaps.push('没发现说明文档，意图只能从目录和代码文件猜')
  }
  if (facts.git.last_commit_subject) {
    gaps.push(`最近一次提交：${facts.git.last_commit_subject}`)
  }
  return gaps
}

function scoreSlot(dirName: string, slot: Slot): number {
  const n = moduleName(dirName).toLowerCase()
  if (!n) return 0
  let best = 0
  for (const hint of SLOT_HINTS[slot]) {
    if (n === hint) best = Math.max(best, 3)
    else if (n.includes(hint) || hint.includes(n)) best = Math.max(best, 2)
  }
  if (slot === 'right_leg' && n === '.github') return 3
  return best
}

export function pickSlot(dirName: string): Slot {
  let best: Slot = 'backpack'
  let bestScore = 0
  for (const slot of ALL_SLOTS) {
    const s = scoreSlot(dirName, slot)
    if (s > bestScore) {
      best = slot
      bestScore = s
    }
  }
  if (bestScore === 0) {
    const filesGuess = moduleName(dirName).toLowerCase()
    if (filesGuess === 'src' || filesGuess === 'lib' || filesGuess === 'app') return 'torso'
    return 'backpack'
  }
  return best
}

function unmet(text: string): Criterion {
  return { text, met: false, evidence: '' }
}

function criteriaFor(slot: Slot, modules: string[], facts: FactSlice): Criterion[] {
  const label = modules.map(withSlash).filter(Boolean).join('、') || '该部位'
  const items: string[] = [`${label} 是该部位对应的代码位置`]

  const tests = facts.tests.files.filter((f) => modules.some((m) => pathUnder(f, m)))
  if (tests[0]) {
    items.push(`能从 ${tests[0]} 看出该部位的行为`)
  } else {
    items.push('该部位还没有测试文件，需要补上能证明行为的测试')
  }

  const todo = facts.markers.find((m) => modules.some((mod) => pathUnder(m.path, mod)))
  if (todo) {
    items.push(`处理 ${todo.path} 里的 ${todo.kind}`)
  } else if (facts.spec_docs?.[0]) {
    items.push(`对照 ${facts.spec_docs[0]} 核对该部位是否符合约定`)
  } else {
    items.push(CRITERIA_PADS[1]!)
  }

  if (slot === 'left_arm' && facts.pages?.[0]) {
    items.push(`页面 ${facts.pages[0]} 可以打开`)
  } else if (slot === 'right_arm' && facts.api_endpoints?.[0]) {
    items.push(`接口 ${facts.api_endpoints[0]} 可以访问`)
  } else {
    items.push(CRITERIA_PADS[0]!)
  }

  const unique = [...new Set(items)].slice(0, 6)
  while (unique.length < 3) unique.push(CRITERIA_PADS[unique.length] ?? CRITERIA_PADS[0]!)
  return unique.slice(0, 6).map(unmet)
}

function padCriteria(existing: Criterion[]): Criterion[] {
  const cleaned = existing
    .map((c) => unmet(c.text.trim()))
    .filter((c) => c.text.length > 0)
    .slice(0, 6)
  const texts = new Set(cleaned.map((c) => c.text))
  for (const pad of CRITERIA_PADS) {
    if (cleaned.length >= 3) break
    if (texts.has(pad)) continue
    cleaned.push(unmet(pad))
    texts.add(pad)
  }
  while (cleaned.length < 3) {
    cleaned.push(unmet(CRITERIA_PADS[0]!))
  }
  return cleaned
}

export function proposeFromFacts(facts: FactSlice): ArchitectureProposal {
  const dirs = facts.tree.filter((t) => t.kind === 'dir').map((t) => withSlash(t.name)).filter(Boolean)
  let proposal = emptyProposal()
  proposal = {
    parts: proposal.parts.map((p) => ({
      ...p,
      present: false,
      modulePaths: [],
      wires: [],
    })),
  }
  for (const dir of dirs) {
    const slot = pickSlot(dir)
    proposal = assignModule(proposal, dir, slot)
  }
  proposal = {
    parts: proposal.parts.map((p) => {
      if (p.modulePaths.length === 0) {
        return { ...p, present: false, wires: [] }
      }
      return {
        ...p,
        present: true,
        label: SLOT_LABELS[p.slot].split(' · ')[1] ?? SLOT_LABELS[p.slot],
        weight: DEFAULT_WEIGHTS[p.slot],
        wires: [
          {
            label: SLOT_LABELS[p.slot].split(' · ')[1] ?? p.label,
            criteria: criteriaFor(p.slot, p.modulePaths, facts),
          },
        ],
      }
    }),
  }
  return proposal
}

function asSlot(raw: unknown): Slot | null {
  return typeof raw === 'string' && (ALL_SLOTS as readonly string[]).includes(raw)
    ? (raw as Slot)
    : null
}

function criteriaFromUnknown(raw: unknown): Criterion[] {
  if (!Array.isArray(raw)) return []
  const out: Criterion[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push(unmet(item.trim()))
      continue
    }
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>
      const text = typeof rec.text === 'string' ? rec.text.trim() : ''
      if (text) out.push(unmet(text))
    }
  }
  return out
}

function wiresFromUnknown(raw: unknown): ProposedPart['wires'] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const rec = item as Record<string, unknown>
      const label = typeof rec.label === 'string' ? rec.label.trim() : ''
      const criteria = padCriteria(criteriaFromUnknown(rec.criteria ?? rec.done_criteria))
      if (!label) return null
      return { label, criteria }
    })
    .filter((w): w is NonNullable<typeof w> => w !== null)
}

/** Force 7 slots, unmet criteria, no progress. LLM output is overlaid on a heuristic base. */
export function parseLlmMap(raw: unknown, base: ArchitectureProposal): ArchitectureProposal {
  if (!raw || typeof raw !== 'object') return base
  const rec = raw as Record<string, unknown>
  const partsRaw = Array.isArray(rec.parts) ? rec.parts : Array.isArray(raw) ? raw : []
  const incoming: ArchitectureProposal = { parts: [] }
  for (const item of partsRaw) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const slot = asSlot(p.slot)
    if (!slot) continue
    const modulesRaw = p.modulePaths ?? p.module_paths ?? p.modules
    const modulePaths = Array.isArray(modulesRaw)
      ? modulesRaw.filter((m): m is string => typeof m === 'string').map(withSlash).filter(Boolean)
      : []
    const present = p.present === true || modulePaths.length > 0
    const label =
      typeof p.label === 'string' && p.label.trim()
        ? p.label.trim()
        : (SLOT_LABELS[slot].split(' · ')[1] ?? SLOT_LABELS[slot])
    const weight = typeof p.weight === 'number' && p.weight >= 0.5 && p.weight <= 8 ? p.weight : DEFAULT_WEIGHTS[slot]
    let wires = wiresFromUnknown(p.wires)
    if (present && wires.length === 0) {
      const fallback = base.parts.find((b) => b.slot === slot)
      wires = fallback?.wires.length
        ? fallback.wires
        : [{ label, criteria: padCriteria([]) }]
    } else {
      wires = wires.map((w) => ({ ...w, criteria: padCriteria(w.criteria) }))
    }
    incoming.parts.push({
      slot,
      present,
      label,
      weight,
      plannedStart: typeof p.plannedStart === 'string' ? p.plannedStart : typeof p.planned_start === 'string' ? p.planned_start : '',
      modulePaths,
      wires: present ? wires : [],
    })
  }
  return applyProposal(base, incoming)
}

export function proposalFromProject(project: Project): ArchitectureProposal {
  const bySlot = new Map(project.parts.map((p) => [p.slot, p]))
  return {
    parts: ALL_SLOTS.map((slot) => {
      const p = bySlot.get(slot)
      const empty = emptyProposal().parts.find((x) => x.slot === slot)!
      if (!p) return empty
      return {
        slot,
        present: p.status !== 'unmapped',
        label: p.label,
        weight: p.weight,
        plannedStart: p.plannedStart ?? '',
        modulePaths: (p.facts?.files ?? []).map(withSlash).filter(Boolean),
        wires: p.wires.map((w) => ({
          label: w.label,
          criteria: w.criteria.map((c) => ({ ...c })),
        })),
      }
    }),
  }
}

export function mergeDrift(
  current: ArchitectureProposal,
  heuristic: ArchitectureProposal,
  liveModules: string[],
): { proposal: ArchitectureProposal; added: string[]; removed: string[] } {
  const live = new Set(liveModules.map(withSlash).filter(Boolean))
  const assigned = new Set(current.parts.flatMap((p) => p.modulePaths.map(withSlash)))
  const added = [...live].filter((m) => !assigned.has(m))
  const removed = [...assigned].filter((m) => !live.has(m))

  let proposal: ArchitectureProposal = {
    parts: current.parts.map((p) => ({
      ...p,
      modulePaths: p.modulePaths.map(withSlash).filter((m) => live.has(m)),
    })),
  }

  for (const mod of added) {
    const heur = heuristic.parts.find((p) => p.modulePaths.map(withSlash).includes(mod))
    const slot = heur?.slot ?? pickSlot(mod)
    proposal = assignModule(proposal, mod, slot)
    proposal = {
      parts: proposal.parts.map((p) => {
        if (p.slot !== slot) return p
        const heurPart = heuristic.parts.find((h) => h.slot === slot)
        const wires =
          p.wires.length > 0
            ? p.wires
            : heurPart?.wires.length
              ? heurPart.wires.map((w) => ({
                  ...w,
                  criteria: w.criteria.map((c) => unmet(c.text)),
                }))
              : [{ label: SLOT_LABELS[slot].split(' · ')[1] ?? slot, criteria: padCriteria([]) }]
        return { ...p, present: true, wires }
      }),
    }
  }
  return { proposal, added, removed }
}

export function lastCommitDaysFor(
  modulePaths: string[],
  facts: FactSlice | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!facts) return undefined
  const global = daysSinceMs(facts.git.last_commit_at, now)
  if (modulePaths.length === 0) return global
  const related = (facts.git.top_files_30d ?? []).some((f) =>
    modulePaths.some((m) => pathUnder(f.path, m)),
  )
  if (related) return 0
  if (global !== undefined && global <= 30) return 31
  return global
}

function daysSinceMs(iso: string | null | undefined, now: number): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return undefined
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}
