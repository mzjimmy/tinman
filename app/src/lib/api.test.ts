// Tests for the deepseek entry in `profilesFromPrefs` and the `LlmProfile.kind`
// union. This is the TS seam counterpart to the Rust
// `llm::profiles_from_prefs` parser. The serde wire value of a deepseek
// profile is the exact string `"deepseek"` end-to-end.
import { describe, expect, it } from 'vitest'
import { profilesFromPrefs } from './api'
import type { LlmProfile } from '../domain/types'

describe('profilesFromPrefs', () => {
  it('accepts a deepseek profile and keeps the wire value as the kind', () => {
    const out = profilesFromPrefs({
      llm_profiles: [
        {
          id: 'deep',
          kind: 'deepseek',
          base_url: 'https://api.deepseek.com',
          model: 'deepseek-chat',
          key_ref: 'deep-key',
        },
      ],
    })
    expect(out).toEqual<LlmProfile[]>([
      {
        id: 'deep',
        kind: 'deepseek',
        base_url: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        key_ref: 'deep-key',
      },
    ])
  })

  it('drops entries with an unknown kind while keeping deepseek alongside openai_compatible', () => {
    const out = profilesFromPrefs({
      llm_profiles: [
        { id: 'a', kind: 'openai_compatible', base_url: 'https://x', model: 'm' },
        { id: 'b', kind: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-chat' },
        { id: 'c', kind: 'mystery', base_url: 'https://y', model: 'm' },
      ],
    })
    expect(out.map((p) => p.id)).toEqual(['a', 'b'])
    expect(out[1]?.kind).toBe('deepseek')
  })

  it('normalises a missing key_ref on a deepseek profile to null', () => {
    const out = profilesFromPrefs({
      llm_profiles: [
        {
          id: 'deep',
          kind: 'deepseek',
          base_url: 'https://api.deepseek.com',
          model: 'deepseek-chat',
        },
      ],
    })
    expect(out[0]?.key_ref).toBeNull()
  })
})
