import { describe, expect, it } from 'vitest'
import {
  LOG_LINE_TEXT_CAP,
  TASK_LINE_CAP,
  appendTaskLine,
  clampLineText,
} from './logBuffer'
import type { TaskOutputLine } from './types'

const line = (text: string, id = 't1'): TaskOutputLine => ({
  task_id: id,
  stream: 'stdout',
  text,
})

describe('log buffer bounds', () => {
  it('keeps the tail and never grows past the cap', () => {
    let lines: TaskOutputLine[] = []
    for (let i = 0; i < TASK_LINE_CAP + 500; i += 1) {
      lines = appendTaskLine(lines, line(`line ${i}`))
    }
    expect(lines.length).toBe(TASK_LINE_CAP)
    // the oldest lines are dropped, the newest are kept
    expect(lines[lines.length - 1].text).toBe(`line ${TASK_LINE_CAP + 499}`)
    expect(lines[0].text).toBe(`line ${500}`)
  })

  it('truncates a single monstrous line instead of storing it whole', () => {
    const huge = 'x'.repeat(5 * 1024 * 1024)
    const [kept] = appendTaskLine([], line(huge))
    expect(kept.text.length).toBeLessThanOrEqual(LOG_LINE_TEXT_CAP + 64)
    expect(kept.text).toContain('truncated')
  })

  it('leaves an ordinary line untouched', () => {
    expect(clampLineText('hello')).toBe('hello')
    const [kept] = appendTaskLine([], line('hello'))
    expect(kept.text).toBe('hello')
    expect(kept.stream).toBe('stdout')
    expect(kept.task_id).toBe('t1')
  })

  it('drops from the front in one pass when handed an over-cap array', () => {
    const many = Array.from({ length: TASK_LINE_CAP * 2 }, (_, i) => line(`old ${i}`))
    const out = appendTaskLine(many, line('new'))
    expect(out.length).toBe(TASK_LINE_CAP)
    expect(out[out.length - 1].text).toBe('new')
  })
})

describe('clamp does not tear characters', () => {
  it('never leaves an unpaired surrogate at the cut', () => {
    // 😀 is a surrogate pair, placed so the cap falls between its halves.
    const clamped = clampLineText(`${'a'.repeat(LOG_LINE_TEXT_CAP - 1)}\u{1F600}tail`)
    for (let i = 0; i < clamped.length; i += 1) {
      const c = clamped.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = clamped.charCodeAt(i + 1)
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true)
      }
      if (c >= 0xdc00 && c <= 0xdfff) {
        const prev = clamped.charCodeAt(i - 1)
        expect(prev >= 0xd800 && prev <= 0xdbff).toBe(true)
      }
    }
    expect(clamped).toContain('truncated')
  })
})
