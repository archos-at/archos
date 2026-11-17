import { fireEvent, render, screen } from '@/test-utils'
import { chatCopy } from '@/i18n/namespaces/chat'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'

vi.mock('../store', () => ({
  useChatStore: vi.fn((selector?: StoreSelector<ChatStoreWithHydration>) => {
    const state: DeepPartial<ChatStoreWithHydration> = {
      currentConversation: null,
      patchConversationMessage: vi.fn(),
    }
    return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
  }),
}))

vi.mock('@/adapters/api', () => ({ cancelJob: vi.fn() }))
vi.mock('@/adapters/auth', () => ({ useAuth: () => ({ accessToken: null }) }))
const listInvocableSkills = vi.fn()
vi.mock('@/adapters/api/skills-client', () => ({
  listInvocableSkills: (...args: unknown[]) => listInvocableSkills(...args),
}))

vi.mock('@/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

beforeEach(() => {
  listInvocableSkills.mockReset()
  listInvocableSkills.mockResolvedValue([
    { name: 'oib-brandschutz', description: 'Prüft Brandschutz nach OIB-RL 2.', origin: 'org' },
  ])
})

const copy = {
  truncated: chatCopy.messages.en.answerSources.researchTruncated,
  truncatedEmpty: chatCopy.messages.en.answerSources.researchTruncatedWithoutSources,
}

const CITED = 'Die Antwort [1].\n\n## Quellen\n[1] OIB-Richtlinie 3 — https://example.org/oib3'

describe.each(['default', 'inline'] as const)('the %s answer variant', (variant) => {
  test('a turn that was cut off says so, under the sources', async () => {
    render(<AgentResponse content={CITED} variant={variant} researchTruncated />)
    expect(screen.getByTestId('answer-details-attention')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('answer-details-trigger'))

    const note = screen.getByText(copy.truncated)
    expect(note).toBeInTheDocument()
    expect(note).toHaveAttribute('role', 'note')
  })

  test('a turn that found nothing gets the sentence that is true of it', async () => {
    render(
      <AgentResponse content="Dazu habe ich nichts gefunden." variant={variant} researchTruncated />
    )
    expect(screen.getByTestId('answer-details-attention')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('answer-details-trigger'))

    expect(screen.getByText(copy.truncatedEmpty)).toBeInTheDocument()
    expect(screen.queryByText(copy.truncated)).not.toBeInTheDocument()
  })

  test('a turn that finished its research says nothing at all', () => {
    render(<AgentResponse content={CITED} variant={variant} />)

    expect(screen.queryByText(copy.truncated)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.truncatedEmpty)).not.toBeInTheDocument()
  })
})

describe('both locales carry a real sentence', () => {
  test.each([['researchTruncated'], ['researchTruncatedWithoutSources']] as const)(
    '%s is written twice, not translated once',
    (key) => {
      expect(chatCopy.messages.de.answerSources[key]).not.toBe(chatCopy.messages.en.answerSources[key])
      for (const text of [chatCopy.messages.de.answerSources[key], chatCopy.messages.en.answerSources[key]]) {
        expect(text.trim().length).toBeGreaterThan(20)
        expect(text).not.toContain('{')
      }
    }
  )

  test('the two German sentences are not the same sentence', () => {
    expect(chatCopy.messages.de.answerSources.researchTruncated).not.toBe(
      chatCopy.messages.de.answerSources.researchTruncatedWithoutSources
    )
  })
})
