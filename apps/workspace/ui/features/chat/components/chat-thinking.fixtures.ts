import { screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { translatorFor } from '@/i18n/namespace'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useLayoutStore } from '@/features/layout/store'
import { storedStep } from '@/test-utils/wire-v2-steps'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'

export const tEn = translatorFor(chatCopy, 'en')
export const plain = (text: string | null): string => (text ?? '').replace(/\u00A0/g, ' ')

export const createStep = (overrides: Partial<StoredThinkingStep> = {}): StoredThinkingStep => ({
  id: 'step-1',
  userMessageId: 'msg-1',
  kind: 'tool',
  tool: 'acme_internal',
  isComplete: false,
  timestamp: '2024-01-15T14:30:00',
  ...overrides,
})

export const oibSources = (hits: Array<{ name: string; detail: string }>) =>
  storedStep({
    id: 'sources:0:knowledge_search:1',
    kind: 'sources',
    tool: 'knowledge_search',
    round: 0,
    lanes: [
      { key: 'building_law_oib', label: 'OIB-Richtlinie', kind: 'building_law', hit_count: hits.length, sources: hits },
    ],
  })

export const expandToSteps = async (user: ReturnType<typeof userEvent.setup>) => {
  useLayoutStore.setState({ showTechnicalReasoning: true })
  await user.click(screen.getByText(/^Trace( ·|$)/))
  await user.click(await screen.findByText('Intermediate steps'))
}

export const stepList = () => screen.getByRole('list', { name: 'Thinking steps' })

export const header = () => within(screen.getAllByRole('button')[0])
