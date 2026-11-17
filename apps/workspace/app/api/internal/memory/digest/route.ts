import { z } from 'zod'
import { internalApiRoute, parseQuery } from '@/lib/api/handler'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import {
  buildProjectMemoryDigest,
  PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS,
  resolveProjectOrganization,
} from '@/lib/projects/memory-service'
import { ANY_MEMBER, clearanceOfMember, readableFolderIdsFor } from '@/lib/authz/folder-access'
import { buildProposalDecisionsBlock, composeMemoryContext } from '@/lib/projects/proposal-decisions'
import { buildReviewDecisionsBlock } from '@/lib/documents/review-decisions'
import { buildFolderDescriptionsBlock } from '@/lib/filing/folder-descriptions-block'
import { admitSourceFolders } from '@/lib/conversations/restricted-use'

const digestQuerySchema = z
  .object({
    projectId: z.string().optional(),
    organizationId: z.string().optional(),
    query: z.string().trim().max(2000).optional(),
    conversationId: z.string().trim().max(200).optional(),
    restrictedCollections: z.string().trim().max(5000).optional(),
    userId: z.string().trim().max(128).optional(),
    answerMessageId: z.guid().optional(),
  })
  .transform((query) => ({
    projectId: query.projectId || undefined,
    organizationId: query.organizationId || undefined,
    query: query.query || undefined,
    conversationId: query.conversationId || undefined,
    userId: query.userId || undefined,
    answerMessageId: query.answerMessageId || undefined,
    restrictedCollections: (query.restrictedCollections ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS),
  }))
  .refine((query) => !!(query.projectId || query.organizationId), {
    message: 'projectId or organizationId is required',
  })

export const GET = internalApiRoute(
  'Internal Memory Digest',
  async ({ request }) => {
    const { projectId, organizationId, query, conversationId, userId, answerMessageId, restrictedCollections } = parseQuery(
      request,
      digestQuerySchema
    )

    const tenant = organizationId ?? (projectId ? await withPlatformAccess(
      'resolving the project row that names the tenant for a project-only digest',
      () => resolveProjectOrganization(projectId)
    ) : null)

    if (!tenant) return { digest: null }

    return withTenant({ organizationId: tenant }, async () => {
      const eligible = Boolean(projectId && conversationId && userId && restrictedCollections.length > 0)
      const open = projectId ? new Set(await readableFolderIdsFor(tenant, projectId, ANY_MEMBER)) : new Set<string>()
      const readable =
        projectId && eligible && userId
          ? await readableFolderIdsFor(tenant, projectId, await clearanceOfMember(tenant, userId, projectId))
          : [...open]
      let restrictedFoldersServed: string[] = []
      const digest = await buildProjectMemoryDigest(projectId, tenant, {
        query,
        readableFolderIds: readable,
        admitRestricted: async (folderIds) => {
          if (!eligible || !conversationId || !userId) return new Set(folderIds.filter((id) => open.has(id)))
          const admission = await admitSourceFolders(
            { organizationId: tenant, conversationId, userId, projectId: projectId ?? null, answerMessageId },
            folderIds
          )
          restrictedFoldersServed = admission.admitted.filter((id) => !open.has(id))
          return new Set(admission.admitted)
        },
      })
      const decisions = projectId
        ? await buildProposalDecisionsBlock(projectId, tenant).catch(() => null)
        : null
      const reviewDecisions = conversationId
        ? await buildReviewDecisionsBlock(conversationId, tenant).catch(() => null)
        : null
      const folders = await buildFolderDescriptionsBlock(tenant, projectId ?? null).catch(() => null)
      return { digest: composeMemoryContext(digest, decisions, reviewDecisions, folders), restrictedFoldersServed }
    })
  },
  { tenancy: { fromPayload: '?organizationId, else resolved from the project row' } }
)
