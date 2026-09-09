import type { AppStore } from '../hooks/useAppState'
import { WORKSPACE_NAME } from '../data/demoData'
import { SLOT_LABELS } from '../domain/types'
import { FleetView } from './FleetView'
import { RobotView } from './RobotView'
import { DemoPanel, StubDialog, TaskView } from './TaskView'

function MenuBar({ store }: { store: AppStore }) {
  return (
    <div className="menubar">
      {(['File', 'Edit', 'View'] as const).map((item) => (
        <button key={item} type="button" className="menu-item" onClick={() => store.openStub(item)}>
          {item}
        </button>
      ))}
      <button type="button" className="menu-item" onClick={store.resetDemo}>
        Help · Reset Demo
      </button>
      <span className="window-title">{WORKSPACE_NAME}</span>
    </div>
  )
}

function LeftBar({ store }: { store: AppStore }) {
  const collapsed = store.state.leftCollapsed
  return (
    <aside className={`left-bar${collapsed ? ' collapsed' : ''}`}>
      <button type="button" className="collapse-btn" onClick={() => store.patch({ leftCollapsed: !collapsed })}>
        {collapsed ? '›' : '‹'}
      </button>
      {!collapsed && (
        <>
          <div className="left-actions">
            {['New Project', 'Search', 'Automations', 'Customize'].map((a) => (
              <button key={a} type="button" className="btn-sm" onClick={() => store.openStub(a)}>
                {a}
              </button>
            ))}
          </div>
          <div className="projects-group">
            <div className="group-title">Projects</div>
            {store.state.projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`project-item${p.id === store.state.selectedProjectId ? ' active' : ''}`}
                onClick={() => {
                  store.selectProject(p.id)
                  store.setView('robot')
                }}
              >
                <div>{p.name}</div>
                {p.recentTasks.map((t) => (
                  <div key={t.label} className="recent-task">
                    {t.label} <span>{t.ago}</span>
                  </div>
                ))}
              </button>
            ))}
          </div>
          <div className="account-card">
            <div>Tinman Demo</div>
            <button type="button" className="btn primary" onClick={() => store.openStub('Update')}>
              Update
            </button>
            <button type="button" className="btn-sm" aria-label="settings" onClick={() => store.openStub('Settings')}>
              ⚙
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

function TopBar({ store }: { store: AppStore }) {
  const part = store.derived.parts.find((p) => p.part.id === store.state.selectedPartId)
  return (
    <header className="top-bar">
      <div className="top-left">
        <h1>{store.selectedProject.name}</h1>
        <div className="view-switch">
          {(['robot', 'fleet', 'task'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={store.state.view === v ? 'on' : ''}
              onClick={() => store.setView(v)}
            >
              {v === 'robot' ? 'Robot' : v === 'fleet' ? 'Fleet' : 'Task'}
            </button>
          ))}
        </div>
      </div>
      <div className="top-right">
        <button type="button" className="btn-sm" onClick={() => store.openStub('IDE')}>
          IDE ↗
        </button>
        <button type="button" className="btn-sm" onClick={() => store.openStub('More')}>
          ⋯
        </button>
        <button type="button" className="btn-sm" onClick={store.toggleTheme}>
          {store.state.theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
      {part && (
        <div className="context-line">
          On {part.part.slot} · {part.part.label}
        </div>
      )}
    </header>
  )
}

function RightBar({ store }: { store: AppStore }) {
  const part = store.derived.parts.find((p) => p.part.id === store.state.selectedPartId)
  const title = part
    ? `On ${part.part.slot} · ${part.part.label}`
    : `On ${store.selectedProject.name}`

  const actions = [
    ['changes', 'Changes'],
    ['browser', 'Browser'],
    ['terminal', 'Terminal'],
    ['files', 'Files'],
    ['facts', 'Facts'],
  ] as const

  return (
    <aside className="right-bar">
      <h3>{title}</h3>
      {actions.map(([k, label]) => (
        <button
          key={k}
          type="button"
          className={store.state.rightPanel === k ? 'on' : ''}
          onClick={() => store.patch({ rightPanel: k })}
        >
          {label}
        </button>
      ))}
      {store.state.rightPanel && <DemoPanel kind={store.state.rightPanel} />}
    </aside>
  )
}

function Composer({ store }: { store: AppStore }) {
  return (
    <footer className="composer">
      <button type="button" className="attach" aria-label="attach" onClick={() => store.openStub('Attach')}>
        +
      </button>
      <input
        value={store.state.composerDraft ?? ''}
        onChange={(e) => store.patch({ composerDraft: e.target.value })}
        placeholder="描述你想做的功能，或直接问哪块该先动"
        aria-label="composer"
      />
      <select
        value={store.state.llmProfile ?? 'extra-high'}
        onChange={(e) => store.patch({ llmProfile: e.target.value })}
        aria-label="llm profile"
      >
        <option value="extra-high">Extra High Fast (Demo)</option>
        <option value="local">Local stub (Demo)</option>
      </select>
      <button type="button" className="btn-sm" onClick={() => store.openStub('Voice')}>
        🎤
      </button>
      <select
        value={store.state.dispatchTarget ?? 'this-pc'}
        onChange={(e) => store.patch({ dispatchTarget: e.target.value })}
        aria-label="target"
      >
        <option value="this-pc">This PC</option>
        <option value="demo-cli">Demo agent CLI</option>
        <option value="station">station</option>
      </select>
    </footer>
  )
}

export function AppShell({ store }: { store: AppStore }) {
  return (
    <div className={`app-shell theme-${store.state.theme}`} data-theme={store.state.theme}>
      <MenuBar store={store} />
      <div className="workspace">
        <LeftBar store={store} />
        <main className="center">
          <TopBar store={store} />
          <div className="main-content">
            {store.state.view === 'robot' && <RobotView store={store} />}
            {store.state.view === 'fleet' && <FleetView store={store} />}
            {store.state.view === 'task' && <TaskView store={store} />}
          </div>
          <Composer store={store} />
        </main>
        <RightBar store={store} />
      </div>
      {store.state.stubDialog && (
        <StubDialog label={store.state.stubDialog} onClose={() => store.patch({ stubDialog: undefined })} />
      )}
    </div>
  )
}

export { SLOT_LABELS }
