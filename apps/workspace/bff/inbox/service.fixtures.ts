import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboxItem, InboxItemType } from '@/lib/db/schema/inbox'

export const featureGrants = { collaboration: true }

export function makeSession(overrides: Partial<AuthorizedSession> = {}): AuthorizedSession {
  return {
    userId: 'user_1',
    email: 'user_1@example.test',
    name: 'Test User',
    accessToken: 'workos_token',
    organizationId: 'org_1',
    organizationMembershipId: 'om_1',
    role: 'admin',
    permissions: [],
    get featureFlags() {
      return featureGrants.collaboration ? ['collaboration'] : []
    },
    ...overrides,
  }
}

export const session = makeSession()

export const ALL_TYPES = [
  'mention.requested',
  'mention.answered',
  'conversation.shared_with_you',
  'conversation.activity',
  'storage.quota_warning',
  'document.assigned_to_you',
  'resource.ownership_taken',
  'task_run.completed',
  'task_run.failed',
  'task_run.waiting',
  'document.review_requested',
  'feedback.replied',
  'upload.completed',
  'document.quarantined',
  'document.release_requested',
  'mail_import.completed',
  'mail_import.failed',
  'document.new_revision',
  'agent.work_done',
  'agent.work_failed',
  'agent.asks_you',
  'agent.proposal_waiting',
  'agent.intake_ready',
  'agent.revision_checked',
  'annotation.assigned_to_you',
  'annotation.activity',
  'annotation.mentioned',
  'root_sort.ready',
  'root_sort.failed',
  'office_shelf.norm_offered',
  'office_shelf.norm_suggested',
  'inbound_mail.waiting',
  'inbound_mail.expiring',
  'inbound_mail.decided',
  'inbound_mail.filing_failed',
  'inbound_mail.cap_reached',
  'inbound_mail.appended',
  'mail_thread.follow_expiring',
  'inbound_mail.held',
  'inbound_mail.held_for_writers',
  'inbound_mail.rejected',
  'inbound_mail.expired',
  'base_knowledge.new_edition',
] as const satisfies readonly InboxItemType[]

export const OPERATIONAL_TYPES = [
  'storage.quota_warning',
  'task_run.completed',
  'task_run.failed',
  'task_run.waiting',
  'document.review_requested',
  'feedback.replied',
  'upload.completed',
  'document.quarantined',
  'document.release_requested',
  'mail_import.completed',
  'mail_import.failed',
  'document.new_revision',
  'agent.work_done',
  'agent.work_failed',
  'agent.asks_you',
  'agent.proposal_waiting',
  'agent.intake_ready',
  'agent.revision_checked',
  'annotation.assigned_to_you',
  'annotation.activity',
  'annotation.mentioned',
  'root_sort.ready',
  'root_sort.failed',
  'office_shelf.norm_offered',
  'office_shelf.norm_suggested',
  'inbound_mail.waiting',
  'inbound_mail.expiring',
  'inbound_mail.decided',
  'inbound_mail.filing_failed',
  'inbound_mail.cap_reached',
  'inbound_mail.appended',
  'mail_thread.follow_expiring',
  'inbound_mail.held',
  'inbound_mail.held_for_writers',
  'inbound_mail.rejected',
  'inbound_mail.expired',
  'base_knowledge.new_edition',
] as const satisfies readonly InboxItemType[]

export const at = new Date('2026-07-29T10:00:00.000Z')

export function row(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item_1',
    organizationId: 'org_1',
    recipientUserId: 'user_1',
    type: 'conversation.activity',
    resourceType: 'conversation',
    resourceId: 'conv_1',
    anchorId: null,
    actorUserId: 'user_2',
    groupKey: 'conversation.activity:conversation:conv_1',
    actionable: false,
    count: 1,
    payload: { subject: 'Brandschutz Halle 3', excerpt: 'Welche OIB-2 Anforderung gilt hier?' },
    createdAt: at,
    updatedAt: at,
    readAt: null,
    resolvedAt: null,
    archivedAt: null,
    inertAt: null,
    ...overrides,
  }
}

export const reachable = {
  role: 'collaborator' as const,
  reason: 'visibility-project' as const,
  visibility: 'project' as const,
  container: { organizationId: 'org_1', projectId: 'proj_1' },
  canEscalate: false,
  contentLocked: false,
}
