import { render, screen } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import { resetDecidedProposals } from '@/features/cards/decided-proposals'

const storeFixture = vi.hoisted(() => ({ projectId: null as string | null }))

vi.mock('../store', () => ({
  useChatStore: vi.fn((selector?: StoreSelector<ChatStoreWithHydration>) => {
    const state: DeepPartial<ChatStoreWithHydration> = {
      currentConversation: null,
      projectId: storeFixture.projectId,
      patchConversationMessage: vi.fn(),
    }
    return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
  }),
}))

vi.mock('@/adapters/api', () => ({
  cancelJob: vi.fn(),
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({
    accessToken: null,
  }),
}))

vi.mock('@/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

describe('AgentResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeFixture.projectId = null
    resetDecidedProposals()
  })

  describe('answer copy actions', () => {
    const citations = [
      {
        id: 'copy-c1',
        content: '',
        timestamp: new Date('2026-08-18T09:00:00Z'),
        title: 'OIB-Richtlinie 2',
        fileName: 'oib-rl_2.pdf',
        collection: 'oib_knowledge',
        kind: 'building_law' as const,
        origin: 'kb' as const,
        page: 18,
        number: 1,
        isCited: true,
      },
    ]

    test('a completed answer offers a copy button', () => {
      render(<AgentResponse content="Die Antwort." />)

      expect(screen.getByRole('button', { name: 'Copy answer' })).toBeInTheDocument()
    })

    test('the citations-resolved action appears only when the answer has sources', () => {
      const { rerender } = render(<AgentResponse content="Die Antwort." />)
      expect(screen.queryByRole('button', { name: /source references/i })).not.toBeInTheDocument()

      rerender(<AgentResponse content="Die Antwort [1]." citations={citations} />)
      expect(screen.getByRole('button', { name: /source references/i })).toBeInTheDocument()
    })

    test('an answer that is still arriving cannot be copied', () => {
      render(<AgentResponse content="Die Antwort" isStreaming />)

      expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument()
    })

    test('the inline variant carries no copy actions', () => {
      render(<AgentResponse content="Die Antwort." variant="inline" citations={citations} />)

      expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument()
    })
  })
})
