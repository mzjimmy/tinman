import { SLOT_LABELS } from '../domain/types'
import type { AppStore } from '../hooks/useAppState'
import { FleetView } from './FleetView'
import { RobotView } from './RobotView'
import { RightPanel } from './RightPanel'
import { SettingsPanel } from './SettingsPanel'
import { FolderHintDialog, StubDialog, TaskView } from './TaskView'

function LeftBar({ store }: { store: AppStore }) {
  const collapsed = store.leftCollapsed
  const q = store.filter.trim().toLowerCase()
  const projects = store.projects.filter((p) => !q || p.name.toLowerCase().includes(q))
  return (
    <aside className={`left-bar${collapsed ? ' collapsed' : ''}`}>
      <div className="left-rail-head">
        {!collapsed && (
          <div className="group-title">
            Projects
            <span className="group-icons">
              <button
                type="button"
                className="icon-btn"
                title="过滤"
                aria-label="filter"
                onClick={() => document.getElementById('project-filter')?.focus()}
              >
                ⌕
              </button>
              <button
                type="button"
                className="icon-btn"
                title="添加本地文件夹"
                aria-label="add local folder"
                onClick={() => void store.addFolder()}
              >
                +
              </button>
            </span>
          </div>
        )}
        <button
          type="button"
          className="collapse-btn"
          onClick={() => store.setLeftCollapsed(!collapsed)}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="projects-group">
            <input
              id="project-filter"
              className="filter-input"
              placeholder="过滤项目"
              value={store.filter}
              onChange={(e) => store.setFilter(e.target.value)}
            />
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`project-item${p.id === store.selectedProjectId ? ' active' : ''}`}
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
            {projects.length === 0 && <p className="muted pad">添加本地文件夹开始扫描</p>}
          </div>
          <div className="account-card">
            <div className="account-id">
              <span>Tinman</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="settings"
                onClick={() => store.openSettings()}
              >
                ⚙
              </button>
            </div>
            <div className="account-actions">
              <button
                type="button"
                className="quiet-btn"
                onClick={() => store.openStub('Automations')}
              >
                Automations
              </button>
              <button
                type="button"
                className="quiet-btn"
                onClick={() => store.openStub('Customize')}
              >
                Customize
              </button>
              <button type="button" className="quiet-btn" onClick={() => store.openStub('Update')}>
                Update
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

function TopBar({ store }: { store: AppStore }) {
  const part = store.derived?.parts.find((p) => p.part.id === store.selectedPartId)
  return (
    <header className="top-bar">
      <div className="top-bar-row">
        <div className="top-left">
          <h1>{store.selectedProject?.name ?? 'Tinman'}</h1>
          <div className="view-switch">
            {(['robot', 'fleet', 'task'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={store.view === v ? 'on' : ''}
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
          {store.selectedProject && !store.selectedProject.mapConfirmed && (
            <button type="button" className="btn-sm" onClick={() => store.setMapOpen(true)}>
              架构地图
            </button>
          )}
          {store.selectedProject?.mapConfirmed && (
            <button type="button" className="btn-sm" onClick={() => void store.rescan()}>
              增量扫描
            </button>
          )}
        </div>
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
  const part = store.derived?.parts.find((p) => p.part.id === store.selectedPartId)
  const title = part
    ? `On ${part.part.slot} · ${SLOT_LABELS[part.part.slot].split(' · ')[1] ?? part.part.label}`
    : `On ${store.selectedProject?.name ?? 'Tinman'}`

  const actions = [
    ['changes', 'Changes'],
    ['browser', 'Browser'],
    ['terminal', 'Terminal'],
    ['files', 'Files'],
    ['facts', 'Facts'],
  ] as const

  return (
    <aside className="right-bar">
      <div className="right-bar-head">
        <h3>{title}</h3>
        <div className="right-panel-nav" data-testid="right-panel-nav">
          {actions.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={store.rightPanel === k ? 'on' : ''}
              onClick={() => store.setRight(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="right-panel-main">
        <RightPanel store={store} />
      </div>
    </aside>
  )
}

function Composer({ store }: { store: AppStore }) {
  return (
    <footer
      className="composer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const names = Array.from(e.dataTransfer.files)
          .filter((f) => f.type.startsWith('image/'))
          .map((f) => f.name)
        if (names.length) store.setAttachments([...store.attachments, ...names])
      }}
    >
      <button
        type="button"
        className="ctrl icon-btn attach"
        aria-label="attach"
        onClick={() => store.openStub('Attach')}
      >
        +
      </button>
      <div className="ctrl composer-field">
        <input
          value={store.composerDraft}
          onChange={(e) => store.setComposerDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void store.sendComposer()
            }
          }}
          placeholder="描述你想做的功能，或直接问哪块该先动"
          aria-label="composer"
        />
        {store.attachments.length > 0 && (
          <span className="attach-names">{store.attachments.join(', ')}</span>
        )}
      </div>
      {(store.llmProfiles ?? []).length === 0 ? (
        <div className="ctrl composer-llm">
          <span data-testid="llm-profile-empty">
            未配置模型
            <button type="button" className="quiet-btn" onClick={() => store.openSettings()}>
              配置模型
            </button>
          </span>
        </div>
      ) : (
        <select
          className="ctrl"
          value={store.llmProfile}
          onChange={(e) => store.setLlmProfile(e.target.value)}
          aria-label="llm profile"
        >
          {store.llmProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.model} ({p.id})
            </option>
          ))}
        </select>
      )}
      <button type="button" className="ctrl icon-btn" onClick={() => store.openStub('Voice')}>
        🎤
      </button>
      <button
        type="button"
        className="ctrl icon-btn"
        aria-label="send"
        disabled={!store.composerDraft.trim()}
        onClick={() => void store.sendComposer()}
      >
        ⏎
      </button>
      <select
        className="ctrl"
        value={store.dispatchTarget}
        onChange={(e) => store.setDispatchTarget(e.target.value)}
        aria-label="target"
      >
        <option value="this-pc">This PC</option>
        <option value="agent-cli">agent CLI</option>
        <option value="station">named station</option>
      </select>
    </footer>
  )
}

export function AppShell({ store }: { store: AppStore }) {
  return (
    <div className="app-shell">
      {store.scanning && store.scan && (
        <div className="scan-overlay" role="status">
          <div>
            <strong>只读扫描中</strong>
            <p>
              {store.scan.phase} · {store.scan.files_seen} 文件
            </p>
            <p className="muted">{store.scan.message}</p>
          </div>
        </div>
      )}
      {store.error && (
        <div className="error-banner">
          {store.error}
          <button type="button" className="btn-sm" onClick={store.clearError}>
            关闭
          </button>
        </div>
      )}
      <div className="workspace">
        <LeftBar store={store} />
        <main className="center">
          <TopBar store={store} />
          <div className="main-content">
            {store.view === 'robot' && <RobotView store={store} />}
            {store.view === 'fleet' && <FleetView store={store} />}
            {store.view === 'task' && <TaskView store={store} />}
          </div>
          <Composer store={store} />
        </main>
        <RightBar store={store} />
      </div>
      {store.stubDialog && <StubDialog label={store.stubDialog} onClose={store.closeStub} />}
      {store.folderHint && <FolderHintDialog onClose={store.closeFolderHint} />}
      {store.settingsOpen && (
        <SettingsPanel
          profiles={store.llmProfiles ?? []}
          stationCount={store.stationCount}
          theme={store.theme}
          onClose={store.closeSettings}
          onSaveProfile={store.saveLlmProfile}
          onSetStationCount={store.setStationCount}
          onToggleTheme={store.toggleTheme}
        />
      )}
    </div>
  )
}
