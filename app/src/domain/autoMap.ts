import type { Facts } from '../lib/api'
import { modulesFromFacts } from '../lib/mapWorkspace'
import { applyProposal, emptyProposal, type ArchitectureProposal, type ProposedPart, type ProposedWire } from './proposal'
import { ALL_SLOTS, DEFAULT_WEIGHTS, SLOT_LABELS, type Criterion, type Slot } from './types'

/** First match wins. Specific ops/API names before generic core names. */
const SLOT_KEYWORDS: { slot: Slot; keys: readonly string[] }[] = [
  { slot: 'right_leg', keys: ['deploy', 'deployment', 'release', 'releases', 'helm', 'charts', 'k8s', 'cd'] },
  {
    slot: 'left_leg',
    keys: [
      'infra',
      'infrastructure',
      'ops',
      'terraform',
      'ansible',
      'docker',
      'compose',
      'ci',
      'monitoring',
      'observability',
      'migrations',
      'scripts',
    ],
  },
  {
    slot: 'right_arm',
    keys: [
      'api',
      'apis',
      'server',
      'backend',
      'endpoints',
      'endpoint',
      'routes',
      'controllers',
      'controller',
      'handlers',
      'handler',
      'gateway',
      'grpc',
      'rpc',
    ],
  },
  {
    slot: 'left_arm',
    keys: [
      'components',
      'component',
      'frontend',
      'ui',
      'pages',
      'page',
      'views',
      'view',
      'client',
      'web',
      'css',
      'styles',
      'renderer',
    ],
  },
  {
    slot: 'head',
    keys: ['algo', 'algorithm', 'algorithms', 'ml', 'ai', 'decision', 'policy', 'planner', 'agent', 'llm'],
  },
  {
    slot: 'backpack',
    keys: [
      'plugin',
      'plugins',
      'extension',
      'extensions',
      'addon',
      'addons',
      'extra',
      'extras',
      'optional',
      'vendor',
      'third_party',
      'third-party',
      'docs',
      'examples',
      'demo',
    ],
  },
  {
    slot: 'torso',
    keys: ['domain', 'core', 'engine', 'models', 'business', 'entities', 'entity', 'services', 'service', 'lib', 'internal'],
  },
]

const GENERIC_CRITERIA: Record<Slot, string[]> = {
  head: ['同一输入会得到同一决策结果', '无法决策时有明确的失败提示', '决策规则能用一句话向非程序员复述'],
  torso: ['核心对象能被创建和读取', '非法输入会被拒绝', '核心流程有一条可复述的成功路径'],
  left_arm: ['主要页面能打开', '关键按钮按下后有看得见的结果', '错误状态会显示给使用者看'],
  right_arm: ['列出的接口能被调用', '错误请求会返回明确失败', '未授权的请求会被拒绝'],
  left_leg: ['按仓库说明能在本机把依赖装上', '配置缺失时有明确报错', '日志能指出失败发生在哪一步'],
  right_leg: ['仓库里能找到一条发布或构建入口', '发布失败时能看到失败原因', '发布入口能被非作者按文档找到'],
  backpack: ['扩展能被关掉而不影响主流程', '扩展的入口文件能被找到', '扩展失败不会让主程序静默退出'],
}

const WIRE_LABELS: Record<Slot, string> = {
  head: '决策规则',
  torso: '核心流程',
  left_arm: '页面与交互',
  right_arm: '对外接口',
  left_leg: '基础设施',
  right_leg: '发布',
  backpack: '可选扩展',
}

function dirName(modulePath: string): string {
  return modulePath.replace(/\/+$/, '').toLowerCase()
}

function nameMatches(name: string, keys: readonly string[]): boolean {
  const tokens = name.split(/[-_./]+/).filter(Boolean)
  return keys.some((key) => name === key || tokens.includes(key))
}

export function slotForModule(modulePath: string, facts: Facts): Slot | null {
  const name = dirName(modulePath)
  if (!name) return null
  for (const row of SLOT_KEYWORDS) {
    if (nameMatches(name, row.keys)) return row.slot
  }
  if (name === 'src' || name === 'app') {
    return facts.pages.length > 0 ? 'left_arm' : 'torso'
  }
  return null
}

function unmet(text: string): Criterion {
  return { text, met: false, evidence: '' }
}

function looksLikeLogin(s: string): boolean {
  return /login|sign[-_]?in/i.test(s)
}

function looksLikeAuthEndpoint(ep: string): boolean {
  return /login|sign[-_]?in|session|\/auth\b/i.test(ep)
}

function draftCriteria(slot: Slot, facts: Facts, modules: string[]): Criterion[] {
  const texts: string[] = []
  const push = (t: string) => {
    const s = t.trim()
    if (!s) return
    if (/\d+\s*%/.test(s) || /进度|完成度/.test(s)) return
    if (texts.includes(s)) return
    texts.push(s)
  }

  if (slot === 'left_arm') {
    for (const p of facts.pages.slice(0, 3)) push(`仓库里有页面文件 ${p}`)
    for (const r of facts.routes.slice(0, 3)) push(`打开 ${r} 能看到对应页面`)
    if (facts.pages.some(looksLikeLogin) || facts.routes.some(looksLikeLogin)) {
      push('未登录访问受保护页会跳到登录页')
    }
  }
  if (slot === 'right_arm') {
    for (const ep of facts.api_endpoints.slice(0, 4)) {
      push(`${ep} 能被调用并给出明确成功或失败`)
    }
  }
  if (slot === 'right_leg') {
    if (facts.entry_points.dockerfile) push('用 Dockerfile 能构建出可发布的镜像')
    const scriptNames = Object.keys(facts.entry_points.npm_scripts)
    for (const s of scriptNames.filter((n) => /deploy|release|start|build/i.test(n)).slice(0, 2)) {
      push(`npm 脚本 ${s} 能作为发布或构建入口`)
    }
    for (const t of facts.entry_points.makefile_targets.filter((n) => /deploy|release|publish/i.test(n)).slice(0, 2)) {
      push(`Makefile 目标 ${t} 能作为发布入口`)
    }
  }
  if (slot === 'left_leg') {
    if (modules.length) push(`基础设施目录 ${modules.join('、')} 能被独立构建或启动`)
  }
  if (slot === 'torso') {
    if (modules.length) push(`核心目录 ${modules.join('、')} 里的对象能被创建和读取`)
  }
  if (slot === 'head') {
    if (modules.length) push(`决策相关目录 ${modules.join('、')} 对同一输入给出同一结果`)
  }
  if (slot === 'backpack') {
    if (modules.length) push(`扩展目录 ${modules.join('、')} 关掉后主流程仍能跑`)
  }

  for (const g of GENERIC_CRITERIA[slot]) push(g)
  const picked = texts.slice(0, 6)
  while (picked.length < 3) {
    picked.push(GENERIC_CRITERIA[slot][picked.length] ?? '该项可以用手工验收确认')
  }
  return picked.slice(0, 6).map(unmet)
}

function draftWires(slot: Slot, facts: Facts, modules: string[]): ProposedWire[] {
  let label = WIRE_LABELS[slot]
  if (slot === 'right_arm' && facts.api_endpoints.some(looksLikeAuthEndpoint)) {
    label = '登录接口'
  }
  if (slot === 'left_arm' && (facts.pages.some(looksLikeLogin) || facts.routes.some(looksLikeLogin))) {
    label = '登录页'
  }
  return [{ label, criteria: draftCriteria(slot, facts, modules) }]
}

export function heuristicProposal(facts: Facts): ArchitectureProposal {
  const base = emptyProposal()
  const bySlot = new Map<Slot, string[]>()
  for (const slot of ALL_SLOTS) bySlot.set(slot, [])
  for (const modulePath of modulesFromFacts(facts)) {
    const slot = slotForModule(modulePath, facts)
    if (!slot) continue
    const list = bySlot.get(slot)
    if (list && !list.includes(modulePath)) list.push(modulePath)
  }
  return {
    parts: base.parts.map((p) => {
      const modulePaths = bySlot.get(p.slot) ?? []
      const present = p.slot === 'backpack' ? modulePaths.length > 0 : true
      return {
        ...p,
        present,
        modulePaths,
        wires: present ? draftWires(p.slot, facts, modulePaths) : [],
      }
    }),
  }
}

function isSlot(value: unknown): value is Slot {
  return typeof value === 'string' && (ALL_SLOTS as readonly string[]).includes(value)
}

function clampWeight(raw: unknown, slot: Slot): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_WEIGHTS[slot]
  return Math.min(8, Math.max(0.5, n))
}

function sanitizeCriteria(raw: unknown): Criterion[] | null {
  if (!Array.isArray(raw)) return null
  const texts: string[] = []
  for (const item of raw) {
    const text =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
          ? (item as { text: string }).text.trim()
          : ''
    if (text) texts.push(text)
  }
  if (texts.length < 3 || texts.length > 6) return null
  return texts.map(unmet)
}

function sanitizeWire(raw: unknown): ProposedWire | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const criteria = sanitizeCriteria(o.criteria)
  if (!criteria) return null
  const label = typeof o.label === 'string' ? o.label : ''
  return { label, criteria }
}

function shortLabel(slot: Slot, raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw
  return SLOT_LABELS[slot].split(' · ')[1] ?? SLOT_LABELS[slot]
}

function sanitizePart(raw: unknown): ProposedPart | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!isSlot(o.slot)) return null
  const slot = o.slot
  const wiresRaw = o.wires
  const wires: ProposedWire[] = Array.isArray(wiresRaw)
    ? wiresRaw.map(sanitizeWire).filter((w): w is ProposedWire => w !== null)
    : []
  const modulePaths = Array.isArray(o.modulePaths)
    ? o.modulePaths.filter((m): m is string => typeof m === 'string')
    : []
  const present = typeof o.present === 'boolean' ? o.present : true
  return {
    slot,
    present,
    label: shortLabel(slot, o.label),
    weight: clampWeight(o.weight, slot),
    plannedStart: typeof o.plannedStart === 'string' ? o.plannedStart : '',
    modulePaths,
    wires,
  }
}

export function sanitizeLlmProposal(raw: unknown): ArchitectureProposal | null {
  if (!raw || typeof raw !== 'object') return null
  const partsRaw = (raw as { parts?: unknown }).parts
  if (!Array.isArray(partsRaw)) return null
  const bySlot = new Map<Slot, ProposedPart>()
  for (const item of partsRaw) {
    const part = sanitizePart(item)
    if (!part) continue
    if (!bySlot.has(part.slot)) bySlot.set(part.slot, part)
  }
  return { parts: [...bySlot.values()] }
}

export function autoDraft(
  facts: Facts,
  llmOutput: unknown,
): { proposal: ArchitectureProposal; source: 'llm' | 'heuristic' } {
  const heuristic = heuristicProposal(facts)
  const sanitized = sanitizeLlmProposal(llmOutput)
  if (!sanitized || sanitized.parts.length === 0) {
    return { proposal: heuristic, source: 'heuristic' }
  }
  return { proposal: applyProposal(heuristic, sanitized), source: 'llm' }
}
