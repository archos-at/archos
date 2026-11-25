/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
vi.mock('./resolve', () => ({ resolveConversationContext: vi.fn() }))
const tenancy = vi.hoisted(() => vi.fn())
vi.mock('@/lib/conversations/repository', () => ({ findConversationTenancy: tenancy }))
vi.mock('@/lib/projects/repository', () => ({ findProjectCollectionName: vi.fn(async (id: string) => `proj_${id}`) }))

import { resolveConversationContext } from './resolve'
import { decideTurn, DecisionLeavesItsSideError } from './turn-decision'
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
  tenancy.mockResolvedValue(null)
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

  describe('signs nothing that would take a chat’s turn to another side (ADR-0193; checked against the row, apart from how the scope was built)', () => {
    const row = (projectId: string | null) => ({ organizationId: 'org_1', projectId, visibility: 'private', createdBy: 'user_1', deletedAt: null })
    const withShelves = (shelves: { collection: string; shelf?: 'project' | 'base' | 'personal' }[], restricted: string[] = []) => {
      const context = { ...closedContext('chat', 's_c'), projectId: 'p_row' }
      return { ...context, may: { ...context.may, shelves, restrictedCollections: restricted } } as never
    }

    it('refuses a project shelf for a personal chat', async () => {
      tenancy.mockResolvedValue(row(null))
      vi.mocked(resolveConversationContext).mockResolvedValueOnce(withShelves([{ collection: 'proj_p1', shelf: 'project' }]))

      await expect(decideTurn(session, envelope, ANSWER, NOW)).rejects.toBeInstanceOf(DecisionLeavesItsSideError)
    })

    it('refuses restricted folders for a personal chat', async () => {
      tenancy.mockResolvedValue(row(null))
      vi.mocked(resolveConversationContext).mockResolvedValueOnce(withShelves([], ['proj_p1_restricted']))

      await expect(decideTurn(session, envelope, ANSWER, NOW)).rejects.toBeInstanceOf(DecisionLeavesItsSideError)
    })

    it('refuses another project’s shelf for a project’s chat', async () => {
      tenancy.mockResolvedValue(row('p1'))
      vi.mocked(resolveConversationContext).mockResolvedValueOnce(withShelves([{ collection: 'proj_p2', shelf: 'project' }]))

      await expect(decideTurn(session, envelope, ANSWER, NOW)).rejects.toBeInstanceOf(DecisionLeavesItsSideError)
    })

    it('refuses another person’s personal shelf for a personal chat', async () => {
      tenancy.mockResolvedValue(row(null))
      vi.mocked(resolveConversationContext).mockResolvedValueOnce(
        withShelves([{ collection: 'personal_org_1__user_2', shelf: 'personal' }], ['personal_org_1__user_2']),
      )

      await expect(decideTurn(session, envelope, ANSWER, NOW)).rejects.toBeInstanceOf(DecisionLeavesItsSideError)
    })

    it('signs a personal chat’s own shelves, and a project chat’s own project and its restricted folders', async () => {
      tenancy.mockResolvedValue(row(null))
      vi.mocked(resolveConversationContext).mockResolvedValueOnce(
        withShelves([{ collection: 'base', shelf: 'base' }, { collection: 'personal_org_1__user_1', shelf: 'personal' }], ['personal_org_1__user_1']),
      )
      await expect(decideTurn(session, envelope, ANSWER, NOW)).resolves.toBeTruthy()

      tenancy.mockResolvedValue(row('p1'))
      vi.mocked(resolveConversationContext).mockResolvedValueOnce(withShelves([{ collection: 'proj_p1', shelf: 'project' }, { collection: 'proj_p1_r', shelf: 'project' }], ['proj_p1_r']))
      await expect(decideTurn(session, envelope, ANSWER, NOW)).resolves.toBeTruthy()
    })
  })
})
