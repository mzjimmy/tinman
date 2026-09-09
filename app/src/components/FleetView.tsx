import type { AppStore } from '../hooks/useAppState'
import {
  deriveProject,
  sortProjectsByName,
  sortProjectsByRecent,
  sortProjectsByShortLeg,
} from '../domain/shortLeg'
import { displayProgressForProject } from '../domain/progress'
import { RobotSvg } from './RobotSvg'
import { STATUS_LABELS } from '../domain/types'

export function FleetView({ store }: { store: AppStore }) {
  const list =
    store.fleetSort === 'name'
      ? sortProjectsByName(store.projects)
      : store.fleetSort === 'recent'
        ? sortProjectsByRecent(store.projects)
        : sortProjectsByShortLeg(store.projects)

  return (
    <div className="fleet-view">
      <div className="ranking-bar">
        <div className="ranking-head">
          <h3>最短腿排行 Top 5</h3>
          <div className="sort-switch">
            {(
              [
                ['shortleg', '按短腿'],
                ['name', '按名称'],
                ['recent', '按最近活动'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={store.fleetSort === k ? 'on' : ''}
                onClick={() => store.setFleetSort(k)}
              >
                {label}
              </button>
            ))}
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
            {store.ranking.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  确认架构地图后才会进入短腿排行
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="fleet-grid">
        {list.map((p) => {
          const d = deriveProject(p)
          const top = [...d.parts].sort((a, b) => b.shortLegScore - a.shortLegScore)[0]
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
                {p.mapConfirmed ? <span>{displayProgressForProject(p)}%</span> : <span />}
              </div>
              <RobotSvg
                uid={`fleet-${p.id}`}
                parts={d.parts}
                mapConfirmed={p.mapConfirmed}
                shortLegSlot={top?.shortLegScore ? top.part.slot : undefined}
                compact
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
