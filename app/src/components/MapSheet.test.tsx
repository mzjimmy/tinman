import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MapSheet } from './MapSheet'
import { emptyProposal, type ArchitectureProposal } from '../domain/proposal'

describe('MapSheet proposal shape (round 2 ready)', () => {
  it('fills from a proposal object without restructuring', () => {
    const proposal: ArchitectureProposal = emptyProposal()
    proposal.parts[1] = {
      ...proposal.parts[1]!,
      slot: 'torso',
      present: true,
      label: '核心域预填',
      weight: 3,
      modulePaths: ['src/'],
      wires: [
        {
          label: '域模型',
          criteria: [
            { text: '实体可序列化', met: false, evidence: '' },
            { text: '迁移可回放', met: false, evidence: '' },
            { text: '无直接进度写入', met: false, evidence: '' },
          ],
        },
      ],
    }
    render(
      <MapSheet
        proposal={proposal}
        modules={['src/', 'demo/']}
        defaultName="fixture"
        source="heuristic"
        gaps={['还没有测试文件，没法从测试看出哪些功能已经稳了']}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )
    expect(screen.getByDisplayValue('核心域预填')).toBeInTheDocument()
    expect(screen.getByDisplayValue('域模型')).toBeInTheDocument()
    expect(screen.getByDisplayValue('实体可序列化')).toBeInTheDocument()
    expect(screen.getByText('还没有测试文件，没法从测试看出哪些功能已经稳了')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认这份草稿' })).toBeInTheDocument()
    expect(screen.getByText(/根据仓库自动起草/)).toBeInTheDocument()
  })

  it('keeps met flags when confirming a drift review of an already-mapped project', () => {
    const proposal: ArchitectureProposal = emptyProposal()
    proposal.parts[1] = {
      ...proposal.parts[1]!,
      slot: 'torso',
      present: true,
      label: '核心域',
      modulePaths: ['src/'],
      wires: [
        {
          label: '域模型',
          criteria: [
            { text: '实体可序列化', met: true, evidence: 'src/entity.ts' },
            { text: '迁移可回放', met: false, evidence: '' },
            { text: '无直接进度写入', met: false, evidence: '' },
          ],
        },
      ],
    }
    const onConfirm = vi.fn()
    render(
      <MapSheet
        proposal={proposal}
        modules={['src/']}
        defaultName="fixture"
        source="heuristic"
        preserveProgress
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '确认这份草稿' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const sent = onConfirm.mock.calls[0]![0] as ArchitectureProposal
    const torso = sent.parts.find((p) => p.slot === 'torso')
    expect(torso?.wires[0]?.criteria[0]).toMatchObject({
      text: '实体可序列化',
      met: true,
      evidence: 'src/entity.ts',
    })
  })
})
