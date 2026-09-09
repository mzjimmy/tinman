import type { AppStore } from '../hooks/useAppState'
import { deriveProject, sortProjectsByShortLeg } from '../domain/shortLeg'
import { displayProgressForProject } from '../domain/progress'
import { RobotSvg } from './RobotSvg'
import { STATUS_LABELS } from '../domain/types'

export function FleetView({ store }: { store: AppStore }) {
  const projects =
    store.state.fleetSort === 'shortleg'
      ? sortProjectsByShortLeg(store.state.projects)
      : [...store.state.projects].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="fleet-view">
      <div className="ranking-bar">
        <div className="ranking-head">
          <h3>最短腿排行 Top 5</h3>
          <div className="sort-switch">
            <button
              type="button"
              className={store.state.fleetSort === 'shortleg' ? 'on' : ''}
              onClick={() => store.patch({ fleetSort: 'shortleg' })}
            >
              按短腿
            </button>
            <button
              type="button"
              className={store.state.fleetSort === 'name' ? 'on' : ''}
              onClick={() => store.patch({ fleetSort: 'name' })}
            >
              按名称
            </button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>项目</th>
              <th>部位</th>
              <th>进度</th>
              <th>状态</th>
              <th>分数</th>
            </tr>
          </thead>
          <tbody>
            {store.ranking.map((r) => (
              <tr
                key={`${r.projectId}-${r.partId}`}
                className="ranking-row"
                tabIndex={0}
                onClick={() => store.openRanking(r.projectId, r.partId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    store.openRanking(r.projectId, r.partId)
                  }
                }}
              >
                <td>{r.projectName}</td>
                <td>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      store.openRanking(r.projectId, r.partId)
                    }}
                  >
                    {r.partLabel}
                  </button>
                </td>
                <td>{r.progress}%</td>
                <td>
                  {STATUS_LABELS[r.status]}
                  {r.lagging ? ' · 落后于其他部位' : ''}
                </td>
                <td>{r.score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="fleet-grid">
        {projects.map((p) => {
          const d = deriveProject(p)
          return (
            <div
              key={p.id}
              className={`fleet-card${d.hasBlocked ? ' blocked-card' : ''}`}
              onClick={() => {
                store.selectProject(p.id)
                store.setView('robot')
              }}
            >
              <div className="fleet-card-head">
                <strong>{p.name}</strong>
                <span>{displayProgressForProject(p)}%</span>
              </div>
              <RobotSvg
                uid={`fleet-${p.id}`}
                parts={d.parts}
                mapConfirmed={p.mapConfirmed}
                shortLegSlot={deriveProject(p).parts.sort((a, b) => b.shortLegScore - a.shortLegScore)[0]?.part.slot}
                compact
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
