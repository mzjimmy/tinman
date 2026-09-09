import { getDemoAdvice } from '../data/demoData'
import type { AppState, GoalCard, Project, Task } from './types'
import { completeTaskCriteria } from './progress'

let taskCounter = 142

export function draftGoal(
  project: Project,
  partId: string,
  wireId: string,
  userIntent?: string[],
): GoalCard {
  const part = project.parts.find((p) => p.id === partId)
  const wire = part?.wires.find((w) => w.id === wireId)
  const advice = part ? getDemoAdvice(project.id, part.slot) : undefined
  const taskId = `t_${String(taskCounter++).padStart(4, '0')}`

  return {
    task_id: taskId,
    project: { name: project.name, root: project.root },
    target: {
      slot: part?.slot ?? 'left_leg',
      part: part?.label ?? '未知部位',
      wire: wire?.label ?? '未知线路',
    },
    user_intent_verbatim:
      userIntent && userIntent.length > 0
        ? userIntent
        : ['提交后自动跑测试，失败要告诉我哪一条'],
    attachments: ['/refs/ci-screenshot.png'],
    facts: {
      test_runner: 'vitest',
      ci_config: null,
      last_commit: part?.facts?.lastCommit ?? '2026-08-12',
    },
    framework_advice: {
      next_step: advice?.next_step ?? '先补最小 CI 配置，只跑单测',
      entry_point: advice?.entry_point ?? '.github/workflows/',
      shared_risk: advice?.shared_risk ?? '与 right_leg 部署脚本共用 node 版本，由本任务确定',
    },
    done_criteria: advice?.done_criteria ?? [
      '推送后自动触发测试',
      '失败时输出失败用例名',
      '本地一条命令可复现',
    ],
    assumptions: [
      'ASSUMED: 只跑单测不跑 e2e — 因为仓库无 e2e 用例。反转方式：追加 e2e 任务',
    ],
    workspace: {
      worktree_path: `/tmp/tinman/${taskId}`,
      branch: `tinman/${taskId}`,
    },
    delivery_format: '变更说明 + 自测结果 + 未完成项',
    authorization: { allow_push: false, allow_deploy: false, allow_spend: false },
  }
}

export function confirmDispatch(state: AppState, goal: GoalCard): AppState {
  const task: Task = {
    id: goal.task_id,
    projectId: state.selectedProjectId,
    partId: state.selectedPartId ?? '',
    wireId: state.selectedWireId ?? '',
    goal,
    state: 'running',
  }

  const stations = [...state.stations]
  const freeIdx = stations.findIndex((s) => !s.taskId)
  if (freeIdx >= 0) {
    stations[freeIdx] = { ...stations[freeIdx]!, taskId: task.id }
    task.stationId = stations[freeIdx]!.id
    task.state = 'running'
  } else {
    task.state = 'queued'
  }

  return {
    ...state,
    stations,
    tasks: [...state.tasks, task],
    queue: task.state === 'queued' ? [...state.queue, task.id] : state.queue,
    goalDraft: undefined,
    showGoalCard: false,
    view: 'task',
  }
}

export function simulateRankingSelect(
  state: AppState,
  projectId: string,
  partId: string,
): AppState {
  return {
    ...state,
    selectedProjectId: projectId,
    selectedPartId: partId,
    selectedWireId: undefined,
    view: 'robot',
    showGoalCard: false,
    goalDraft: undefined,
  }
}

export function simulateGenerateGoal(state: AppState, project: Project): AppState {
  const partId = state.selectedPartId ?? project.parts[0]?.id ?? ''
  const part = project.parts.find((p) => p.id === partId)
  const wireId = state.selectedWireId ?? part?.wires[0]?.id ?? ''
  const typed = state.composerDraft?.trim()
  const goal = draftGoal(project, partId, wireId, typed ? [typed] : undefined)
  return {
    ...state,
    goalDraft: goal,
    showGoalCard: true,
    selectedWireId: wireId,
  }
}

export function completeDemoTask(state: AppState, taskId: string): AppState {
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task) return state

  const projects = state.projects.map((p) =>
    p.id === task.projectId ? completeTaskCriteria(p, task.wireId) : p,
  )

  const tasks = state.tasks.map((t) =>
    t.id === taskId ? { ...t, state: 'done' as const } : t,
  )

  const stations = state.stations.map((s) =>
    s.taskId === taskId ? { ...s, taskId: undefined } : s,
  )

  let queue = [...state.queue]
  const nextId = queue.shift()
  if (nextId) {
    const nextTask = tasks.find((t) => t.id === nextId)
    const free = stations.find((s) => !s.taskId)
    if (nextTask && free) {
      free.taskId = nextId
      const idx = tasks.findIndex((t) => t.id === nextId)
      tasks[idx] = { ...tasks[idx]!, state: 'running', stationId: free.id }
    }
  }

  return { ...state, projects, tasks, stations, queue }
}

export function resetTaskCounter(n = 142): void {
  taskCounter = n
}
