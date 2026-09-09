import { useState, type FormEvent } from 'react'
import type { LlmProfile } from '../domain/types'

export interface SettingsPanelProps {
  profiles: LlmProfile[]
  stationCount: number
  theme: string
  onClose: () => void
  onSaveProfile: (profile: LlmProfile, secret?: string) => void
  onSetStationCount: (n: number) => void
  onToggleTheme: () => void
}

export function SettingsPanel({
  profiles,
  stationCount,
  theme,
  onClose,
  onSaveProfile,
  onSetStationCount,
  onToggleTheme,
}: SettingsPanelProps) {
  const [id, setId] = useState('')
  const [kind, setKind] = useState<LlmProfile['kind']>('ollama')
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434/v1')
  const [model, setModel] = useState('')
  const [keyRef, setKeyRef] = useState('')
  const [secret, setSecret] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = id.trim()
    if (!trimmed || !model.trim() || !baseUrl.trim()) return
    const profile: LlmProfile = {
      id: trimmed,
      kind,
      base_url: baseUrl.trim(),
      model: model.trim(),
      key_ref: keyRef.trim() || null,
    }
    onSaveProfile(profile, secret.trim() ? secret : undefined)
    setSecret('')
  }

  return (
    <div className="settings-overlay" role="dialog" data-testid="settings-panel">
      <div className="settings-panel">
        <h3>设置</h3>
        <section>
          <h4>工位数</h4>
          <label>
            工位数
            <input
              type="number"
              min={1}
              aria-label="设置工位数"
              value={stationCount}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 1) onSetStationCount(n)
              }}
            />
          </label>
          <p className="muted">默认 2。写入应用偏好，重启后仍在。</p>
        </section>
        <section>
          <h4>模型配置</h4>
          {profiles.length === 0 ? (
            <p className="muted">尚未配置模型。添加一个 profile 后，输入条的选择器才会列出它。</p>
          ) : (
            <ul data-testid="settings-profiles">
              {profiles.map((p) => (
                <li key={p.id}>
                  {p.id} · {p.kind} · {p.model} · {p.base_url}
                  {p.key_ref ? ` · key_ref ${p.key_ref}` : ''}
                </li>
              ))}
            </ul>
          )}
          <form className="profile-form" onSubmit={submit}>
            <label>
              id
              <input value={id} onChange={(e) => setId(e.target.value)} aria-label="profile id" />
            </label>
            <label>
              kind
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as LlmProfile['kind'])}
                aria-label="profile kind"
              >
                <option value="ollama">ollama</option>
                <option value="openai_compatible">openai_compatible</option>
              </select>
            </label>
            <label>
              base URL
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                aria-label="profile base url"
              />
            </label>
            <label>
              model
              <input value={model} onChange={(e) => setModel(e.target.value)} aria-label="profile model" />
            </label>
            <label>
              key reference
              <input
                value={keyRef}
                onChange={(e) => setKeyRef(e.target.value)}
                aria-label="profile key ref"
              />
            </label>
            <label>
              key
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                aria-label="profile key"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="btn primary">
              保存模型
            </button>
          </form>
        </section>
        <section>
          <h4>外观</h4>
          <button type="button" className="btn-sm" onClick={onToggleTheme}>
            主题：{theme}
          </button>
        </section>
        <button type="button" className="btn" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
