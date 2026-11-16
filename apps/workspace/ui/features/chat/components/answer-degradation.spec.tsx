import { fireEvent, render, screen } from '@/test-utils'
import { chatCopy } from '@/i18n/namespaces/chat'

const en = { chat: chatCopy.messages.en }
const de = { chat: chatCopy.messages.de }
import { createTranslator } from '@/i18n/translate'
import { vi, describe, test, expect } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { normalizeAgentAnswerMetadata } from '@/lib/conversations/agent-answer-metadata'
import {
  ANSWER_DEGRADED_REASONS,
  type MessageProvenance,
} from '@/lib/conversations/message-provenance'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'

vi.mock('../hooks/use-conversation-memory', () => ({
  useConversationMemory: () => ({ items: [], loading: false }),
}))

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
vi.mock('@/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

const t = createTranslator(en, 'chat')
const copy = {
  truncated: en.chat.answerSources.researchTruncated,
  wallClock: en.chat.answerSources.truncationReason.wall_clock,
  stepLimit: en.chat.answerSources.truncationReason.step_limit,
  noReport: en.chat.answerSources.degradedReason.no_report_file,
  noCitations: en.chat.answerSources.degradedReason.no_valid_citations,
  removedUrl: en.chat.answerSources.citationsRemovedReason.url_not_in_registry,
}

const CITED = 'Die Antwort [1].\n\n## Quellen\n[1] OIB-Richtlinie 3 — https://example.org/oib3'

const footerNotes = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="note"]')).map(
    (element) => element.textContent ?? ''
  )

const openAnswerDetails = async (): Promise<void> => {
  const trigger = screen.getByTestId('answer-details-trigger')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByTestId('answer-details-attention')).toBeInTheDocument()
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
}

describe.each(['default', 'inline'] as const)('the %s answer variant', (variant) => {
  test('names WHY the search stopped, on the line that says it stopped', async () => {
    render(
      <AgentResponse
        content={CITED}
        variant={variant}
        researchTruncated
        truncationReason="wall_clock"
      />
    )
    await openAnswerDetails()

    const note = screen.getByText(`${copy.truncated} (${copy.wallClock})`)
    expect(note).toHaveAttribute('role', 'note')
    expect(screen.queryByText('wall_clock')).not.toBeInTheDocument()
  })

  test('the step ceiling and the clock are told apart', async () => {
    render(
      <AgentResponse
        content={CITED}
        variant={variant}
        researchTruncated
        truncationReason="step_limit"
      />
    )
    await openAnswerDetails()

    expect(screen.getByText(`${copy.truncated} (${copy.stepLimit})`)).toBeInTheDocument()
    expect(copy.stepLimit).not.toBe(copy.wallClock)
  })

  test('a cause this build has no words for leaves the sentence exactly as it was', async () => {
    render(
      <AgentResponse
        content={CITED}
        variant={variant}
        researchTruncated
        truncationReason="tool_budget"
      />
    )
    await openAnswerDetails()

    expect(screen.getByText(copy.truncated)).toBeInTheDocument()
    expect(screen.queryByText('tool_budget')).not.toBeInTheDocument()
    expect(screen.queryByText(/answerSources\./)).not.toBeInTheDocument()
  })

  test('a reason without the flag says nothing: presence of the flag is the fact', () => {
    render(<AgentResponse content={CITED} variant={variant} truncationReason="wall_clock" />)

    expect(footerNotes()).toHaveLength(0)
  })

  test("each degradation gets its own line, in the reader's nouns", async () => {
    render(
      <AgentResponse
        content={CITED}
        variant={variant}
        researchTruncated
        degradedReasons={['no_report_file', 'no_valid_citations']}
      />
    )
    await openAnswerDetails()

    expect(screen.getByText(copy.noReport)).toHaveAttribute('role', 'note')
    expect(screen.getByText(copy.noCitations)).toHaveAttribute('role', 'note')
  })

  test('an unknown degradation is dropped without taking the known ones with it', async () => {
    render(
      <AgentResponse
        content={CITED}
        variant={variant}
        researchTruncated
        degradedReasons={['no_report_file', 'quantum_flux']}
      />
    )
    await openAnswerDetails()

    expect(screen.getByText(copy.noReport)).toBeInTheDocument()
    expect(screen.queryByText('quantum_flux')).not.toBeInTheDocument()
  })

  test('a list of nothing but unknown tokens renders no line at all', () => {
    render(<AgentResponse content={CITED} variant={variant} degradedReasons={['quantum_flux']} />)

    expect(footerNotes()).toHaveLength(0)
  })

  test('an empty list is not a claim', () => {
    render(<AgentResponse content={CITED} variant={variant} degradedReasons={[]} />)

    expect(footerNotes()).toHaveLength(0)
  })

  test('the same degradation named twice is one line', async () => {
    render(
      <AgentResponse
        content={CITED}
        variant={variant}
        degradedReasons={['no_valid_citations', 'no_valid_citations']}
      />
    )
    await openAnswerDetails()

    expect(screen.getAllByText(copy.noCitations)).toHaveLength(1)
  })
})

describe('the citation-verification reasons reach the reader as words', () => {
  test('a verification token never appears as itself', async () => {
    render(
      <AgentResponse
        content={CITED}
        citationsRemoved={{ count: 1, reasons: ['url_not_in_registry'] }}
      />
    )
    await openAnswerDetails()

    expect(screen.queryByText('url_not_in_registry')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: t('answerSources.citationsRemoved', { count: 1 }),
      })
    ).toBeInTheDocument()
    expect(copy.removedUrl.length).toBeGreaterThan(10)
  })

  test('when no reason can be worded, the count still stands — without a tooltip to open', async () => {
    render(
      <AgentResponse
        content={CITED}
        citationsRemoved={{ count: 2, reasons: ['brand_new_reason'] }}
      />
    )
    await openAnswerDetails()

    const label = t('answerSources.citationsRemoved', { count: 2 })
    expect(screen.getByText(label)).toHaveAttribute('role', 'note')
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
  })
})

describe('every token this build accepts has words in BOTH locales', () => {
  test.each([
    ['truncationReason', ['wall_clock', 'step_limit']],
    ['degradedReason', ANSWER_DEGRADED_REASONS],
    [
      'citationsRemovedReason',
      [
        'url_not_in_registry',
        'citation_key_not_in_registry',
        'unverifiable',
        'duplicate',
        'ungrounded',
        'quote_unverified',
      ],
    ],
  ] as const)('%s', (group, tokens) => {
    for (const token of tokens) {
      const german = (de.chat.answerSources[group] as Record<string, string>)[token]
      const english = (en.chat.answerSources[group] as Record<string, string>)[token]

      expect(german, `de ${group}.${token}`).toBeTruthy()
      expect(english, `en ${group}.${token}`).toBeTruthy()
      expect(german).not.toBe(english)
      for (const text of [german, english]) {
        expect(text).not.toContain('{')
        expect(text).not.toContain(token)
      }
    }
  })
})

describe('an unread basis is named as such, not as a generic check', () => {
  test('its line says a named document went unread, in both locales', () => {
    for (const dictionary of [de, en]) {
      const line = dictionary.chat.answerSources.degradedReason.basis_unread
      const limit = dictionary.chat.thinking.node.limits.degraded.basisUnread
      for (const text of [line, limit]) {
        expect(text).not.toBe(dictionary.chat.answerSources.degradedReason.no_valid_citations)
      }
    }
    expect(de.chat.answerSources.degradedReason.basis_unread).toMatch(/Grundlage/)
    expect(de.chat.thinking.node.limits.degraded.basisUnread).toMatch(/Grundlage/)
    expect(en.chat.answerSources.degradedReason.basis_unread).toMatch(/basis/)
  })

  test('it reaches the reader as its own line under the answer', async () => {
    render(<AgentResponse content={CITED} degradedReasons={['basis_unread']} />)
    await openAnswerDetails()

    expect(
      screen.getByText(en.chat.answerSources.degradedReason.basis_unread)
    ).toHaveAttribute('role', 'note')
  })
})

describe('a reopened thread shows what the live turn showed', () => {
  const backendMetadata = {
    deep_research_job_id: 'job_9',
    research_truncated: true,
    truncation_reason: 'wall_clock',
    degraded_reasons: ['no_valid_citations'],
    citations_removed: { count: 2, reasons: ['url_not_in_registry'] },
  }

  const storedProvenance = (metadata: Record<string, unknown>): MessageProvenance =>
    (normalizeAgentAnswerMetadata(metadata)?.provenance ?? {}) as MessageProvenance

  test('the persisted row decodes into the same answer the socket rendered', async () => {
    const live = render(
      <AgentResponse
        content={CITED}
        researchTruncated
        truncationReason="wall_clock"
        degradedReasons={['no_valid_citations']}
        citationsRemoved={{ count: 2, reasons: ['url_not_in_registry'] }}
      />
    )
    await openAnswerDetails()
    const fromTheSocket = footerNotes()
    live.unmount()

    const stored = storedProvenance(backendMetadata)
    render(
      <AgentResponse
        content={CITED}
        researchTruncated={stored.researchTruncated}
        truncationReason={stored.truncationReason}
        degradedReasons={stored.degradedReasons}
        citationsRemoved={stored.citationsRemoved}
      />
    )
    await openAnswerDetails()

    expect(footerNotes()).toEqual(fromTheSocket)
    expect(fromTheSocket).toContain(`${copy.truncated} (${copy.wallClock})`)
    expect(fromTheSocket).toContain(copy.noCitations)
    expect(
      screen.getByRole('button', { name: t('answerSources.citationsRemoved', { count: 2 }) })
    ).toBeInTheDocument()
  })

  test('a `false` on the row is read as absent, not as a second way to say no', () => {
    const stored = storedProvenance({ ...backendMetadata, research_truncated: false })

    expect(stored.researchTruncated).toBeUndefined()

    render(
      <AgentResponse
        content={CITED}
        researchTruncated={stored.researchTruncated}
        truncationReason={stored.truncationReason}
      />
    )
    expect(stored.truncationReason).toBe('wall_clock')
    expect(screen.queryByText(new RegExp(copy.wallClock))).not.toBeInTheDocument()
    expect(footerNotes()).toHaveLength(0)
  })

  test('a token the row carries but this build cannot word costs the reader nothing else', async () => {
    const stored = storedProvenance({
      research_truncated: true,
      truncation_reason: 'tool_budget',
      degraded_reasons: ['no_report_file', 'quantum_flux'],
    })

    render(
      <AgentResponse
        content={CITED}
        researchTruncated={stored.researchTruncated}
        truncationReason={stored.truncationReason}
        degradedReasons={stored.degradedReasons}
      />
    )
    await openAnswerDetails()

    expect(screen.getByText(copy.truncated)).toBeInTheDocument()
    expect(screen.getByText(copy.noReport)).toBeInTheDocument()
    expect(screen.queryByText(/tool_budget|quantum_flux/)).not.toBeInTheDocument()
  })
})
