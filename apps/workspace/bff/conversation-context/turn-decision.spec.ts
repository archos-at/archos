/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({ db: true })) }))
vi.mock('@/lib/conversations/restricted-use-repository', () => ({ markAnswerRestrictedUse: vi.fn() }))
vi.mock('./record', () => ({ recordAnswerContext: vi.fn(async () => true) }))
vi.mock('./resolve', () => ({ resolveConversationContext: vi.fn() }))

import { markAnswerRestrictedUse } from '@/lib/conversations/restricted-use-repository'
import { recordAnswerContext } from './record'
import { resolveConversationContext } from './resolve'
import { decideTurn } from './turn-decision'
import { closedContext } from './context.fixtures'
import { verifyDecision } from './wire'

const SECRET = 'decision-secret'
const ANSWER = '5a5a5a5a-0000-4000-8000-000000000001'
const NOW = 1_795_600_000_000
const session = { userId: 'user_1', organizationId: 'org_1' } as AuthorizedSession
const envelope = { organizationId: 'org_1', userId: 'user_1', conversationId: 's_c', projectId: 'p_env' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INTERNAL_API_TOKEN', SECRET)
  vi.mocked(resolveConversationContext).mockResolvedValue({ ...closedContext('chat', 's_c'), projectId: 'p_row' })
})

describe('decideTurn', () => {
  it('decides a chat turn from the envelope, records the answer before signing, and signs what it returns', async () => {
    const answer = await decideTurn(session, envelope, ANSWER, NOW)

    expect(resolveConversationContext).toHaveBeenCalledWith(session, { conversationId: 's_c', projectId: 'p_env', kind: 'chat' })
    expect(recordAnswerContext).toHaveBeenCalledWith(
      { organizationId: 'org_1', userId: 'user_1', conversationId: 's_c', answerMessageId: ANSWER },
      expect.objectContaining({ projectId: 'p_row' }),
    )
    expect(markAnswerRestrictedUse).toHaveBeenCalledWith({ db: true }, 'org_1', 's_c', ANSWER)
    expect(verifyDecision(answer.decision, answer.signature, SECRET, NOW)).toEqual(answer.body)
    expect(answer.body).toMatchObject({ conversationId: 's_c', answerMessageId: ANSWER, kind: 'chat', issuedAt: NOW })
  })

  it('signs no decision and records nothing when the audience cannot be read (fail-closed)', async () => {
    vi.mocked(resolveConversationContext).mockRejectedValueOnce(new Error('connection reset'))

    await expect(decideTurn(session, envelope, ANSWER, NOW)).rejects.toThrow('connection reset')
    expect(recordAnswerContext).not.toHaveBeenCalled()
    expect(markAnswerRestrictedUse).not.toHaveBeenCalled()
  })

  it('records nothing without an answer id', async () => {
    await decideTurn(session, envelope, null, NOW)

    expect(recordAnswerContext).not.toHaveBeenCalled()
    expect(markAnswerRestrictedUse).not.toHaveBeenCalled()
  })

  it('signs no decision for an answer id that already belongs to another conversation', async () => {
    vi.mocked(recordAnswerContext).mockResolvedValueOnce(false)

    await expect(decideTurn(session, envelope, ANSWER, NOW)).rejects.toThrow(/another conversation/)
  })

  it('refuses to decide without a token to sign with', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', '')

    await expect(decideTurn(session, envelope, ANSWER, NOW)).rejects.toThrow(/sign/)
    expect(resolveConversationContext).not.toHaveBeenCalled()
  })
})
