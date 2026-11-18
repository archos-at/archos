import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { chatCopy } from '@/i18n/namespaces/chat'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import type { CitationSource } from '../types'

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
  label: chatCopy.messages.en.answerDetails.readSources.label,
  more: (count: number) =>
    chatCopy.messages.en.answerDetails.readSources.more.replace('{count}', String(count)),
  less: chatCopy.messages.en.answerDetails.readSources.less,
}

const readSource = (overrides: Partial<CitationSource> = {}): CitationSource => ({
  id: `read-${overrides.fileName ?? 'x'}`,
  content: 'oib-rl_2.pdf, p.12',
  timestamp: new Date('2026-09-01T10:00:00.000Z'),
  fileName: 'oib-rl_2.pdf',
  page: 12,
  kind: 'building_law',
  lane: 'building_law_oib',
  ...overrides,
})

const CITED = 'Die Antwort [1].\n\n## Quellen\n[1] OIB-Richtlinie 2 — https://example.org/oib2'

describe.each(['default', 'inline'] as const)('the %s answer variant', (variant) => {
  test('read-but-uncited documents render as collapsed muted chips', async () => {
    render(
      <AgentResponse
        content={CITED}
        variant={variant}
        readSources={[readSource(), readSource({ fileName: 'plan.pdf', page: 3, id: 'read-plan' })]}
      />
    )
    expect(screen.queryByTestId('read-sources')).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByTestId('answer-details-trigger'))

    expect(screen.getByTestId('read-sources')).toBeInTheDocument()
    expect(screen.getByText(copy.label)).toBeInTheDocument()
    expect(screen.getByText('oib-rl_2.pdf')).toBeInTheDocument()
    expect(screen.getByText('plan.pdf')).toBeInTheDocument()
  })

  test('the chips name documents, never passages', async () => {
    const passage = 'Die Fluchtweglänge darf 40 m nicht überschreiten.'
    render(
      <AgentResponse
        content={CITED}
        variant={variant}
        readSources={[readSource({ snippet: passage })]}
      />
    )
    await userEvent.setup().click(screen.getByTestId('answer-details-trigger'))

    expect(screen.getByText('oib-rl_2.pdf')).toBeInTheDocument()
    expect(screen.queryByText(passage)).not.toBeInTheDocument()
  })

  test('a verbose content line never leaks into the chip', async () => {
    const passage = 'Die Fluchtweglänge darf 40 m nicht überschreiten.'
    render(
      <AgentResponse
        content={CITED}
        variant={variant}
        readSources={[readSource({ content: `oib-rl_2.pdf, p.12 — ${passage}` })]}
      />
    )
    await userEvent.setup().click(screen.getByTestId('answer-details-trigger'))

    expect(screen.getByText('oib-rl_2.pdf')).toBeInTheDocument()
    expect(screen.queryByText(passage)).not.toBeInTheDocument()
  })

  test('an entry without any identity shows no details trigger at all', async () => {
    const passage = 'Die Fluchtweglänge darf 40 m nicht überschreiten.'
    const orphan: CitationSource = {
      id: 'read-orphan',
      content: passage,
      timestamp: new Date('2026-09-01T10:00:00.000Z'),
    }
    render(<AgentResponse content={CITED} variant={variant} readSources={[orphan]} />)

    expect(screen.queryByTestId('answer-details-trigger')).not.toBeInTheDocument()
    expect(screen.queryByText(passage)).not.toBeInTheDocument()
  })

  test('an unrenderable entry beside a named one leaves only the named chip', async () => {
    const passage = 'Die Fluchtweglänge darf 40 m nicht überschreiten.'
    const orphan: CitationSource = {
      id: 'read-orphan',
      content: passage,
      timestamp: new Date('2026-09-01T10:00:00.000Z'),
    }
    render(<AgentResponse content={CITED} variant={variant} readSources={[readSource(), orphan]} />)
    await userEvent.setup().click(screen.getByTestId('answer-details-trigger'))

    expect(screen.getByText('oib-rl_2.pdf')).toBeInTheDocument()
    expect(screen.getAllByTestId('read-source-chip')).toHaveLength(1)
    expect(screen.queryByText(passage)).not.toBeInTheDocument()
  })

  test('the list caps at eight with an overflow count', async () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      readSource({ fileName: `doc-${index}.pdf`, id: `read-${index}` })
    )
    render(<AgentResponse content={CITED} variant={variant} readSources={many} />)
    await userEvent.setup().click(screen.getByTestId('answer-details-trigger'))

    expect(screen.getAllByTestId('read-source-chip')).toHaveLength(8)
    expect(screen.getByTestId('read-sources-more')).toHaveTextContent(copy.more(2))
  })

  test('the overflow count expands to name every document — and folds back', async () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      readSource({ fileName: `doc-${index}.pdf`, id: `read-${index}` })
    )
    render(<AgentResponse content={CITED} variant={variant} readSources={many} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('answer-details-trigger'))

    const toggle = screen.getByTestId('read-sources-more')
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await user.click(toggle)
    expect(screen.getAllByTestId('read-source-chip')).toHaveLength(10)
    expect(screen.getByText('doc-8.pdf')).toBeInTheDocument()
    expect(screen.getByText('doc-9.pdf')).toBeInTheDocument()
    expect(screen.getByTestId('read-sources-more')).toHaveTextContent(copy.less)
    expect(screen.getByTestId('read-sources-more').getAttribute('aria-expanded')).toBe('true')

    await user.click(screen.getByTestId('read-sources-more'))
    expect(screen.getAllByTestId('read-source-chip')).toHaveLength(8)
    expect(screen.getByTestId('read-sources-more')).toHaveTextContent(copy.more(2))
  })

  test('a turn that cited everything it read says nothing at all', async () => {
    const at = new Date('2026-09-01T10:00:00.000Z')
    render(<AgentResponse content={CITED} variant={variant} timestamp={at} />)
    await userEvent.setup().click(screen.getByTestId('answer-details-trigger'))

    expect(screen.queryByTestId('read-sources')).not.toBeInTheDocument()
    expect(screen.queryByText(copy.label)).not.toBeInTheDocument()
  })
})

describe('both locales carry a real label', () => {
  test('the label is written twice, not translated once', () => {
    expect(chatCopy.messages.de.answerDetails.readSources.label).not.toBe(chatCopy.messages.en.answerDetails.readSources.label)
    for (const text of [
      chatCopy.messages.de.answerDetails.readSources.label,
      chatCopy.messages.en.answerDetails.readSources.label,
    ]) {
      expect(text.trim().length).toBeGreaterThan(3)
      expect(text).not.toContain('{')
    }
  })
})
