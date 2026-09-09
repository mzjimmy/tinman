import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { deriveProject } from '../domain/shortLeg'
import { makePart, makeProject, makeWire } from '../domain/fixtures'
import type { FrameworkAdvice, LlmUnavailableReason } from '../domain/types'
import { PartPanel } from './PartPanel'
import { draftGoal, factsFromPart, plannedWorktreePath } from '../domain/dispatch'

const advice: FrameworkAdvice = {
  diagnosis: 'left_leg is short because src/db.rs has no passing CI listed in facts.',
  next_step: 'Add the validation gate before any provider call.',
  entry_point: 'app/src-tauri/src/llm.rs',
  shared_risk: 'db.rs schema; llm_call rows must not share the wire table.',
  done_criteria: [
    'Unknown purpose never reaches the transport',
    'Rejected output is logged with a reason',
    'No-key returns unavailable',
  ],
}

function derivedPart(withWires: boolean) {
  const project = makeProject({
    mapConfirmed: true,
    parts: [
      makePart({
        id: 'part-leg',
        slot: 'left_leg',
        label: '基础设施',
        status: 'in_progress',
        wires: withWires ? [makeWire({ id: 'w-1', label: 'CI', met: 1, total: 5 })] : [],
      }),
    ],
  })
  return deriveProject(project).parts[0]!
}

describe('PartPanel LLM advice', () => {
  it('renders all five advice fields when available', () => {
    const part = derivedPart(true)
    const { container } = render(
      <PartPanel part={part} advice={{ status: 'available', advice }} />,
    )
    const llm = container.querySelector('[data-testid="llm-advice"]')
    expect(llm?.textContent).toContain(advice.diagnosis)
    expect(llm?.textContent).toContain(advice.next_step)
    expect(llm?.textContent).toContain(advice.entry_point)
    expect(llm?.textContent).toContain(advice.shared_risk)
    for (const item of advice.done_criteria) {
      expect(llm?.textContent).toContain(item)
    }
    expect(screen.getByText('diagnosis')).toBeInTheDocument()
    expect(screen.getByText('next_step')).toBeInTheDocument()
    expect(screen.getByText('entry_point')).toBeInTheDocument()
    expect(screen.getByText('shared_risk')).toBeInTheDocument()
  })

  it.each(['no_key', 'no_profile', 'offline', 'rejected'] as LlmUnavailableReason[])(
    'renders hand-fill and no percentage when unavailable (%s)',
    (reason) => {
      const part = derivedPart(false)
      const { container } = render(
        <PartPanel part={part} advice={{ status: 'unavailable', reason }} />,
      )
      expect(container.textContent).toContain('事实 + 手填验收项')
      expect(container.textContent).not.toMatch(/%/)
      const llm = container.querySelector('[data-testid="llm-advice"]')
      expect(llm?.textContent).not.toMatch(/%/)
      expect(llm?.textContent).not.toMatch(/round 2 · llm\.call 未接入/)
    },
  )

  it('contains no % character in the LLM section while advice is unavailable', () => {
    const part = derivedPart(false)
    const { container } = render(
      <PartPanel part={part} advice={{ status: 'unavailable', reason: 'no_key' }} />,
    )
    expect(container.textContent).not.toMatch(/%/)
    expect(container.querySelector('[data-testid="llm-advice"]')?.textContent).not.toContain('%')
  })

  it('enables 生成任务 for a wire and produces a card', () => {
    const part = derivedPart(true)
    const onGenerateGoal = vi.fn()
    const { rerender } = render(
      <PartPanel part={part} onGenerateGoal={onGenerateGoal} />,
    )
    const btn = screen.getByRole('button', { name: '生成任务' })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(onGenerateGoal).toHaveBeenCalledWith('w-1')

    const project = makeProject({
      mapConfirmed: true,
      parts: [part.part],
    })
    const goal = draftGoal({
      taskId: 't_ui',
      project,
      partId: part.part.id,
      wireId: 'w-1',
      userIntentVerbatim: ['make ci green'],
      attachments: [],
      facts: factsFromPart(project, part.part.id),
      advice: null,
      worktreePath: plannedWorktreePath('t_ui'),
    })
    rerender(
      <PartPanel
        part={part}
        onGenerateGoal={onGenerateGoal}
        goalDraft={goal}
        onConfirmDispatch={vi.fn()}
        onCancelGoal={vi.fn()}
      />,
    )
    expect(screen.getByTestId('goal-card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认派发' })).toBeEnabled()
  })

  it('after a verified task the wire shows evidence and fill matches the met ratio', () => {
    const project = makeProject({
      mapConfirmed: true,
      parts: [
        makePart({
          id: 'part-leg',
          slot: 'left_leg',
          label: '基础设施',
          status: 'in_progress',
          wires: [
            makeWire({
              id: 'w-1',
              label: 'CI',
              met: 2,
              total: 5,
              status: 'in_progress',
            }),
          ],
        }),
      ],
    })
    const part = deriveProject(project).parts[0]!
    const wire = part.part.wires[0]!
    expect(wire.criteria.filter((c) => c.met)).toHaveLength(2)
    wire.criteria[0]!.evidence = 'git:README.md'
    wire.criteria[1]!.evidence = 'git:src/app.rs'
    const { container } = render(<PartPanel part={part} />)
    expect(container.textContent).toContain('git:README.md')
    expect(container.textContent).toContain('git:src/app.rs')
    expect(container.textContent).toContain('40%')
    expect(container.textContent).not.toContain('99%')
  })

  it('accepting a proposed criterion calls the criteria write path', () => {
    const part = derivedPart(true)
    const onAddCriterion = vi.fn()
    render(
      <PartPanel
        part={part}
        advice={{ status: 'available', advice }}
        onAddCriterion={onAddCriterion}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: '接受' })[0]!)
    expect(onAddCriterion).toHaveBeenCalledWith('w-1', advice.done_criteria[0])
  })
})
