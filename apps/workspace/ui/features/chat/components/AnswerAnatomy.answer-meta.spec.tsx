import { render } from '@/test-utils'
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

  describe('the answer anatomy (answerMeta)', () => {
    const answerMeta = {
      v: 1,
      summary: 'In GK 4 gilt REI 60; maßgeblich ist das Fluchtniveau.',
      verdict: { value: 'REI 60', subject: 'Feuerwiderstand tragender Bauteile' },
      callout: { kind: 'deadline' as const, text: 'Binnen sechs Wochen anzuberaumen.' },
      takeaways: [
        { text: 'Maßgeblich ist das Fluchtniveau' },
        { text: 'Tragende Bauteile mindestens REI 60' },
      ],
    }

    test('renders the masthead above the prose and the rest after it', () => {
      const { container } = render(
        <AgentResponse
          content="REI 60 gilt, und maßgeblich ist das Fluchtniveau."
          answerMeta={answerMeta}
        />
      )
      const text = container.textContent ?? ''
      expect(text).toContain('REI 60')
      expect(text).toContain('Binnen sechs Wochen anzuberaumen.')
      expect(text).toContain('Maßgeblich ist das Fluchtniveau')
      expect(text.indexOf('REI 60')).toBeLessThan(text.indexOf('In GK 4 gilt REI 60'))
      expect(text.indexOf('In GK 4 gilt REI 60')).toBeLessThan(text.indexOf('REI 60 gilt,'))
      expect(text.indexOf('REI 60 gilt,')).toBeLessThan(text.indexOf('Binnen sechs Wochen'))
      expect(text.indexOf('Binnen sechs Wochen')).toBeLessThan(
        text.indexOf('Maßgeblich ist das Fluchtniveau')
      )
    })

    test('a summary holds the lede alone — the first paragraph takes no lede', () => {
      const longBody = `${'Ein ausreichend langer erster Absatz. '.repeat(20)}\n\nZweiter Absatz.`
      const { container } = render(<AgentResponse content={longBody} answerMeta={answerMeta} />)
      expect(container.querySelector('[class*="first-child\\]:leading-"]')).toBeNull()

      const { verdict, callout, takeaways } = answerMeta
      const { container: plain } = render(
        <AgentResponse content={longBody} answerMeta={{ v: 1, verdict, callout, takeaways }} />
      )
      expect(plain.querySelector('[class*="first-child\\]:leading-"]')).not.toBeNull()
    })

    test('an answer without anatomy renders exactly as before', () => {
      const { container } = render(<AgentResponse content="Nur Prosa." />)
      expect(container.textContent).toContain('Nur Prosa.')
    })

    test('the below-prose anatomy waits for the stream like unclaimed cards do', () => {
      const { container } = render(
        <AgentResponse content="REI 60 gilt." answerMeta={answerMeta} isStreaming />
      )
      expect(container.textContent).not.toContain('Binnen sechs Wochen')
    })

    test('a walkthrough does not wear the verdict gavel even if a verdict is present', () => {
      const { container } = render(
        <AgentResponse
          content="So legen Sie den Ordner an."
          answerMeta={{
            v: 1,
            kind: 'walkthrough',
            summary: 'Legen Sie die Pläne unter Einreichung ab.',
            verdict: { value: 'REI 60', subject: 'Feuerwiderstand tragender Bauteile' },
          }}
        />
      )
      expect(container.textContent).toContain('Legen Sie die Pläne unter Einreichung ab.')
      expect(container.textContent).not.toContain('Feuerwiderstand tragender Bauteile')
    })

    test('a body that claims the callout with [[callout]] takes it out of the after-prose block', () => {
      const { container } = render(
        <AgentResponse
          content={'Erster Absatz.\n\n[[callout]]\n\nZweiter Absatz.'}
          answerMeta={answerMeta}
        />
      )
      const text = container.textContent ?? ''
      expect(text).not.toContain('Binnen sechs Wochen')
      expect(text).toContain('Maßgeblich ist das Fluchtniveau')
    })

    test('a summary that restates the body’s opening is dropped from the masthead', () => {
      const { container } = render(
        <AgentResponse
          content="In GK 4 gilt REI 60."
          answerMeta={{ v: 1, kind: 'walkthrough', summary: 'In GK 4 gilt REI 60.' }}
        />
      )
      expect(container.textContent?.match(/In GK 4 gilt REI 60\./g)).toHaveLength(1)
      expect(container.querySelector('header')).toBeNull()
    })

    test('a citation-suffixed restatement is dropped too', () => {
      const { container } = render(
        <AgentResponse
          content="In GK 4 gilt REI 60."
          answerMeta={{ v: 1, kind: 'walkthrough', summary: 'In GK 4 gilt REI 60. [1]' }}
        />
      )
      expect(container.querySelector('header')).toBeNull()
      expect(container.textContent).toContain('In GK 4 gilt REI 60.')
    })

    test('the inline variant drops a restating summary from the masthead too', () => {
      const { container } = render(
        <AgentResponse
          content="In GK 4 gilt REI 60."
          variant="inline"
          answerMeta={{ v: 1, kind: 'walkthrough', summary: 'In GK 4 gilt REI 60.' }}
        />
      )
      expect(container.textContent?.match(/In GK 4 gilt REI 60\./g)).toHaveLength(1)
      expect(container.querySelector('header')).toBeNull()
    })

    test('a genuinely different summary still headlines the answer', () => {
      const { container } = render(
        <AgentResponse
          content="REI 60 gilt, und maßgeblich ist das Fluchtniveau."
          answerMeta={answerMeta}
        />
      )
      expect(container.querySelector('header')?.textContent).toContain('In GK 4 gilt REI 60')
    })
  })
})
