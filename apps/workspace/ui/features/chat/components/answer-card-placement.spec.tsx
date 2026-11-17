import { render, screen } from '@/test-utils'
import { vi, describe, test, expect, beforeAll } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { rendererSettled } from '@/features/a2ui/A2uiCard'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import type { AnswerCard } from '@/shared/cards/schemas'
import { CARD_PREVIEW_FIXTURES } from '@/features/cards/preview-fixtures'

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
beforeAll(rendererSettled)

const PLACED = { ...CARD_PREVIEW_FIXTURES.calculation!, title: 'Platzierte Karte' } as AnswerCard
const UNPLACED = { ...CARD_PREVIEW_FIXTURES.calculation!, title: 'Nachgestellte Karte' } as AnswerCard

const readable = (container: HTMLElement): string =>
  (container.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('a card the answer placed itself', () => {
  test('is drawn where the marker sits, between the two paragraphs', () => {
    const { container } = render(
      <AgentResponse
        content={'Die Steigung ist zu hoch.\n\n[[card:1]]\n\nDer Auftritt bleibt zulässig.'}
        cards={[PLACED]}
      />
    )

    const answer = readable(container)
    expect(answer.indexOf('Die Steigung ist zu hoch.')).toBeLessThan(
      answer.indexOf('Platzierte Karte')
    )
    expect(answer.indexOf('Platzierte Karte')).toBeLessThan(
      answer.indexOf('Der Auftritt bleibt zulässig.')
    )
  })

  test('never leaves its marker on screen as literal text', () => {
    const { container } = render(
      <AgentResponse content={'Die Steigung.\n\n[[card:1]]'} cards={[PLACED]} />
    )

    expect(readable(container)).not.toContain('[[card')
    expect(screen.getByText('Platzierte Karte')).toBeInTheDocument()
  })

  test('is drawn exactly once — the fallback block must not repeat it', () => {
    render(<AgentResponse content={'Die Steigung.\n\n[[card:1]]'} cards={[PLACED]} />)

    expect(screen.getAllByText('Platzierte Karte')).toHaveLength(1)
  })
})

describe('a card the answer did not place', () => {
  test('lands in the fallback block after the prose', () => {
    const { container } = render(
      <AgentResponse content={'Die Steigung ist zu hoch.'} cards={[UNPLACED]} />
    )

    const answer = readable(container)
    expect(answer.indexOf('Nachgestellte Karte')).toBeGreaterThan(
      answer.indexOf('Die Steigung ist zu hoch.')
    )
  })

  test('shares an answer with a placed one without either being lost or doubled', () => {
    const { container } = render(
      <AgentResponse
        content={'Die Steigung ist zu hoch.\n\n[[card:1]]\n\nDer Auftritt bleibt zulässig.'}
        cards={[PLACED, UNPLACED]}
      />
    )

    expect(screen.getAllByText('Platzierte Karte')).toHaveLength(1)
    expect(screen.getAllByText('Nachgestellte Karte')).toHaveLength(1)
    const answer = readable(container)
    expect(answer.indexOf('Platzierte Karte')).toBeLessThan(
      answer.indexOf('Der Auftritt bleibt zulässig.')
    )
    expect(answer.indexOf('Nachgestellte Karte')).toBeGreaterThan(
      answer.indexOf('Der Auftritt bleibt zulässig.')
    )
  })
})
