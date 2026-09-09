// Regression test for a runtime-only defect: Tauri v2 renames snake_case Rust
// command parameters to camelCase on the JS side unless the command opts out
// with `rename_all = "snake_case"`. `create_workspace(root_path)` was therefore
// unreachable from the UI — every suite stayed green because nothing crossed
// the IPC boundary in a test. This checks the boundary statically.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const rust = readFileSync(resolve(here, '../../src-tauri/src/commands.rs'), 'utf8')
const api = readFileSync(resolve(here, 'api.ts'), 'utf8')

const INJECTED = /^(state|app|app_handle|window|webview)$/

interface RustCommand {
  name: string
  params: string[]
  snakeCase: boolean
}

function rustCommands(): RustCommand[] {
  const out: RustCommand[] = []
  const re = /#\[tauri::command(\([^)]*\))?\]\s*pub (?:async )?fn (\w+)\s*\(([^)]*)\)/g
  for (const m of rust.matchAll(re)) {
    // Parameter names only: a rust param is `name: Type`, and Type may itself
    // contain commas (`State<AppState>`), so split on the name pattern instead.
    const params = [...m[3].matchAll(/(?:^|,)\s*(?:mut\s+)?(\w+)\s*:/g)]
      .map((x) => x[1])
      .filter((p) => !INJECTED.test(p))
    out.push({ name: m[2], params, snakeCase: (m[1] ?? '').includes('rename_all = "snake_case"') })
  }
  return out
}

function invokeArgs(command: string): string[] | null {
  // invoke<T>(...) where T may contain nested angle brackets, e.g.
  // invoke<Record<string, unknown>>('update_prefs', { id, patch })
  const re = new RegExp(`invoke<.*?>\\(\\s*'${command}'\\s*(?:,\\s*\\{([^}]*)\\})?\\s*\\)`)
  const m = api.match(re)
  if (!m) return null
  if (!m[1]) return []
  return m[1]
    .split(',')
    .map((a) => a.split(':')[0].trim())
    .filter(Boolean)
}

describe('tauri IPC contract', () => {
  const commands = rustCommands()

  it('finds the command surface', () => {
    expect(commands.length).toBeGreaterThan(8)
  })

  it.each(commands.map((c) => [c.name, c] as const))(
    '%s: js arg names match the rust signature',
    (_name, cmd) => {
      const sent = invokeArgs(cmd.name)
      expect(sent, `no invoke('${cmd.name}') found in api.ts`).not.toBeNull()

      // A multi-word rust param is only reachable from JS under its snake_case
      // name if the command opted out of tauri's camelCase renaming.
      const multiWord = cmd.params.filter((p) => p.includes('_'))
      if (multiWord.length > 0) {
        expect(
          cmd.snakeCase,
          `${cmd.name} takes ${multiWord.join(', ')}; it needs #[tauri::command(rename_all = "snake_case")] or the JS side must send camelCase`,
        ).toBe(true)
      }

      for (const p of cmd.params) {
        expect(sent, `${cmd.name} expects "${p}"`).toContain(p)
      }
      for (const s of sent!) {
        expect(cmd.params, `${cmd.name} was sent unknown arg "${s}"`).toContain(s)
      }
    },
  )
})
