import type { Facts } from '../lib/api'

export type GapKind =
  | 'missing_counterpart'
  | 'no_tests'
  | 'tests_not_executed'
  | 'no_deploy'
  | 'open_marker'

export interface Gap {
  id: string
  kind: GapKind
  text: string
  evidence: string[]
}

const LOGIN_PAGE = /login|sign[-_]?in/i
const REGISTER_PAGE = /register|sign[-_]?up|signup/i
const LOGIN_API = /login|sign[-_]?in|session|\/auth\b/i
const REGISTER_API = /register|sign[-_]?up|signup/i
const DEPLOY_HINT = /deploy|release|publish|docker/i

export function statesProgress(text: string): boolean {
  if (/\d+\s*[%％]/.test(text)) return true
  if (/(?:进度|完成度)/.test(text) && /\d+\s*\/\s*\d+/.test(text)) return true
  if (/(?:进度|完成度)\s*[:=：]?\s*\d/.test(text)) return true
  if (/\bprogress\s*[:=]?\s*\d/i.test(text)) return true
  return false
}

export function gapSentence(gap: Gap): string {
  const cited = gap.evidence.join('；')
  return cited ? `${gap.text}（依据：${cited}）` : gap.text
}

function hasDeploySignal(facts: Facts): boolean {
  const { npm_scripts, makefile_targets, dockerfile, readme_commands } = facts.entry_points
  if (dockerfile) return true
  const names = [
    ...Object.keys(npm_scripts),
    ...Object.values(npm_scripts),
    ...makefile_targets,
    ...readme_commands,
  ]
  return names.some((s) => DEPLOY_HINT.test(s))
}

export function detectGaps(facts: Facts): Gap[] {
  const gaps: Gap[] = []

  const loginPages = facts.pages.filter((p) => LOGIN_PAGE.test(p))
  const registerPages = facts.pages.filter((p) => REGISTER_PAGE.test(p))
  const loginSurfaces = [
    ...loginPages,
    ...facts.routes.filter((r) => LOGIN_PAGE.test(r)),
  ]
  const hasLoginApi = facts.api_endpoints.some((e) => LOGIN_API.test(e))
  const hasRegisterApi = facts.api_endpoints.some((e) => REGISTER_API.test(e))

  if (loginSurfaces.length > 0 && !hasLoginApi) {
    gaps.push({
      id: 'missing_counterpart:login-api',
      kind: 'missing_counterpart',
      text: '有登录页文件，但没有登录接口',
      evidence: [...loginSurfaces, ...facts.api_endpoints],
    })
  }
  if ((loginPages.length > 0 || registerPages.length > 0) && !hasRegisterApi) {
    const fromLogin = loginPages.length > 0
    const pages = fromLogin ? loginPages : registerPages
    gaps.push({
      id: 'missing_counterpart:register-api',
      kind: 'missing_counterpart',
      text: fromLogin ? '有登录页文件，但没有注册接口' : '有注册页文件，但没有注册接口',
      evidence: [...pages, ...facts.api_endpoints],
    })
  }

  if (facts.tests.files.length === 0) {
    gaps.push({
      id: 'no_tests',
      kind: 'no_tests',
      text: '仓库里没有测试文件',
      evidence: [facts.tests.note || '扫描未发现测试文件'],
    })
  } else if (facts.tests.pass == null && facts.tests.fail == null) {
    gaps.push({
      id: 'tests_not_executed',
      kind: 'tests_not_executed',
      text: '有测试文件，但这次扫描没有执行它们',
      evidence: facts.tests.files.slice(),
    })
  }

  if (!hasDeploySignal(facts)) {
    const evidence: string[] = []
    if (!facts.entry_points.dockerfile) evidence.push('未发现 Dockerfile')
    if (!Object.keys(facts.entry_points.npm_scripts).some((k) => DEPLOY_HINT.test(k))) {
      evidence.push('npm scripts 中没有 deploy/release/publish')
    }
    if (!facts.entry_points.makefile_targets.some((t) => DEPLOY_HINT.test(t))) {
      evidence.push('Makefile 中没有发布目标')
    }
    if (!facts.entry_points.readme_commands.some((c) => DEPLOY_HINT.test(c))) {
      evidence.push('README 命令中没有发布步骤')
    }
    gaps.push({
      id: 'no_deploy',
      kind: 'no_deploy',
      text: '仓库里看不到发布或部署入口',
      evidence,
    })
  }

  if (facts.markers.length > 0) {
    gaps.push({
      id: 'open_marker',
      kind: 'open_marker',
      text: '仓库里还有未处理的待办标记',
      evidence: facts.markers.map((m) => `${m.path}:${m.line} ${m.kind}`),
    })
  }

  return gaps
}
