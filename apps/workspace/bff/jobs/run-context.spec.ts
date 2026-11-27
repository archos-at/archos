/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

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
vi.mock('@/lib/conversation-context/resolve', () => ({
  resolveRunConversationContext: vi.fn(async (_session: unknown, request: { projectId: string; conversationId?: string | null }) => ({
    conversationId: request.conversationId === `s_in_${request.projectId}` ? request.conversationId : null,
    may: { shelves: [{ collection: 'proj_p1', shelf: 'project' }] },
  })),
}))

import { resolveRunConversationContext } from '@/lib/conversation-context/resolve'
import { resolveRunContext } from './run-context'

const subject = { organizationId: 'org_1', projectId: 'p1', userId: 'user_1' }
const session = { organizationId: 'org_1', userId: 'user_1' } as AuthorizedSession

beforeEach(() => vi.clearAllMocks())

describe('resolveRunContext', () => {
  it('decides a run in its chat when the chat is in the run’s project', async () => {
    const context = await resolveRunContext(subject, 'x', { kind: 'run', session, conversationId: 's_in_p1' })

    expect(resolveRunConversationContext).toHaveBeenCalledWith(session, { projectId: 'p1', conversationId: 's_in_p1', kind: 'run' })
    expect(context).toMatchObject({ kind: 'run', conversationId: 's_in_p1', collectionScope: ['proj_p1'] })
  })

  it('signs no conversation for a run whose chat is in another project, or in none', async () => {
    const context = await resolveRunContext(subject, 'x', { kind: 'run', session, conversationId: 's_in_p2' })

    expect(context.conversationId).toBeNull()
  })

  it('resolves no scope for an intake, which decides nothing it then replaces', async () => {
    const context = await resolveRunContext(subject, 'x', { kind: 'headless', session: null })

    expect(resolveRunConversationContext).not.toHaveBeenCalled()
    expect(context).toMatchObject({ kind: 'headless', conversationId: null, collectionScope: null })
  })
})
