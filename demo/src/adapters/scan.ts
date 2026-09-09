export interface ScanFacts {
  files: number
  languages: Record<string, number>
  todos: string[]
}

export function scanRepository(_root: string): ScanFacts {
  throw new Error('scanRepository not connected — replace with read-only repo scan producing facts.json')
}
