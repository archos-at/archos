import { render, screen } from '@/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardInteractions } from '../card-decision'
import { FileOperationProposalCard } from './FileOperationProposalCard'

let mockCardInteractions: CardInteractions | undefined
const setCardDecision = vi.fn()

const mockStoreState = () => ({
  projectId: 'proj-1',
  currentConversation: {
    id: 'conv-1',
    messages: [{ id: 'msg-1', cardInteractions: mockCardInteractions }],
  },
  conversations: [],
  setCardDecision,
})

vi.mock('@/features/chat/store', () => {
  const useChatStore = (selector: (s: ReturnType<typeof mockStoreState>) => unknown) =>
    selector(mockStoreState())
  useChatStore.getState = () => mockStoreState()
  return { useChatStore }
})

const fetchMock = vi.fn()

const moveCard = {
  title: 'Move two files',
  operation: 'move' as const,
  operations: [
    {
      document: 'Grundriss EG.pdf',
      source: 'project' as const,
      current: 'Nachweise',
      target_folder: 'Einreichung/Pläne',
    },
    {
      document: 'Grundriss OG.pdf',
      source: 'project' as const,
      current: '',
      target_folder: 'Einreichung/Pläne',
    },
  ],
}

beforeEach(() => {
  mockCardInteractions = undefined
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FileOperationProposalCard without a proposal_id — what it shows', () => {
  it('renders every proposed operation', () => {
    render(<FileOperationProposalCard {...moveCard} cardKey="file_operation_proposal-0" />)

    expect(screen.getByText('Grundriss EG.pdf')).toBeInTheDocument()
    expect(screen.getByText('Grundriss OG.pdf')).toBeInTheDocument()
    expect(screen.getByText(/Nachweise/)).toBeInTheDocument()
    expect(screen.getByText(/Top level/)).toBeInTheDocument()
  })

  it('shows the reason under the row it belongs to', () => {
    const card = {
      ...moveCard,
      operations: [{ ...moveCard.operations[0], reason: 'Belongs with the Bescheid of 12 March' }],
    }
    render(<FileOperationProposalCard {...card} cardKey="file_operation_proposal-0" />)

    expect(screen.getByTestId('file-operation-row-reason')).toHaveTextContent('Belongs with the Bescheid of 12 March')
  })

  it.each([
    ['rename', { document: 'a.pdf', source: 'project' as const, new_display_name: 'Grundriss Erdgeschoss' }, 'Grundriss Erdgeschoss'],
    ['create_folder', { folder_name: 'Fotos', parent_folder: 'Einreichung' }, 'Fotos'],
    ['assign', { document: 'a.pdf', source: 'project' as const, member: 'Anna Berger' }, 'Anna Berger'],
  ])('renders the %s operation in its own words', (operation, item, expected) => {
    render(
      <FileOperationProposalCard
        title="Proposal"
        operation={operation as 'rename'}
        operations={[item]}
        cardKey="file_operation_proposal-0"
      />,
    )
    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})

describe('FileOperationProposalCard without a proposal_id — read-only', () => {
  it('offers nothing, says it could not be created as a proposal, and calls no route', () => {
    render(<FileOperationProposalCard {...moveCard} messageId="msg-1" cardKey="file_operation_proposal-0" />)

    expect(screen.getByTestId('file-operation-unavailable')).toHaveTextContent('Could not be created as a proposal')
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(setCardDecision).not.toHaveBeenCalled()
  })
})

describe('FileOperationProposalCard without a proposal_id — a decision recorded before server proposals', () => {
  it('shows an accepted card after a reload, without re-offering the write', () => {
    mockCardInteractions = {
      'file_operation_proposal-0': { decision: 'accepted', decidedAt: '2026-09-10T09:00:00Z' },
    }
    render(<FileOperationProposalCard {...moveCard} messageId="msg-1" cardKey="file_operation_proposal-0" />)

    expect(screen.getByText('2 files moved.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('says only what it still knows after a reload of a partial accept', () => {
    mockCardInteractions = {
      'file_operation_proposal-0': { decision: 'partiallyApplied', decidedAt: '2026-09-10T09:00:00Z' },
    }
    render(<FileOperationProposalCard {...moveCard} messageId="msg-1" cardKey="file_operation_proposal-0" />)

    expect(screen.getByText(/Applied in part/)).toBeInTheDocument()
  })

  it('shows a discarded card as discarded', () => {
    mockCardInteractions = {
      'file_operation_proposal-0': { decision: 'rejected', decidedAt: '2026-09-10T09:00:00Z' },
    }
    render(<FileOperationProposalCard {...moveCard} messageId="msg-1" cardKey="file_operation_proposal-0" />)

    expect(screen.getByText('Discarded. Nothing was changed.')).toBeInTheDocument()
  })
})
