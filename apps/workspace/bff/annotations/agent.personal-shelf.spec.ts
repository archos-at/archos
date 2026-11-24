/**
 * @vitest-environment node
 *
 * The agent's annotation writes from a chat that read its owner's shelf
 * (ADR-0193, rule 4): the BFF refuses them itself, not only the agent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/conversations/restricted-egress', () => ({
  AGENT_REFUSAL_LOCALE: 'de',
  requireNoPersonalShelfEgress: vi.fn(async () => undefined),
}))
vi.mock('@/lib/authz/feature-flags', () => ({ isAgentActsEnabled: vi.fn(() => true) }))

import { ConversationConfinedError } from '@/lib/api/errors'
import { requireNoPersonalShelfEgress } from '@/lib/conversations/restricted-egress'
import { runAgentAnnotationRequest, type AgentDocument } from './agent'

const session = { organizationId: 'org_1', userId: 'user_owner', email: 'o@example.test' } as AuthorizedSession
const agent = { organizationId: 'org_1', conversationId: 's_conv_1', onBehalfOf: 'user_owner' }
const office: AgentDocument = { id: 'd-office', name: 'Plan.pdf', projectId: null, personal: false }
const own: AgentDocument = { id: 'd-own', name: 'Notiz.pdf', projectId: null, personal: true }
const reply = { op: 'reply', annotationId: 'a1', body: 'Antwort' } as never

beforeEach(() => vi.clearAllMocks())

describe('an annotation write from a chat that read Meine Ablage', () => {
  it('is refused on a document others read, before anything is written', async () => {
    const refused = new ConversationConfinedError('personalShelf', 'nein')
    vi.mocked(requireNoPersonalShelfEgress).mockRejectedValueOnce(refused)

    await expect(runAgentAnnotationRequest(session, office, reply, agent)).rejects.toBe(refused)
    expect(requireNoPersonalShelfEgress).toHaveBeenCalledWith({ conversationId: 's_conv_1', locale: 'de' }, 'org_1')
  })

  it('is not asked on the owner’s own document, nor for a read', async () => {
    vi.mocked(requireNoPersonalShelfEgress).mockRejectedValue(new ConversationConfinedError('personalShelf', 'nein'))

    await runAgentAnnotationRequest(session, office, { op: 'point', page: 1, x: 0, y: 0 } as never, agent).catch(() => undefined)
    expect(requireNoPersonalShelfEgress).not.toHaveBeenCalled()
    await runAgentAnnotationRequest(session, own, reply, agent).catch((error: unknown) => {
      expect(error).not.toBeInstanceOf(ConversationConfinedError)
    })
    expect(requireNoPersonalShelfEgress).not.toHaveBeenCalled()
  })
})
