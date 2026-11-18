import { render, screen } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from '../AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../../store'
import { resetDecidedProposals } from '@/features/cards/decided-proposals'

const storeFixture = vi.hoisted(() => ({ projectId: null as string | null }))

vi.mock('../../store', () => ({
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

  describe('lede typesetting', () => {
    const LEDE = '[&>.markdown-content>p:first-child]:leading-[1.65]'
    const longAnswer = [
      'Für GK 4 gilt REI 90 für tragende Bauteile.',
      'A'.repeat(320),
      'B'.repeat(320),
    ].join('\n\n')

    const hasLede = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('div')).some((el) => el.className.includes(LEDE))

    test('a long prose answer gets its opening paragraph set as a lede', () => {
      const { container } = render(<AgentResponse content={longAnswer} />)

      expect(hasLede(container)).toBe(true)
    })

    test('a note is never a lede, however it opens', () => {
      const { container } = render(<AgentResponse content={longAnswer} routingDecision="meta" />)
      expect(hasLede(container)).toBe(false)

      const { container: direct } = render(
        <AgentResponse content={longAnswer} answerMeta={{ v: 1, kind: 'direct' }} />
      )
      expect(hasLede(direct)).toBe(false)
    })

    test('an answer that opens with a heading is left alone', () => {
      const { container } = render(<AgentResponse content={`## Ergebnis\n\n${longAnswer}`} />)

      expect(hasLede(container)).toBe(false)
    })

    test('a streaming answer decides its lede at its first words and never restyles it', () => {
      const { container, rerender } = render(
        <AgentResponse content={longAnswer.slice(0, 20)} isStreaming />
      )
      expect(hasLede(container)).toBe(true)

      rerender(<AgentResponse content={longAnswer} isStreaming />)
      expect(hasLede(container)).toBe(true)

      rerender(<AgentResponse content={longAnswer} />)
      expect(hasLede(container)).toBe(true)
    })

    test('a streaming answer waits until its opening can be read before deciding', () => {
      const { container, rerender } = render(<AgentResponse content="##" isStreaming />)
      expect(hasLede(container)).toBe(false)

      rerender(<AgentResponse content={`## Ergebnis\n\n${longAnswer}`} isStreaming />)
      expect(hasLede(container)).toBe(false)

      rerender(<AgentResponse content={`## Ergebnis\n\n${longAnswer}`} />)
      expect(hasLede(container)).toBe(false)
    })

    test('a summary shown while the answer streams is not taken back when the prose repeats it', () => {
      const summary = 'Für GK 4 gilt REI 90 für tragende Bauteile.'
      const meta = { v: 1 as const, summary, verdict: { value: 'REI 90', subject: 'Feuerwiderstand' } }
      const { rerender } = render(<AgentResponse content="" answerMeta={meta} isStreaming />)
      expect(screen.getByText(summary)).toBeInTheDocument()

      rerender(<AgentResponse content={longAnswer} answerMeta={meta} isStreaming />)
      rerender(<AgentResponse content={longAnswer} answerMeta={meta} />)
      expect(screen.getAllByText(summary).length).toBeGreaterThanOrEqual(1)
      expect(document.querySelector('header')?.textContent).toContain(summary)
    })

    test('a summary that repeats the opening is dropped before it is ever shown', () => {
      const summary = 'Für GK 4 gilt REI 90 für tragende Bauteile.'
      const meta = { v: 1 as const, summary, verdict: { value: 'REI 90', subject: 'Feuerwiderstand' } }
      render(<AgentResponse content={longAnswer} answerMeta={meta} />)
      expect(document.querySelector('header')?.textContent).not.toContain(summary)
    })
  })
})
