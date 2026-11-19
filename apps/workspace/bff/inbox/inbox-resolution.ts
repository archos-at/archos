import 'server-only'
import { publishToUser } from '@/lib/events/bus'
import type { InboxItemType } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import {
  markItemsInertAnchoredOn,
  markItemsInertForResource,
  markItemsInertForSubjectRow,
  openRecipientsOfGroup,
  refreshOpenGroupItems,
  resolveInboxItemsForTargets,
  resolveOpenItemsAnchoredOn,
  resolveOpenItemsOfType,
  retractOccurrenceAnchoredOn,
  rewriteItemPayloadsAnchoredOn,
  type AnchoredRows,
  type InboxResolutionTarget,
  type OpenGroupRefresh,
} from './repository'

export async function openRecipientsOf(organizationId: string, groupKey: string): Promise<string[]> {
  return openRecipientsOfGroup(organizationId, groupKey)
}

export async function resolveInboxItemsFor(
  targets: readonly InboxResolutionTarget[],
): Promise<number> {
  const resolved = await resolveInboxItemsForTargets(targets)
  await Promise.all(
    [...new Set(targets.map((target) => target.recipientUserId))].map((userId) =>
      publishToUser(userId, { kind: 'inbox.changed', pending: -1 }),
    ),
  )
  return resolved
}

export async function resolveInboxItemsAnchoredOn(input: {
  organizationId: string
  types: readonly InboxItemType[]
  anchorId: string
  recipientUserId?: string
}): Promise<number> {
  return nudge(await resolveOpenItemsAnchoredOn(input))
}

export async function resolveInboxItemsOfType(input: { organizationId: string; types: readonly InboxItemType[] }): Promise<number> {
  return nudge(await resolveOpenItemsOfType(input))
}

async function nudge(recipients: readonly string[]): Promise<number> {
  await Promise.all(recipients.map((userId) => publishToUser(userId, { kind: 'inbox.changed', pending: -1 })))
  return recipients.length
}

export async function refreshOpenInboxGroup(input: OpenGroupRefresh): Promise<number> {
  return nudge(await refreshOpenGroupItems(input))
}

export async function markInboxItemsInertAnchoredOn(input: AnchoredRows): Promise<number> {
  return nudge(await markItemsInertAnchoredOn(input))
}

export async function retractInboxOccurrenceAnchoredOn(
  input: AnchoredRows & { clear: readonly string[]; inertWhenSpent: boolean }
): Promise<number> {
  return nudge(await retractOccurrenceAnchoredOn(input))
}

export async function rewriteInboxPayloadsAnchoredOn(input: AnchoredRows & { facts: Record<string, unknown> }): Promise<number> {
  return nudge(await rewriteItemPayloadsAnchoredOn(input))
}

export async function markItemsInertForSubject(
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
): Promise<number> {
  const affected = await markItemsInertForSubjectRow(resourceType, resourceId, subjectUserId)
  if (affected > 0) {
    await publishToUser(subjectUserId, { kind: 'inbox.changed', pending: -1 })
  }
  return affected
}

export async function markItemsInertForDeletedResource(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<number> {
  return markItemsInertForResource(resourceType, resourceId)
}
