import { INBOX_ITEM_TYPES, type InboxItemType, type InboxTargetType } from '@/lib/db/schema/inbox'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import type { PushCategory, PushUrgency } from './push-categories'
import { IN_APP_ONLY, INBOUND_MAIL_TYPE_DEFINITIONS } from './inbound-mail-types'
import { canonicalInboxType, isMarkAnchored } from './types'

export { appendedGroupAnchor } from './inbound-mail-types'

export type InboxTypeGate = 'collaboration' | 'operational' | 'platform'

export interface InboxTypeDefinition {
  readonly actionable: boolean
  readonly grouping: 'collapse' | 'per-anchor'
  readonly retentionDays: number
  readonly gate: InboxTypeGate
  readonly email: InboxEmailDefault
  readonly push: InboxPushPolicy
}

export type InboxEmailDefault =
  | { readonly send: 'never' }
  | { readonly send: 'if-unread'; readonly afterMinutes: number }

export interface InboxPushPolicy {
  readonly category: PushCategory
  readonly urgency: PushUrgency
  readonly yours?: PushCategory
  readonly fold?: InboxPushFold
}

export interface InboxPushFold {
  readonly parts: Readonly<Record<string, string>>
}

export const INBOX_TYPE_DEFINITIONS: Record<InboxItemType, InboxTypeDefinition> = {
  'mention.requested': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 180,
    gate: 'collaboration',
    email: { send: 'if-unread', afterMinutes: 60 },
    push: { category: 'requests', urgency: 'high' },
  },
  'mention.answered': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'collaboration',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'normal' },
  },
  'conversation.shared_with_you': {
    actionable: false,
    grouping: 'collapse',
    retentionDays: 60,
    gate: 'collaboration',
    email: IN_APP_ONLY,
    push: { category: 'access', urgency: 'normal' },
  },
  'conversation.activity': {
    actionable: false,
    grouping: 'collapse',
    retentionDays: 30,
    gate: 'collaboration',
    email: IN_APP_ONLY,
    push: { category: 'activity', urgency: 'low' },
  },
  'storage.quota_warning': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 0 },
    push: { category: 'office', urgency: 'normal' },
  },
  'document.assigned_to_you': {
    actionable: false,
    grouping: 'collapse',
    retentionDays: 60,
    gate: 'collaboration',
    email: IN_APP_ONLY,
    push: { category: 'access', urgency: 'normal' },
  },
  'resource.ownership_taken': {
    actionable: false,
    grouping: 'collapse',
    retentionDays: 180,
    gate: 'collaboration',
    email: IN_APP_ONLY,
    push: { category: 'access', urgency: 'normal' },
  },
  'task_run.completed': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  'task_run.failed': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 30 },
    push: { category: 'results', urgency: 'normal' },
  },
  'task_run.waiting': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 30 },
    push: { category: 'requests', urgency: 'high' },
  },
  'document.review_requested': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 180,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 60 },
    push: { category: 'requests', urgency: 'normal' },
  },
  'mail_import.completed': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  'mail_import.failed': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 30 },
    push: { category: 'results', urgency: 'normal' },
  },
  'feedback.submitted': {
    actionable: false,
    grouping: 'collapse',
    retentionDays: 90,
    gate: 'platform',
    email: { send: 'if-unread', afterMinutes: 0 },
    push: { category: 'office', urgency: 'low' },
  },
  'feedback.replied': {
    actionable: false,
    grouping: 'collapse',
    retentionDays: 90,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'normal' },
  },
  'upload.completed': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'activity', urgency: 'low' },
  },
  'document.quarantined': {
    actionable: false,
    grouping: 'collapse',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'office', urgency: 'normal' },
  },
  'document.release_requested': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'office', urgency: 'normal' },
  },
  'document.new_revision': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'activity', urgency: 'low' },
  },
  'agent.work_done': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  'agent.work_failed': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 60 },
    push: { category: 'results', urgency: 'normal' },
  },
  'agent.asks_you': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 180,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 60 },
    push: { category: 'requests', urgency: 'high' },
  },
  'agent.revision_checked': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  'agent.proposal_waiting': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  'base_knowledge.new_edition': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 365,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'office', urgency: 'low' },
  },
  'agent.intake_ready': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  'annotation.assigned_to_you': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 180,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 120 },
    push: {
      category: 'requests',
      urgency: 'normal',
      fold: {
        parts: {
          overdue: 'overdue',
          due_soon: 'due_soon',
          person: 'assigned',
          piloti: 'assigned',
          due: 'redated',
          due_piloti: 'redated',
          due_cleared: 'redated',
          due_cleared_piloti: 'redated',
        },
      },
    },
  },
  'annotation.activity': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: {
      category: 'activity',
      urgency: 'low',
      yours: 'results',
      fold: {
        parts: {
          reply: 'reply',
          resolved: 'resolved',
          dismissed: 'dismissed',
          reopened: 'reopened',
          created: 'created',
          created_piloti: 'created',
        },
      },
    },
  },
  'annotation.mentioned': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 180,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 60 },
    push: { category: 'requests', urgency: 'high' },
  },
  'root_sort.ready': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'normal' },
  },
  'root_sort.failed': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: { send: 'if-unread', afterMinutes: 30 },
    push: { category: 'results', urgency: 'normal' },
  },
  'office_shelf.norm_suggested': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  ...INBOUND_MAIL_TYPE_DEFINITIONS,
}

export const MARK_ANCHORED_INBOX_TYPES: readonly InboxItemType[] = INBOX_ITEM_TYPES.filter(isMarkAnchored)

export const PROPOSAL_ANCHORED_INBOX_TYPES: readonly InboxItemType[] = ['agent.proposal_waiting', 'office_shelf.norm_suggested']

export const PLATFORM_INBOX_PERMISSION = PLATFORM_PERMISSIONS.settingsView

export function inboxTypeDefinition(type: string): InboxTypeDefinition {
  return INBOX_TYPE_DEFINITIONS[canonicalInboxType(type) as InboxItemType]
}

export function inboxItemIsActionable(type: string): boolean {
  return inboxTypeDefinition(type).actionable
}

export function visibleInboxTypes(collaborationEnabled: boolean): InboxItemType[] {
  return INBOX_ITEM_TYPES.filter((type) => {
    const { gate } = INBOX_TYPE_DEFINITIONS[type]
    if (gate === 'platform') return false
    return collaborationEnabled || gate === 'operational'
  })
}

export function platformInboxTypes(): InboxItemType[] {
  return INBOX_ITEM_TYPES.filter((type) => INBOX_TYPE_DEFINITIONS[type].gate === 'platform')
}

export function inboxIsReachable(collaborationEnabled: boolean): boolean {
  return visibleInboxTypes(collaborationEnabled).length > 0
}

export const MARKS_SET_GROUP_ANCHOR = 'set:'

export function inboxGroupKey(
  type: InboxItemType,
  resourceType: InboxTargetType,
  resourceId: string,
  anchorId?: string | null,
): string {
  const definition = inboxTypeDefinition(type)
  const base = `${type}:${resourceType}:${resourceId}`
  if (definition.grouping === 'collapse') return base
  if (!anchorId) {
    throw new Error(`[inbox] type "${type}" groups per anchor but no anchorId was supplied`)
  }
  return `${base}:${anchorId}`
}

export function inboxRetentionCutoff(type: string, now = new Date()): Date {
  const days = inboxTypeDefinition(type).retentionDays
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}
