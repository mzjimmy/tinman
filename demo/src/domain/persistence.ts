import { createSeedState } from '../data/demoData'
import type { AppState } from './types'
import { STORAGE_KEY } from './types'

export { STORAGE_KEY }

export function serializeState(state: AppState): string {
  return JSON.stringify(state)
}

export function deserializeState(raw: string): AppState | null {
  try {
    const parsed = JSON.parse(raw) as AppState
    if (!parsed.projects || !parsed.stations) return null
    return parsed
  } catch {
    return null
  }
}

export function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return createSeedState()
  return deserializeState(raw) ?? createSeedState()
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, serializeState(state))
}

export function resetState(): AppState {
  localStorage.removeItem(STORAGE_KEY)
  return createSeedState()
}
