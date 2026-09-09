/* DEMO DATA — replace with repo scan + SQLite + llm.call. Do not treat as live. */

import type { AppState, FrameworkAdvice, Part, Project, Slot, Station } from '../domain/types'

function wire(
  id: string,
  label: string,
  met: number,
  total: number,
  status: Part['status'] extends infer S ? S : never,
  lastCommitDays = 5,
) {
  const criteria = Array.from({ length: total }, (_, i) => ({
    text: `${label} 验收项 ${i + 1}`,
    met: i < met,
    evidence: i < met ? `demo/evidence/${id}-${i + 1}.log` : '',
  }))
  return {
    id,
    label,
    criteria,
    status: status === 'blocked' ? 'blocked' : status === 'done' ? 'done' : status === 'in_progress' ? 'in_progress' : 'pending',
    lastCommitDays,
    updatedAt: '2026-08-12',
  } as const
}

function part(
  id: string,
  slot: Slot,
  label: string,
  weight: number,
  wires: ReturnType<typeof wire>[],
  status: Part['status'],
  extras: Partial<Part> = {},
): Part {
  return {
    id,
    slot,
    label,
    weight,
    status,
    wires: [...wires],
    facts: {
      files: [`src/${slot}/`, `tests/${slot}.test.ts`],
      tests: '12 passed · 2 skipped',
      lastCommit: '2026-08-12',
      todoCount: slot === 'left_leg' ? 4 : 1,
    },
    advice: getDemoAdviceStatic(slot, label),
    ...extras,
  }
}

function getDemoAdviceStatic(slot: Slot, label: string): FrameworkAdvice {
  return {
    diagnosis: `${label} 进度偏低：tests/${slot}.test.ts 有失败用例，最近提交 2026-08-12`,
    next_step: `先补 ${label} 最小闭环，只跑单测`,
    entry_point: `src/${slot}/`,
    shared_risk: '与 torso 核心域共用类型定义，由本任务确定',
    done_criteria: ['单测全绿', 'README 可复现步骤', '无新增 TODO'],
  }
}

const demoProjects: Project[] = [
  {
    id: 'p-demo',
    name: '示例项目',
    root: '/Users/demo/sample',
    mapConfirmed: true,
    recentTasks: [
      { label: 'CI 流水线修复', ago: '7m' },
      { label: '部署脚本', ago: '21h' },
    ],
    parts: [
      part('p1-ll', 'left_leg', '基础设施', 3, [wire('w1', 'CI 流水线', 1, 5, 'blocked', 45)], 'blocked'),
      part('p1-rl', 'right_leg', '部署流水线', 2, [wire('w2', '发布脚本', 0, 4, 'pending')], 'pending'),
      part('p1-t', 'torso', '核心服务', 3, [wire('w3', '域服务', 7, 10, 'in_progress')], 'in_progress'),
      part('p1-ra', 'right_arm', '移动客户端', 1, [wire('w4', 'SDK 绑定', 2, 4, 'in_progress')], 'in_progress'),
      part('p1-la', 'left_arm', 'Web 前端', 2, [wire('w5', '页面路由', 2, 4, 'in_progress')], 'in_progress'),
      part('p1-h', 'head', '算法引擎', 2, [wire('w6', '推理服务', 3, 3, 'done')], 'done'),
      { id: 'p1-bp', slot: 'backpack', label: '观测插件', weight: 1, status: 'unmapped', wires: [] },
    ],
  },
  {
    id: 'p-data',
    name: '数据平台重构',
    root: '/Users/demo/data-platform',
    mapConfirmed: true,
    recentTasks: [{ label: '查询网关压测', ago: '1d' }],
    parts: [
      part('p2-ll', 'left_leg', '存储层', 3, [wire('w7', '对象存储', 4, 4, 'done')], 'done'),
      part('p2-rl', 'right_leg', '运维体系', 2, [wire('w8', '告警', 3, 3, 'done')], 'done'),
      part('p2-t', 'torso', '数据管道', 3, [wire('w9', 'ETL', 5, 5, 'done')], 'done'),
      part('p2-ra', 'right_arm', '查询网关', 2, [wire('w10', 'SQL 网关', 4, 4, 'done')], 'done'),
      part('p2-la', 'left_arm', '分析 SDK', 1, [wire('w11', '客户端 SDK', 2, 2, 'done')], 'done'),
      part('p2-h', 'head', '元数据服务', 2, [wire('w12', 'Catalog', 3, 3, 'done')], 'done'),
      { id: 'p2-bp', slot: 'backpack', label: '实验特性', weight: 1, status: 'unmapped', wires: [] },
    ],
  },
  {
    id: 'p-edge',
    name: '边缘计算网关',
    root: '/Users/demo/edge-gw',
    mapConfirmed: true,
    recentTasks: [{ label: '沙箱策略', ago: '3h' }],
    parts: [
      part('p3-ll', 'left_leg', '硬件适配', 2, [wire('w13', '驱动层', 2, 6, 'in_progress')], 'in_progress'),
      part('p3-ra', 'right_arm', '安全沙箱', 2, [wire('w14', '隔离策略', 0, 5, 'blocked', 40)], 'blocked'),
      part('p3-t', 'torso', '运行时', 3, [wire('w15', 'Worker', 3, 10, 'in_progress')], 'in_progress'),
      part('p3-la', 'left_arm', 'OTA 升级', 1, [wire('w16', '差分包', 3, 5, 'in_progress')], 'in_progress'),
      part('p3-h', 'head', '协议解析', 2, [wire('w17', 'Protobuf', 4, 4, 'done')], 'done'),
      { id: 'p3-rl', slot: 'right_leg', label: '边缘发布', weight: 2, status: 'unmapped', wires: [] },
      { id: 'p3-bp', slot: 'backpack', label: '遥测', weight: 1, status: 'unmapped', wires: [] },
    ],
  },
  {
    id: 'p-sdk',
    name: '客户端 SDK',
    root: '/Users/demo/client-sdk',
    mapConfirmed: false,
    recentTasks: [{ label: '架构地图待确认', ago: '2d' }],
    parts: [
      part('p4-t', 'torso', '核心包', 3, [wire('w18', 'Public API', 4, 5, 'in_progress')], 'in_progress'),
      part('p4-la', 'left_arm', '语言绑定', 1, [wire('w19', 'Node 绑定', 1, 5, 'pending')], 'pending'),
      part('p4-ra', 'right_arm', '文档站', 1, [wire('w20', '文档生成', 0, 4, 'pending')], 'pending'),
      { id: 'p4-h', slot: 'head', label: '决策层', weight: 2, status: 'unmapped', wires: [] },
      { id: 'p4-ll', slot: 'left_leg', label: 'CI', weight: 2, status: 'unmapped', wires: [] },
      { id: 'p4-rl', slot: 'right_leg', label: '发布', weight: 2, status: 'unmapped', wires: [] },
      { id: 'p4-bp', slot: 'backpack', label: '插件', weight: 1, status: 'unmapped', wires: [] },
    ],
  },
  {
    id: 'p-obs',
    name: '观测平台',
    root: '/Users/demo/observability',
    mapConfirmed: true,
    recentTasks: [{ label: 'Trace 采样', ago: '5h' }],
    parts: [
      part('p5-bp', 'backpack', '插件市场', 2, [wire('w21', '插件加载', 1, 4, 'in_progress', 35)], 'in_progress'),
      part('p5-t', 'torso', '采集器', 3, [wire('w22', 'OTLP 接入', 2, 5, 'in_progress')], 'in_progress'),
      part('p5-h', 'head', '告警规则', 2, [wire('w23', '规则引擎', 2, 4, 'in_progress')], 'in_progress'),
      part('p5-la', 'left_arm', 'Dashboard', 2, [wire('w24', '面板', 3, 6, 'in_progress')], 'in_progress'),
      part('p5-ra', 'right_arm', '导出 API', 1, [wire('w25', 'REST', 1, 3, 'pending', 45)], 'pending', {
        plannedStart: '2026-12-01',
      }),
      part('p5-ll', 'left_leg', '存储后端', 2, [wire('w26', 'TSDB', 4, 6, 'in_progress')], 'in_progress'),
      part('p5-rl', 'right_leg', '部署', 1, [wire('w27', 'Helm', 2, 4, 'in_progress')], 'in_progress'),
    ],
  },
]

export const demoStations: Station[] = [
  { id: 'st-1', label: '工位 1' },
  { id: 'st-2', label: '工位 2' },
]

export function getDemoProjects(): Project[] {
  return structuredClone(demoProjects)
}

export function getDemoAdvice(projectId: string, slot: Slot): FrameworkAdvice | undefined {
  const project = demoProjects.find((p) => p.id === projectId)
  const part = project?.parts.find((p) => p.slot === slot)
  return part?.advice
}

export function createSeedState(): AppState {
  const projects = getDemoProjects()
  return {
    theme: 'dark',
    view: 'fleet',
    selectedProjectId: projects[0]!.id,
    selectedPartId: undefined,
    selectedWireId: undefined,
    projects,
    stations: structuredClone(demoStations),
    tasks: [],
    queue: [],
    goalDraft: undefined,
    rightPanel: undefined,
    leftCollapsed: false,
    fleetSort: 'shortleg',
    showGoalCard: false,
    stubDialog: undefined,
    composerDraft: '',
    llmProfile: 'extra-high',
    dispatchTarget: 'this-pc',
  }
}

export const WORKSPACE_NAME = 'Tinman Demo Workspace'
