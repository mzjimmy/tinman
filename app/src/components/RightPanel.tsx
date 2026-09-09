import type { AppStore } from '../hooks/useAppState'
import type { FileNode } from '../lib/api'

function FileTree({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  if (node.kind === 'file') {
    return (
      <div className="file-row" style={{ paddingLeft: 8 + depth * 12 }}>
        {node.name}
      </div>
    )
  }
  return (
    <details open={depth < 1}>
      <summary style={{ paddingLeft: depth * 12 }}>{node.name}/</summary>
      {(node.children ?? []).map((c) => (
        <FileTree key={c.path} node={c} depth={depth + 1} />
      ))}
    </details>
  )
}

export function RightPanel({ store }: { store: AppStore }) {
  const facts = store.facts
  if (store.rightPanel === 'facts') {
    if (!facts) return <pre className="panel-body muted">尚无扫描结果</pre>
    const loc = Object.entries(facts.loc_by_language)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    return (
      <pre className="panel-body">
        {`root: ${facts.root}
files: ${facts.file_count}
duration: ${facts.duration_ms} ms
branch: ${facts.git.branch ?? '—'}
last commit: ${facts.git.last_commit_at ?? '—'}
uncommitted: ${facts.git.uncommitted}
TODO/FIXME/HACK: ${facts.markers.length}

LOC
${loc || '(none)'}

deps
${facts.dependencies.map((d) => `${d.kind}  ${d.path}`).join('\n') || '(none)'}

tests: ${facts.tests.files.length} files (not executed)
`}
      </pre>
    )
  }
  if (store.rightPanel === 'files') {
    if (!store.files) return <pre className="panel-body muted">加载文件树…</pre>
    return (
      <div className="panel-body file-tree">
        <FileTree node={store.files} />
      </div>
    )
  }
  if (store.rightPanel === 'changes') {
    if (!store.changes) return <pre className="panel-body muted">加载 git status…</pre>
    return (
      <pre className="panel-body">
        {store.changes.status}
        {'\n'}
        {store.changes.diff}
      </pre>
    )
  }
  if (store.rightPanel === 'terminal') {
    return (
      <pre className="panel-body muted">
        round 2 占位 — 真正的 PTY 与 agent CLI 派发会接在这里。这一栏不会被藏起来。
      </pre>
    )
  }
  return (
    <pre className="panel-body muted">
      round 2 占位 — 预览浏览器未接入。用 Changes / Files / Facts 接管手工操作。
    </pre>
  )
}
