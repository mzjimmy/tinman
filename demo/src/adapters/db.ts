export interface DbClient {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
}

export function openDatabase(_path: string): DbClient {
  throw new Error('SQLite not connected — replace with local SQLite schema migration')
}
