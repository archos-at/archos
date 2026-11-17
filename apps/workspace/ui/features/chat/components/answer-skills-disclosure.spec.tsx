import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
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

describe.each(['default', 'inline'] as const)('the %s answer variant', (variant) => {
  test('names both skills and mutes the hidden one', async () => {
    const user = userEvent.setup()
    render(
      <AgentResponse
        content="Die Antwort."
        variant={variant}
        skillsActivated={['oib-brandschutz', 'piloti-voice']}
        skillsHidden={['piloti-voice']}
      />
    )

    await user.click(screen.getByTestId('answer-details-trigger'))
    await user.click(screen.getByTestId('skills-used-trigger'))
    const panel = await screen.findByTestId('skills-used-panel')
    expect(panel).toHaveTextContent('oib-brandschutz')
    expect(panel).toHaveTextContent('piloti-voice')
    const hiddenRow = screen.getByTestId('skills-used-hidden-row')
    expect(hiddenRow).toHaveTextContent('piloti-voice')
    expect(hiddenRow.className).toContain('opacity-60')
  })

  test("the reader's reasoning preference reaches the row", async () => {
    const user = userEvent.setup()
    render(
      <AgentResponse
        content="Die Antwort."
        variant={variant}
        skillsActivated={['piloti-voice']}
        skillsHidden={['piloti-voice']}
        showReasoning
      />
    )

    await user.click(screen.getByTestId('answer-details-trigger'))
    await user.click(screen.getByTestId('skills-used-trigger'))
    const hiddenRow = await screen.findByTestId('skills-used-hidden-row')
    expect(hiddenRow).toHaveTextContent('piloti-voice')
    expect(hiddenRow.className).not.toContain('opacity-60')
  })
})
