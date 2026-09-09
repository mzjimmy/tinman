import type { GoalCard } from '../domain/types'

export interface AgentSpawnResult {
  pid: number
  worktreePath: string
}

export function spawnAgentCli(_goal: GoalCard): AgentSpawnResult {
  throw new Error('agent CLI not connected — would spawn worktree + local agent process')
}
