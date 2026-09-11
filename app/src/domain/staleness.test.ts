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
