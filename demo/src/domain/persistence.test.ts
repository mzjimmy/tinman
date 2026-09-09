import { describe, expect, it, beforeEach } from 'vitest'
import { createSeedState } from '../data/demoData'
import { deserializeState, resetState, serializeState, STORAGE_KEY } from '../domain/persistence'

describe('persistence (C11)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips state', () => {
    const seed = createSeedState()
    seed.theme = 'light'
    const raw = serializeState(seed)
    const loaded = deserializeState(raw)
    expect(loaded?.theme).toBe('light')
    expect(loaded?.projects.length).toBe(5)
  })

  it('reset returns seed and clears storage', () => {
    localStorage.setItem(STORAGE_KEY, '{"broken":true}')
    const seed = resetState()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(seed.projects.length).toBe(5)
  })
})
