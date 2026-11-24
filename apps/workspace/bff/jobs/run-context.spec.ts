/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/person', () => ({ resolvePerson: vi.fn(async () => null) }))
vi.mock('@/lib/budgets/service', () => ({ getBudgetStatus: vi.fn(async () => { throw new Error('no budget') }) }))
vi.mock('@/lib/model-config/service', () => ({ getEffectiveModelOverrides: vi.fn(async () => null) }))
vi.mock('@/lib/org-instructions/service', () => ({ resolveOrgInstructions: vi.fn(async () => null) }))
vi.mock('@/lib/project-profile/prompt-view', () => ({
  loadProjectPromptView: vi.fn(async () => null),
  loadProjectFederalState: vi.fn(async () => null),
}))
vi.mock('@/lib/projects/memory-service', () => ({ buildProjectMemoryDigest: vi.fn(async () => null) }))
vi.mock('@/lib/workos/feature-flags', () => ({ isMemoryReflectionEnabled: vi.fn(async () => false) }))
vi.mock('@/lib/conversation-context', () => ({
  resolveConversationContext: vi.fn(async () => ({ may: { shelves: [{ collection: 'proj_p1', shelf: 'project' }] } })),
}))
vi.mock('@/lib/conversation-context/resolve', () => ({
  conversationInProject: vi.fn(async (_session: unknown, conversationId: string | null | undefined, projectId: string) =>
    conversationId === `s_in_${projectId}` ? conversationId : null),
}))

import { resolveConversationContext } from '@/lib/conversation-context'
import { resolveRunContext } from './run-context'

const subject = { organizationId: 'org_1', projectId: 'p1', userId: 'user_1' }
const session = { organizationId: 'org_1', userId: 'user_1' } as AuthorizedSession

beforeEach(() => vi.clearAllMocks())

describe('resolveRunContext', () => {
  it('decides a run in its chat when the chat is in the run’s project', async () => {
    const context = await resolveRunContext(subject, 'x', { kind: 'run', session, conversationId: 's_in_p1' })

    expect(resolveConversationContext).toHaveBeenCalledWith(session, { projectId: 'p1', conversationId: 's_in_p1', kind: 'run' })
    expect(context).toMatchObject({ kind: 'run', conversationId: 's_in_p1', collectionScope: ['proj_p1'] })
  })

  it('decides a run whose chat is in another project, or in none, without a conversation', async () => {
    const context = await resolveRunContext(subject, 'x', { kind: 'run', session, conversationId: 's_in_p2' })

    expect(resolveConversationContext).toHaveBeenCalledWith(session, { projectId: 'p1', conversationId: undefined, kind: 'run' })
    expect(context.conversationId).toBeNull()
  })

  it('resolves no scope without a session, so an intake decides nothing it then replaces', async () => {
    const context = await resolveRunContext(subject, 'x', { kind: 'headless', session: null, conversationId: 's_in_p1' })

    expect(resolveConversationContext).not.toHaveBeenCalled()
    expect(context).toMatchObject({ kind: 'headless', conversationId: null, collectionScope: null })
  })
})
