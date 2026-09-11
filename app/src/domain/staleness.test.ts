/**
 * Round 6 — 驻守重扫刷新短腿, for real.
 *
 * The short-leg score is weight × u × b. `u` comes from met criteria and only
 * evidence may move it. `b` comes from `isStalled`, which reads lastCommitDays,
 * which is derived from SCAN FACTS. So a rescan legitimately moves the ranking
 * without touching a single criterion — that is the honest channel, and these
 * tests pin it down.
 *
 * Two defects this closes:
 *   - staleness is repo-wide today: every part of a repo gets the same
 *     lastCommitDays, so a module nobody has touched in a year looks exactly as
 *     fresh as the one being worked on this morning.
 *   - the patrol refreshes facts but never rebuilds the ranking inputs from them.
 */
import { describe, expect, it } from 'vitest'
import { makeFacts } from './fixtures'
import { partStalenessDays } from './staleness'

const NOW = Date.parse('2026-09-11T00:00:00Z')

describe('partStalenessDays (R6): staleness is per part, not per repo', () => {
  it('reports the repo recency for a part whose code is in the 30-day window', () => {
    const facts = makeFacts({
      git: {
        branch: 'main',
        last_commit_at: '2026-09-10T00:00:00Z',
        last_commit_subject: 'x',
        uncommitted: false,
        top_files_30d: [{ path: 'api/routes.ts', commits: 9 }],
      },
    })
    expect(partStalenessDays(facts, ['api/'], NOW)).toBe(1)
  })

  it('reports a part as untouched when none of its files moved in the window', () => {
    const facts = makeFacts({
      git: {
        branch: 'main',
        last_commit_at: '2026-09-10T00:00:00Z',
        last_commit_subject: 'x',
        uncommitted: false,
        top_files_30d: [{ path: 'api/routes.ts', commits: 9 }],
      },
    })
    // 'infra/' is mapped but absent from the 30-day window: nobody has touched it.
    expect(partStalenessDays(facts, ['infra/'], NOW)).toBeGreaterThan(30)
  })

  it('a busy repo does not make an abandoned module look fresh', () => {
    const facts = makeFacts({
      git: {
        branch: 'main',
        last_commit_at: '2026-09-11T00:00:00Z',
        last_commit_subject: 'busy',
        uncommitted: false,
        top_files_30d: [{ path: 'src/core/a.ts', commits: 40 }],
      },
    })
    expect(partStalenessDays(facts, ['src/'], NOW)).toBeLessThanOrEqual(30)
    expect(partStalenessDays(facts, ['legacy/'], NOW)).toBeGreaterThan(30)
  })

  it('falls back to repo recency when the part has no mapped modules', () => {
    const facts = makeFacts({
      git: {
        branch: 'main',
        last_commit_at: '2026-08-01T00:00:00Z',
        last_commit_subject: 'old',
        uncommitted: false,
        top_files_30d: [],
      },
    })
    expect(partStalenessDays(facts, [], NOW)).toBe(41)
  })

  it('is undefined when the repo has no commit date at all', () => {
    const facts = makeFacts({
      git: {
        branch: null,
        last_commit_at: null,
        last_commit_subject: null,
        uncommitted: false,
        top_files_30d: [],
      },
    })
    expect(partStalenessDays(facts, ['src/'], NOW)).toBeUndefined()
  })

  it('matches a file nested deep under a mapped module', () => {
    const facts = makeFacts({
      git: {
        branch: 'main',
        last_commit_at: '2026-09-10T00:00:00Z',
        last_commit_subject: 'x',
        uncommitted: false,
        top_files_30d: [{ path: 'src/domain/deep/nested/file.ts', commits: 3 }],
      },
    })
    expect(partStalenessDays(facts, ['src/'], NOW)).toBe(1)
  })
})

describe('partStalenessDays (R7): the top-10 file cap must not make this inert', () => {
  // scanner.rs truncates top_files_30d to 10. ANY active repo saturates that, so
  // round 6's honest abstention silently degraded per-part staleness back to
  // repo-wide recency for exactly the users it was built for. dirs_30d is the
  // uncapped per-directory aggregate that fixes it.
  const tenHotFiles = Array.from({ length: 10 }, (_, i) => ({
    path: `hot/f${i}.ts`,
    commits: 20 - i,
  }))

  function saturated(dirs?: { dir: string; touches: number }[]): ReturnType<typeof makeFacts> {
    return makeFacts({
      git: {
        branch: 'main',
        last_commit_at: '2026-09-10T00:00:00Z',
        last_commit_subject: 'busy',
        uncommitted: false,
        top_files_30d: tenHotFiles,
        ...(dirs ? { dirs_30d: dirs } : {}),
      } as ReturnType<typeof makeFacts>['git'],
    })
  }

  it('still calls an untouched module stale even when the file list is saturated', () => {
    const facts = saturated([{ dir: 'hot/', touches: 120 }])
    expect(partStalenessDays(facts, ['infra/'], NOW)).toBeGreaterThan(30)
  })

  it('does not call a module stale when the directory aggregate shows activity', () => {
    const facts = saturated([
      { dir: 'hot/', touches: 120 },
      { dir: 'infra/', touches: 2 },
    ])
    expect(partStalenessDays(facts, ['infra/'], NOW)).toBe(1)
  })

  it('keeps the cautious fallback when the aggregate is missing (older cached facts)', () => {
    // No dirs_30d at all: we cannot tell, so we must not invent a short leg.
    expect(partStalenessDays(saturated(), ['infra/'], NOW)).toBe(1)
  })

  it('trusts the aggregate over an unsaturated file list too', () => {
    const facts = makeFacts({
      git: {
        branch: 'main',
        last_commit_at: '2026-09-10T00:00:00Z',
        last_commit_subject: 'x',
        uncommitted: false,
        top_files_30d: [{ path: 'hot/a.ts', commits: 3 }],
        dirs_30d: [
          { dir: 'hot/', touches: 3 },
          { dir: 'infra/', touches: 1 },
        ],
      } as ReturnType<typeof makeFacts>['git'],
    })
    expect(partStalenessDays(facts, ['infra/'], NOW)).toBe(1)
    expect(partStalenessDays(facts, ['legacy/'], NOW)).toBeGreaterThan(30)
  })
})

describe('partStalenessDays (R8): siblings under a shared parent must separate', () => {
  // The monorepo shape: every slot lives under packages/. With only a
  // first-segment aggregate, one commit anywhere keeps every sibling looking
  // alive — the top-10 cap failure on a different axis.
  const facts = makeFacts({
    git: {
      branch: 'main',
      last_commit_at: '2026-09-10T00:00:00Z',
      last_commit_subject: 'api work',
      uncommitted: false,
      top_files_30d: [{ path: 'packages/api/a.ts', commits: 4 }],
      dirs_30d: [
        { dir: 'packages/', touches: 4 },
        { dir: 'packages/api/', touches: 4 },
      ],
    } as ReturnType<typeof makeFacts>['git'],
  })

  it('keeps the worked-on child fresh', () => {
    expect(partStalenessDays(facts, ['packages/api/'], NOW)).toBe(1)
  })

  it('calls the untouched sibling stale instead of borrowing its parent activity', () => {
    expect(partStalenessDays(facts, ['packages/web/'], NOW)).toBeGreaterThan(30)
  })

  it('a part mapped to the shared parent itself is still fresh', () => {
    expect(partStalenessDays(facts, ['packages/'], NOW)).toBe(1)
  })
})
