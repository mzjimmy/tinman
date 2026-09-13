import { describe, expect, it } from 'vitest'
import { makeFacts } from './fixtures'
import { detectGaps, gapSentence, statesProgress } from './gaps'

describe('gaps (R4-C3): scan facts translated into 人话缺口, never into a percentage', () => {
  it('names a missing counterpart: a login page with no auth endpoint', () => {
    const gaps = detectGaps(
      makeFacts({
        pages: ['src/pages/Login.tsx'],
        api_endpoints: ['GET /health'],
      }),
    )
    const hit = gaps.find((g) => g.kind === 'missing_counterpart')
    expect(hit).toBeDefined()
    expect(hit!.evidence.join(' ')).toContain('src/pages/Login.tsx')
  })

  it('stays quiet when the counterpart is actually there', () => {
    const gaps = detectGaps(
      makeFacts({
        pages: ['src/pages/Login.tsx'],
        api_endpoints: ['POST /login', 'POST /register'],
      }),
    )
    expect(gaps.some((g) => g.kind === 'missing_counterpart')).toBe(false)
  })

  it('flags a repo with no test files at all', () => {
    const gaps = detectGaps(makeFacts({ tests: { files: [], pass: null, fail: null, note: 'not executed' } }))
    expect(gaps.some((g) => g.kind === 'no_tests')).toBe(true)
  })

  it('does not claim tests pass merely because test files exist', () => {
    const gaps = detectGaps(
      makeFacts({
        tests: { files: ['src/a.test.ts'], pass: null, fail: null, note: 'not executed' },
      }),
    )
    expect(gaps.some((g) => g.kind === 'no_tests')).toBe(false)
    const unexecuted = gaps.find((g) => g.kind === 'tests_not_executed')
    expect(unexecuted).toBeDefined()
  })

  it('flags a repo with nothing that looks like deployment', () => {
    const gaps = detectGaps(
      makeFacts({
        entry_points: { npm_scripts: {}, makefile_targets: [], dockerfile: false, readme_commands: [] },
      }),
    )
    expect(gaps.some((g) => g.kind === 'no_deploy')).toBe(true)
  })

  it('every gap cites at least one concrete piece of scan evidence', () => {
    const gaps = detectGaps(
      makeFacts({
        pages: ['src/pages/Login.tsx'],
        api_endpoints: ['GET /health'],
        markers: [{ kind: 'TODO', path: 'src/auth.ts', line: 12 }],
      }),
    )
    expect(gaps.length).toBeGreaterThan(0)
    for (const g of gaps) {
      expect(g.evidence.length).toBeGreaterThan(0)
      expect(g.text.trim()).not.toBe('')
    }
  })

  it('INVARIANT: no gap ever states a progress number', () => {
    const gaps = detectGaps(
      makeFacts({
        pages: ['src/pages/Login.tsx', 'src/pages/Home.tsx'],
        api_endpoints: ['GET /health'],
        routes: ['/app', '/login'],
        markers: [{ kind: 'FIXME', path: 'src/x.ts', line: 3 }],
      }),
    )
    for (const g of gaps) {
      expect(statesProgress(g.text)).toBe(false)
      expect(statesProgress(gapSentence(g))).toBe(false)
    }
  })

  it('statesProgress catches the shapes the product refuses to print', () => {
    expect(statesProgress('完成 60%')).toBe(true)
    expect(statesProgress('progress: 60')).toBe(true)
    expect(statesProgress('进度 3/5')).toBe(true)
    expect(statesProgress('有登录页文件，但没有注册接口')).toBe(false)
  })

  it('is deterministic — the same facts give the same gaps in the same order', () => {
    const facts = makeFacts({ pages: ['src/pages/Login.tsx'], api_endpoints: ['GET /health'] })
    expect(detectGaps(facts).map((g) => g.id)).toEqual(detectGaps(facts).map((g) => g.id))
  })
})

describe('gaps (R4 round 2): the sentence must match the evidence behind it', () => {
  it('does not call a registration page a login page', () => {
    const gaps = detectGaps(
      makeFacts({ pages: ['src/pages/Register.tsx'], api_endpoints: ['GET /health'] }),
    )
    const hit = gaps.find((g) => g.kind === 'missing_counterpart')
    expect(hit).toBeDefined()
    expect(hit!.evidence.join(' ')).toContain('src/pages/Register.tsx')
    expect(hit!.text).not.toContain('登录页')
  })
})
