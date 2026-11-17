import 'server-only'
import {
  deleteItemsForResource,
  deleteOrphanedInboxItems,
  markItemsInertForResource,
  markItemsInertForSubjectInProject,
} from '@/lib/inbox/repository'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { resolveInboxItemsFor } from '@/lib/inbox/service'
import {
  deleteOrphanedMentionRequests,
  deleteRequestsForResource,
  voidOpenRequestsForResource,
  voidOpenRequestsForSubjectInProject,
} from '@/lib/mentions/repository'
import { deleteAllGrantsForResource, deleteOrphanedGrants } from '@/lib/sharing/repository'

export interface CollaborationCleanupResult {
  grants: number
  requests: number
  inboxItems: number
}

export async function neutralizeConversationCollaboration(
  conversationId: string,
): Promise<CollaborationCleanupResult> {
  const [requests, inboxItems] = await Promise.all([
    voidOpenRequestsForResource('conversation', conversationId),
    markItemsInertForResource('conversation', conversationId),
  ])
  return { grants: 0, requests: requests.length, inboxItems }
}

export async function purgeResourceCollaboration(
  resourceType: import('@/lib/db/schema/resource-shares').ShareableResourceType,
  resourceId: string,
): Promise<CollaborationCleanupResult> {
  const [grants, requests, inboxItems] = await Promise.all([
    deleteAllGrantsForResource(resourceType, resourceId).catch((error) => {
      console.warn(`[collaboration-cleanup] grants purge failed for ${resourceType}:${resourceId}:`, error)
      return 0
    }),
    deleteRequestsForResource(resourceType, resourceId).catch((error) => {
      console.warn(`[collaboration-cleanup] requests purge failed for ${resourceType}:${resourceId}:`, error)
      return 0
    }),
    deleteItemsForResource(resourceType, resourceId).catch((error) => {
      console.warn(`[collaboration-cleanup] inbox purge failed for ${resourceType}:${resourceId}:`, error)
      return 0
    }),
  ])
  return { grants, requests, inboxItems }
}

export async function purgeConversationCollaboration(
  conversationId: string,
): Promise<CollaborationCleanupResult> {
  return purgeResourceCollaboration('conversation', conversationId)
}

export async function revokeCollaborationForProjectMember(
  organizationId: string,
  projectId: string,
  userId: string,
): Promise<{ requests: number; inboxItems: number }> {
  const [requests, inboxItems] = await Promise.all([
    voidOpenRequestsForSubjectInProject(organizationId, projectId, userId)
      .then(async (voided) => {
        if (voided.length > 0) {
          await resolveInboxItemsFor(
            voided
              .filter((request) => request.anchorId)
              .map((request) => ({
                organizationId: request.organizationId,
                recipientUserId: request.requestedOf,
                groupKey: inboxGroupKey(
                  'mention.requested',
                  request.resourceType,
                  request.resourceId,
                  request.anchorId,
                ),
              })),
          )
        }
        return voided.length
      })
      .catch((error) => {
        console.warn(`[collaboration-cleanup] request void failed for ${userId} in ${projectId}:`, error)
        return 0
      }),
    markItemsInertForSubjectInProject(organizationId, projectId, userId).catch((error) => {
      console.warn(`[collaboration-cleanup] inbox inert failed for ${userId} in ${projectId}:`, error)
      return 0
    }),
  ])
  return { requests, inboxItems }
}

export async function neutralizeCollaborationForProject(
  organizationId: string,
  projectId: string,
  conversationIds: readonly string[],
): Promise<CollaborationCleanupResult> {
  const total: CollaborationCleanupResult = { grants: 0, requests: 0, inboxItems: 0 }
  for (const conversationId of conversationIds) {
    try {
      const result = await neutralizeConversationCollaboration(conversationId)
      total.requests += result.requests
      total.inboxItems += result.inboxItems
    } catch (error) {
      console.warn(`[collaboration-cleanup] neutralize failed for ${conversationId}:`, error)
    }
  }
  return total
}

export async function sweepOrphanedCollaborationRows(
  limit = 500,
): Promise<CollaborationCleanupResult> {
  const [grants, requests, inboxItems] = await Promise.all([
    deleteOrphanedGrants(limit).catch((error) => {
      console.warn('[collaboration-cleanup] orphan grant sweep failed:', error)
      return 0
    }),
    deleteOrphanedMentionRequests(limit).catch((error) => {
      console.warn('[collaboration-cleanup] orphan request sweep failed:', error)
      return 0
    }),
    deleteOrphanedInboxItems(limit).catch((error) => {
      console.warn('[collaboration-cleanup] orphan inbox sweep failed:', error)
      return 0
    }),
  ])
  return { grants, requests, inboxItems }
}
