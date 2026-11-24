import { vi } from 'vitest'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess, type ProjectRole } from '@/lib/authz/projects'
import type { Message } from '@/lib/db/schema/messages'
import type { ResourceVisibility } from '@/lib/db/schema/resource-shares'
import { findConversationInOrg, findConversationTenancy } from './repository'

export const CONVERSATION_ID = 'conv_1'
export const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

export const session = {
  userId: 'user_me',
  organizationId: 'org_1',
  role: 'member',
  roles: ['member'],
  permissions: [],
  email: 'me@example.test',
  featureFlags: ['collaboration'],
} as unknown as AuthorizedSession

export function stubConversation(
  overrides: Partial<{
    organizationId: string
    projectId: string | null
    visibility: ResourceVisibility
    createdBy: string
    deletedAt: Date | null
  }> = {}
): void {
  const tenancy = {
    organizationId: 'org_1',
    projectId: PROJECT_ID,
    visibility: 'private' as ResourceVisibility,
    createdBy: 'user_creator',
    deletedAt: null,
    jobId: null,
    ...overrides,
  }
  vi.mocked(findConversationTenancy).mockResolvedValue(tenancy)
  vi.mocked(findConversationInOrg).mockResolvedValue({
    id: CONVERSATION_ID,
    title: 'Brandschutz Stiegenhaus',
    tags: [],
    engagement: null,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-02T10:00:00Z'),
    subjectResourceType: null,
    subjectResourceId: null,
    temporary: false,
    ...tenancy,
  })
}

export function stubContainer(role: ProjectRole | 'denied'): void {
  if (role === 'denied') {
    vi.mocked(requireProjectAccess).mockRejectedValue(new NotFoundError())
    return
  }
  vi.mocked(requireProjectAccess).mockResolvedValue({ role } as never)
}

export function messageRow(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_1',
    conversationId: CONVERSATION_ID,
    role: 'user',
    authorUserId: null,
    content: 'Ist das Atrium OIB 2.3?',
    metadata: {},
    createdAt: new Date('2026-07-02T10:00:00Z'),
    ...overrides,
  } as Message
}
