/**
 * @vitest-environment node
 */
/**
 * The owners of a resource are told when a project admin takes ownership of it
 * (ADR-0032 decision 5, amended 2026-11-11): who did it, and the row's time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/tenant-context', () => ({
  getTenantContext: vi.fn(() => ({ organizationId: 'org_1' })),
  withTenant: vi.fn(),
}))

vi.mock('@/lib/inbox/service', () => ({ emitInboxItems: vi.fn() }))

vi.mock('@/lib/conversations/repository', () => ({
  findConversationTenancy: vi.fn(),
  findConversationInOrg: vi.fn(),
}))

vi.mock('./repository', () => ({ listGrantsForResource: vi.fn() }))

import { findConversationInOrg, findConversationTenancy } from '@/lib/conversations/repository'
import { emitInboxItems } from '@/lib/inbox/service'
import { notifyOwnersOfTakeover, resolveOwners } from './ownership-notice'
import { listGrantsForResource } from './repository'

beforeEach(() => {
  vi.mocked(findConversationTenancy).mockResolvedValue({
    organizationId: 'org_1',
    projectId: 'proj_1',
    visibility: 'project',
    createdBy: 'user_creator',
    deletedAt: null,
  })
  vi.mocked(findConversationInOrg).mockResolvedValue({ title: 'Brandschutz Halle 3' } as never)
  vi.mocked(emitInboxItems).mockResolvedValue(1)
})

describe('resolveOwners', () => {
  it('is the creator and every owner grant, and nobody who holds less', async () => {
    vi.mocked(listGrantsForResource).mockResolvedValue([
      { subjectUserId: 'user_co_owner', role: 'owner' },
      { subjectUserId: 'user_reader', role: 'viewer' },
      { subjectUserId: 'user_creator', role: 'owner' },
    ] as never)

    await expect(resolveOwners('org_1', 'conversation', 'conv_1')).resolves.toEqual(['user_creator', 'user_co_owner'])
  })
})

describe('notifyOwnersOfTakeover', () => {
  const input = {
    organizationId: 'org_1',
    resourceType: 'conversation' as const,
    resourceId: 'conv_1',
    actorUserId: 'user_admin',
  }

  it('writes one row per owner, naming the admin, and none for the admin', async () => {
    await notifyOwnersOfTakeover({ ...input, owners: ['user_creator', 'user_admin', 'user_co_owner'] })

    expect(emitInboxItems).toHaveBeenCalledWith(
      ['user_creator', 'user_co_owner'].map((recipientUserId) => ({
        organizationId: 'org_1',
        recipientUserId,
        type: 'resource.ownership_taken',
        resourceType: 'conversation',
        resourceId: 'conv_1',
        actorUserId: 'user_admin',
        groupKey: 'resource.ownership_taken:conversation:conv_1',
        payload: { subject: 'Brandschutz Halle 3' },
      })),
    )
  })

  it('writes nothing when the admin is the only owner there is', async () => {
    await notifyOwnersOfTakeover({ ...input, owners: ['user_admin'] })

    expect(emitInboxItems).not.toHaveBeenCalled()
  })

  it('never fails the takeover it reports on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(emitInboxItems).mockRejectedValue(new Error('inbox unavailable'))

    await expect(notifyOwnersOfTakeover({ ...input, owners: ['user_creator'] })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
