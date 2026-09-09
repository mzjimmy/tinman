import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { deriveProject } from '../domain/shortLeg'
import { makePart, makeProject, makeWire } from '../domain/fixtures'
import { RobotSvg } from './RobotSvg'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

describe('unconfirmed map (C2)', () => {
  it('renders all-dark robot with notice and no progress figures', () => {
    const project = makeProject({
      mapConfirmed: false,
      parts: [
        makePart({
          slot: 'torso',
          label: '核心域',
          status: 'in_progress',
          wires: [makeWire({ met: 4, total: 5 })],
        }),
      ],
    })
    const derived = deriveProject(project)
    const { container } = render(
      <RobotSvg uid="test" parts={derived.parts} mapConfirmed={false} />,
    )
    expect(container.textContent).toContain('待确认架构地图')
    expect(container.textContent).not.toMatch(/\d+\s*%/)
    expect(container.innerHTML).not.toMatch(/进度/)
    expect(container.querySelectorAll('[data-status="unmapped"]').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-status="in_progress"]')).toBeNull()
    expect(container.querySelector('.fill')).toBeNull()
  })
})

describe('layout (C10)', () => {
  it('keeps svg aspect and collapses to two columns at 1024px', () => {
    const css = readFileSync(resolve(here, '../index.css'), 'utf8')
    expect(css).toMatch(/@media \(max-width: 1024px\)/)
    expect(css).toMatch(/grid-template-columns:\s*1fr 200px/)
    expect(css).toMatch(/\.left-bar \{\s*display: none/)
    const project = makeProject({ mapConfirmed: true, parts: [] })
    const { container } = render(
      <RobotSvg uid="layout" parts={deriveProject(project).parts} mapConfirmed compact />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 260')
  })
})
