import type { Facts } from '../lib/api'
import { fleetRanking } from './shortLeg'
import type { Part, Project, Wire } from './types'

export type IntentConfidence = 'matched' | 'shortleg'

export interface IntentTarget {
  projectId: string
  partId: string
  wireId: string
  confidence: IntentConfidence
  why: string
}

export interface ProgressNarrative {
  done: string[]
  remaining: string[]
}

const MIN_OVERLAP = 2

function longestOverlap(a: string, b: string): string {
  if (!a || !b) return ''
  const s = a.length <= b.length ? a : b
  const t = a.length <= b.length ? b : a
  let best = ''
  for (let i = 0; i < s.length; i++) {
    for (let j = s.length; j > i; j--) {
      const sub = s.slice(i, j)
      if (sub.length <= best.length) break
      if (t.includes(sub)) {
        best = sub
        break
      }
    }
  }
  return best
}

function overlapScore(intent: string, haystack: string, weight: number): number {
  const needle = intent.trim().toLowerCase()
  const hay = haystack.trim().toLowerCase()
  if (!needle || !hay) return 0
  const overlap = longestOverlap(needle, hay)
  if (overlap.length < MIN_OVERLAP) return 0
  let score = overlap.length * weight
  if (needle.includes(hay) && hay.length >= MIN_OVERLAP) score += 1000 + hay.length * 10
  if (hay.includes(needle) && needle.length >= MIN_OVERLAP) score += 400 + needle.length
  return score
}

function pickWireOnPart(part: Part, intent: string): Wire | undefined {
  if (part.wires.length === 0) return undefined
  let best: Wire | undefined
  let bestScore = -1
  for (const wire of part.wires) {
    let score = overlapScore(intent, wire.label, 10)
    for (const c of wire.criteria) {
      score = Math.max(score, overlapScore(intent, c.text, 3))
    }
    const unmet = wire.criteria.filter((c) => !c.met).length
    score += unmet * 0.01
    if (score > bestScore) {
      bestScore = score
      best = wire
    }
  }
  return best ?? part.wires[0]
}

interface Hit {
  project: Project
  part: Part
  wire: Wire
  score: number
  matched: string
}

function bestHit(projects: Project[], intent: string): Hit | null {
  let best: Hit | null = null
  for (const project of projects) {
    if (!project.mapConfirmed) continue
    for (const part of project.parts) {
      if (part.status === 'unmapped' || part.wires.length === 0) continue
      const partScore = overlapScore(intent, part.label, 6)
      for (const wire of part.wires) {
        let score = overlapScore(intent, wire.label, 10)
        let matched = wire.label
        for (const c of wire.criteria) {
          const cs = overlapScore(intent, c.text, 3)
          if (cs > score) {
            score = cs
            matched = c.text
          }
        }
        if (partScore > score) {
          score = partScore
          matched = part.label
        }
        if (score <= 0) continue
        if (!best || score > best.score) {
          best = { project, part, wire, score, matched }
        }
      }
    }
  }
  return best
}

function shortlegTarget(projects: Project[]): IntentTarget | null {
  const ranked = fleetRanking(projects)
  for (const entry of ranked) {
    const project = projects.find((p) => p.id === entry.projectId)
    const part = project?.parts.find((p) => p.id === entry.partId)
    const wire = part ? pickWireOnPart(part, '') : undefined
    if (!project || !part || !wire) continue
    return {
      projectId: project.id,
      partId: part.id,
      wireId: wire.id,
      confidence: 'shortleg',
      why: `这句话没有对上任何已确认的线路，所以先看当前最短的腿：「${part.label}」（项目「${project.name}」）。`,
    }
  }
  return null
}

export function targetFromIntent(intent: string, projects: Project[]): IntentTarget | null {
  const confirmed = projects.filter((p) => p.mapConfirmed)
  if (confirmed.length === 0) return null

  const hit = bestHit(confirmed, intent)
  if (hit) {
    return {
      projectId: hit.project.id,
      partId: hit.part.id,
      wireId: hit.wire.id,
      confidence: 'matched',
      why: `这句话对上了「${hit.matched}」，落到「${hit.project.name}」的「${hit.wire.label}」这条线路。`,
    }
  }
  return shortlegTarget(confirmed)
}

function looksLikeLoginFact(s: string): boolean {
  return /login|sign[-_]?in|auth/i.test(s)
}

function visibleUserWords(intent: string): string {
  const trimmed = intent.trim()
  if (!trimmed) return '这件事'
  const cjk = trimmed.match(/[\u3400-\u9fff]{2,}/)
  if (cjk) return cjk[0]
  const word = trimmed.match(/[A-Za-z][A-Za-z0-9_-]{1,}/)
  if (word) return word[0]
  return trimmed
}

function statesForbiddenProgress(text: string): boolean {
  return /\d+\s*[%％]/.test(text) || /进度|完成度/.test(text)
}

export function draftCriteriaFromIntent(intent: string, part: Part, facts?: Facts): string[] {
  const text = intent.trim() || '这件事'
  const words = visibleUserWords(text)
  const lines: string[] = []
  const push = (raw: string) => {
    const s = raw.trim()
    if (!s || statesForbiddenProgress(s) || lines.includes(s)) return
    lines.push(s)
  }

  push(`「${text}」这件事本身能被验收`)

  const matchedWire = part.wires.find((w) => overlapScore(text, w.label, 1) > 0)
  if (matchedWire) {
    push(`${matchedWire.label}按这句话做完，并且能证明${words}不再出问题`)
  } else {
    push(`${part.label}能对上「${words}」`)
  }

  if (facts) {
    const relatedRoutes = facts.routes.filter(
      (r) => overlapScore(text, r, 1) > 0 || (/登录/.test(text) && looksLikeLoginFact(r)),
    )
    for (const r of (relatedRoutes.length ? relatedRoutes : facts.routes).slice(0, 2)) {
      push(`打开 ${r} 能看到对应页面`)
    }
    const relatedPages = facts.pages.filter(
      (p) => overlapScore(text, p, 1) > 0 || (/登录/.test(text) && looksLikeLoginFact(p)),
    )
    for (const p of relatedPages.slice(0, 2)) {
      push(`页面 ${p} 能打开且不再报错`)
    }
    const relatedApis = facts.api_endpoints.filter(
      (e) => overlapScore(text, e, 1) > 0 || (/登录|退款/.test(text) && looksLikeLoginFact(e)),
    )
    for (const e of relatedApis.slice(0, 2)) {
      push(`${e} 能被调用并给出明确成功或失败`)
    }
  }

  push(`${words}失败时使用者能看到原因，而不是白屏`)
  push(`有证据（测试记录或实际操作）证明「${words}」这件事成立`)

  const fallbacks = [
    `${part.label}按这句话做完可以让人亲手验收`,
    `相关操作能重复做一次得到同样结果`,
    `出错时不会只剩无提示的失败`,
  ]
  for (const f of fallbacks) {
    if (lines.length >= 3) break
    push(f)
  }

  while (lines.length < 3) {
    push(`可以当场验收「${words}」是否成立`)
    if (lines.length < 3) push(`失败时有人能看懂的原因`)
    if (lines.length < 3) push(`有证据证明上述成立`)
    break
  }

  return lines.slice(0, 6)
}

export function progressNarrative(part: Part): ProgressNarrative {
  const done: string[] = []
  const remaining: string[] = []
  for (const wire of part.wires) {
    for (const c of wire.criteria) {
      const line = c.text.trim()
      if (!line) continue
      if (c.met) done.push(line)
      else remaining.push(line)
    }
  }
  return { done, remaining }
}
