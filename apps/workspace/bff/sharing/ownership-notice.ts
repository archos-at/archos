import 'server-only'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems } from '@/lib/inbox/service'
import { describeResource } from './registry'
import { listGrantsForResource } from './repository'

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
