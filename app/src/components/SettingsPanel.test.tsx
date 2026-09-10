import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SettingsPanel } from './SettingsPanel'
import type { LlmProfile } from '../domain/types'

function props(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const onSaveProfile = vi.fn()
  const onSetStationCount = vi.fn()
  const onToggleTheme = vi.fn()
  const onClose = vi.fn()
  const base = {
    profiles: [] as LlmProfile[],
    stationCount: 2,
    theme: 'light',
    onClose,
    onSaveProfile,
    onSetStationCount,
    onToggleTheme,
  }
  return { ...base, ...overrides, onSaveProfile, onSetStationCount, onToggleTheme, onClose }
}

function selectKind(value: string) {
  fireEvent.change(screen.getByLabelText('profile kind'), { target: { value } })
}

function typeBaseUrl(value: string) {
  fireEvent.change(screen.getByLabelText('profile base url'), { target: { value } })
}

function typeModel(value: string) {
  fireEvent.change(screen.getByLabelText('profile model'), { target: { value } })
}

function typeId(value: string) {
  fireEvent.change(screen.getByLabelText('profile id'), { target: { value } })
}

function typeKeyRef(value: string) {
  fireEvent.change(screen.getByLabelText('profile key ref'), { target: { value } })
}

function typeKey(value: string) {
  fireEvent.change(screen.getByLabelText('profile key'), { target: { value } })
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: '保存模型' }))
}

describe('SettingsPanel (C2 deepseek)', () => {
  it('lists deepseek as a kind option in the select', () => {
    render(<SettingsPanel {...props()} />)
    const select = screen.getByLabelText('profile kind') as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual(expect.arrayContaining(['ollama', 'openai_compatible', 'deepseek']))
  })

  it('selecting deepseek prefills base URL and model with DeepSeek defaults', () => {
    render(<SettingsPanel {...props()} />)
    selectKind('deepseek')
    expect((screen.getByLabelText('profile base url') as HTMLInputElement).value).toBe(
      'https://api.deepseek.com',
    )
    expect((screen.getByLabelText('profile model') as HTMLInputElement).value).toBe(
      'deepseek-chat',
    )
  })

  it('switching from ollama to deepseek prefills because the ollama default is a preset value', () => {
    render(<SettingsPanel {...props()} />)
    // initial state: base URL is the ollama default
    expect((screen.getByLabelText('profile base url') as HTMLInputElement).value).toBe(
      'http://127.0.0.1:11434/v1',
    )
    selectKind('deepseek')
    expect((screen.getByLabelText('profile base url') as HTMLInputElement).value).toBe(
      'https://api.deepseek.com',
    )
    expect((screen.getByLabelText('profile model') as HTMLInputElement).value).toBe(
      'deepseek-chat',
    )
  })

  it('does not clobber a base URL the user has already typed by hand', () => {
    render(<SettingsPanel {...props()} />)
    typeBaseUrl('https://my-proxy.example.com/v1')
    typeModel('my-model')
    selectKind('deepseek')
    expect((screen.getByLabelText('profile base url') as HTMLInputElement).value).toBe(
      'https://my-proxy.example.com/v1',
    )
    expect((screen.getByLabelText('profile model') as HTMLInputElement).value).toBe('my-model')
  })

  it('submitting a deepseek profile saves kind "deepseek" and the prefilled defaults', () => {
    const p = props()
    render(<SettingsPanel {...p} />)
    typeId('deep')
    selectKind('deepseek')
    typeKeyRef('deep-key')
    typeKey('sk-secret')
    submitForm()
    expect(p.onSaveProfile).toHaveBeenCalledTimes(1)
    const [profile, secret] = p.onSaveProfile.mock.calls[0] as [LlmProfile, string | undefined]
    expect(profile).toEqual<LlmProfile>({
      id: 'deep',
      kind: 'deepseek',
      base_url: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      key_ref: 'deep-key',
    })
    expect(secret).toBe('sk-secret')
  })

  // R2 / C1: a user who fills "key" but leaves "key reference" blank must
  // still get the key stored. We default key_ref to the profile id so
  // useAppState.saveLlmProfile's `secret && profile.key_ref` check passes.
  it('c1_blank_key_ref_defaults_to_profile_id_when_secret_is_entered', () => {
    const p = props()
    render(<SettingsPanel {...p} />)
    typeId('deep')
    selectKind('deepseek')
    typeKey('sk-secret')
    // intentionally do NOT typeKeyRef — leave it blank
    submitForm()
    expect(p.onSaveProfile).toHaveBeenCalledTimes(1)
    const [profile, secret] = p.onSaveProfile.mock.calls[0] as [LlmProfile, string | undefined]
    expect(profile.id).toBe('deep')
    expect(profile.key_ref).toBe('deep')
    expect(secret).toBe('sk-secret')
  })

  it('c1_blank_key_ref_stays_null_when_no_secret_entered', () => {
    const p = props()
    render(<SettingsPanel {...p} />)
    typeId('local')
    typeModel('llama3.2')
    // kind stays 'ollama', no secret, no key ref
    submitForm()
    expect(p.onSaveProfile).toHaveBeenCalledTimes(1)
    const [profile, secret] = p.onSaveProfile.mock.calls[0] as [LlmProfile, string | undefined]
    expect(profile.id).toBe('local')
    expect(profile.key_ref).toBeNull()
    expect(secret).toBeUndefined()
  })
})
