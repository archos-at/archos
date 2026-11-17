/**
 * Telling a resource's owners that a project admin took ownership of it
 * (ADR-0032 decision 5, amended 2026-11-11).
 *
 * A takeover adds an owner; nobody loses theirs. Before this notice the owners
 * learned of it only if their share dialog happened to be open when the roster
 * refreshed, which left an audited act unseen by the people it concerns. One
 * inbox row per owner (`resource.ownership_taken`) names who took it; the row's
 * time says when.
 */

import 'server-only'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems } from '@/lib/inbox/service'
import { describeResource } from './registry'
import { listGrantsForResource } from './repository'

/** Who owns a resource now: its creator and every owner grant. */
export async function resolveOwners(
  organizationId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<string[]> {
  const [probe, grants] = await Promise.all([
    describeResource(resourceType).probe(resourceId),
    listGrantsForResource(organizationId, resourceType, resourceId),
  ])
  const owners = new Set<string>()
  if (probe?.createdBy) owners.add(probe.createdBy)
  for (const grant of grants) if (grant.role === 'owner') owners.add(grant.subjectUserId)
  return [...owners]
}

/**
 * One inbox row per owner except the one who took ownership. Best-effort: the
 * grant and its audit record are committed by now, and a failed notice must
 * not answer 500 for a takeover that happened.
 */
export async function notifyOwnersOfTakeover(input: {
  organizationId: string
  resourceType: ShareableResourceType
  resourceId: string
  actorUserId: string
  owners: readonly string[]
}): Promise<void> {
  const recipients = input.owners.filter((userId) => userId !== input.actorUserId)
  if (recipients.length === 0) return
  const { organizationId, resourceType, resourceId, actorUserId } = input
  await bestEffortInbox(`resource.ownership_taken for ${resourceType} ${resourceId}`, organizationId, async () => {
    const ref = await describeResource(resourceType).describeRef(resourceId, organizationId)
    await emitInboxItems(
      recipients.map((recipientUserId) => ({
        organizationId,
        recipientUserId,
        type: 'resource.ownership_taken' as const,
        resourceType,
        resourceId,
        actorUserId,
        groupKey: inboxGroupKey('resource.ownership_taken', resourceType, resourceId),
        payload: { subject: ref?.title ?? null },
      })),
    )
  })
}
