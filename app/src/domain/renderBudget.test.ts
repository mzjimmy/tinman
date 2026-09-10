import { describe, expect, it } from 'vitest'
import { MAX_STATION_COUNT, clampStationCount } from './queue'
import { RENDER_BYTE_BUDGET, renderLogText } from './logBuffer'
import type { TaskOutputLine } from './types'

describe('terminal render budget', () => {
  it('joins at most a bounded number of bytes', () => {
    const lines: TaskOutputLine[] = Array.from({ length: 5000 }, (_, i) => ({
      task_id: 't',
      stream: 'stdout',
      text: 'y'.repeat(8 * 1024) + ` ${i}`,
    }))
    const text = renderLogText(lines)
    expect(text.length).toBeLessThanOrEqual(RENDER_BYTE_BUDGET + 512)
    // the newest output is what a terminal shows
    expect(text.endsWith('4999')).toBe(true)
  })

  it('leaves a short log intact', () => {
    const text = renderLogText([
      { task_id: 't', stream: 'stdout', text: 'a' },
      { task_id: 't', stream: 'stderr', text: 'b' },
    ])
    expect(text).toBe('stdout: a\nstderr: b')
  })

  it('says when it dropped output rather than silently showing a slice', () => {
    const lines: TaskOutputLine[] = Array.from({ length: 4000 }, () => ({
      task_id: 't',
      stream: 'stdout',
      text: 'z'.repeat(1024),
    }))
    expect(renderLogText(lines)).toContain('earlier output')
  })
})

describe('station count ceiling', () => {
  it('clamps a huge station count', () => {
    expect(clampStationCount(100000)).toBe(MAX_STATION_COUNT)
    expect(clampStationCount(4)).toBe(4)
    expect(clampStationCount(0)).toBe(1)
    expect(clampStationCount(Number.NaN)).toBe(1)
  })
})
