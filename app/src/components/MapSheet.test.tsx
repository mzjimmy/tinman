import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )
    expect(screen.getByDisplayValue('核心域预填')).toBeInTheDocument()
    expect(screen.getByDisplayValue('域模型')).toBeInTheDocument()
    expect(screen.getByDisplayValue('实体可序列化')).toBeInTheDocument()
  })
})
