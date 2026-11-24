/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
vi.mock('./resolve', () => ({ resolveConversationContext: vi.fn() }))

import { resolveConversationContext } from './resolve'
import { decideTurn } from './turn-decision'
import { closedContext } from './context.fixtures'
import { verifyDecision } from './wire'

const SECRET = 'decision-secret'
const ANSWER = '5a5a5a5a-0000-4000-8000-000000000001'
const NOW = 1_795_600_000_000
const session = { userId: 'user_1', organizationId: 'org_1' } as AuthorizedSession
const envelope = { organizationId: 'org_1', userId: 'user_1', conversationId: 's_c', projectId: 'p_env', contextKind: 'chat' as const }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INTERNAL_API_TOKEN', SECRET)
  vi.mocked(resolveConversationContext).mockResolvedValue({ ...closedContext('chat', 's_c'), projectId: 'p_row' })
})

describe('decideTurn', () => {
  it('decides a chat turn from the envelope and signs what it returns, writing nothing on the way', async () => {
    const answer = await decideTurn(session, envelope, ANSWER, NOW)

    expect(resolveConversationContext).toHaveBeenCalledWith(session, { conversationId: 's_c', projectId: 'p_env', kind: 'chat' })
    expect(verifyDecision(answer.decision, answer.signature, SECRET, NOW)).toEqual(answer.body)
    expect(answer.body).toMatchObject({ conversationId: 's_c', answerMessageId: ANSWER, kind: 'chat', issuedAt: NOW })
  })

  it('decides with the kind the envelope signs, so a headless turn is not decided as a chat', async () => {
    await decideTurn(session, { ...envelope, contextKind: 'headless' }, ANSWER, NOW)

    expect(resolveConversationContext).toHaveBeenCalledWith(session, { conversationId: 's_c', projectId: 'p_env', kind: 'headless' })
  })

  it('signs no decision when the audience cannot be read (fail-closed)', async () => {
    vi.mocked(resolveConversationContext).mockRejectedValueOnce(new Error('connection reset'))

    await expect(decideTurn(session, envelope, ANSWER, NOW)).rejects.toThrow('connection reset')
  })

  it('refuses to decide without a token to sign with', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', '')

    await expect(decideTurn(session, envelope, ANSWER, NOW)).rejects.toThrow(/sign/)
    expect(resolveConversationContext).not.toHaveBeenCalled()
  })
})
