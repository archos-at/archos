import { describe, expect, it } from 'vitest'
import type { ProposedChangeView } from '@/lib/proposals/types'
import { AGENT_KIND } from '@/lib/agent-kind'
import { cardOfProposal } from './proposal-cards'

const TITLES = { files: (count: number) => `${count} files`, memory: 'Remember' }

const operation = (name: string): ProposedChangeView => ({
  id: '00000000-0000-4000-8000-0000000000a1',
  kind: 'operation',
  projectId: 'proj-1',
  status: 'proposed',
  proposedByKind: AGENT_KIND,
  onBehalfOf: 'user_me',
  onBehalfOfName: 'Mia Huber',
  originConversationId: null,
  originMessageId: null,
  createdAt: '2026-11-24T08:00:00.000Z',
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  results: null,
  canDecide: true,
  payload: { operation: name, input: { params: { id: 'f-1' } }, summary: 'Do it' },
  targets: [],
})

describe('cardOfProposal', () => {
  it('draws an operation as the generic receipt', () => {
    expect(cardOfProposal(operation('folder-rename'), TITLES).kind).toBe('card')
  })

  it('leaves a calibration to the workspace, where its page clip can be drawn: never the generic receipt', () => {
    expect(cardOfProposal(operation('drawing-calibration-set'), TITLES)).toEqual({
      kind: 'not-drawn',
    })
  })
})
