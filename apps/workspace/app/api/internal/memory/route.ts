import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { withOptionalTenant } from '@/lib/db/tenant-context'
import { BadRequestError, NotFoundError, OrgMemoryDisabledError } from '@/lib/api/errors'
import { requireMayRememberFrom } from '@/lib/conversations/cross-project-use'
import { requireConversationKeepsMemory } from '@/lib/conversations/temporary'
import { findProjectTenancy } from '@/lib/projects/repository'
import {
  createProjectMemoryItem,
  createProjectMemoryItemForProject,
  organizationExists,
} from '@/lib/projects/memory-service'
import { resolveOfficeTopicForWrite, resolveTopicForAgentProjectWrite } from '@/lib/projects/memory-topics'
import { memoryTopicField } from '@/lib/memory-topics/wire'
import {
  memoryJudgeVerdictSchema,
  recordMemoryJudgeVerdict,
  recordRefusedMemoryJudgeVerdict,
} from '@/lib/projects/memory-judge-audit'
import { PROJECT_MEMORY_CONFIDENCES, PROJECT_MEMORY_KINDS, PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS } from '@/lib/db/schema/project-memory'

function agentOrgMemoryAllowed(): boolean {
  return (process.env.ALLOW_AGENT_ORG_MEMORY ?? '').toLowerCase() === 'true'
}

const internalMemorySchema = z
  .object({
    scope: z.enum(['project', 'organization']).default('project'),
    projectId: z.guid().optional(),
    organizationId: z.string().min(1).optional(),
    kind: z.enum(PROJECT_MEMORY_KINDS),
    content: z.string().trim().min(1).max(2000),
    confidence: z.enum(PROJECT_MEMORY_CONFIDENCES).default('medium'),
    provenanceType: z.enum(['agent', 'distillation']).default('agent'),
    sourceConversationId: z.string().max(255).optional(),
    supersedesContent: z.string().trim().min(1).max(2000).optional(),
    salience: z.number().min(0).max(1).optional(),
    restrictedCollections: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,200}_r[0-9a-f]{12}$/))
      .min(1)
      .max(PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS)
      .optional(),
    restrictionJudge: memoryJudgeVerdictSchema.optional(),
    topic: memoryTopicField.optional(),
  })
  .refine((v) => (v.scope === 'project' ? !!v.projectId : !!v.organizationId), {
    message: 'project scope requires projectId; organization scope requires organizationId',
  })

export const POST = internalApiRoute(
  'Internal Memory',
  async ({ request }) => {
    const {
      scope,
      projectId,
      organizationId,
      kind,
      content,
      confidence,
      provenanceType,
      sourceConversationId,
      supersedesContent,
      salience,
      restrictedCollections,
      restrictionJudge,
      topic: rawTopic,
    } = await parseJsonBody(request, internalMemorySchema)

    if (restrictedCollections && scope !== 'project') {
      throw new BadRequestError('Restricted memory is project memory')
    }

    return withOptionalTenant(
      organizationId,
      'project-scoped agent memory addressed by project id; the project row names the tenant',
      async () => {
        if (scope === 'organization') {
          if (!agentOrgMemoryAllowed()) {
            console.warn(
              '[Internal Memory API] Rejected agent org-scoped write (ALLOW_AGENT_ORG_MEMORY not set)'
            )
            if (restrictionJudge && (await organizationExists(organizationId as string).catch(() => false))) {
              await recordRefusedMemoryJudgeVerdict(
                {
                  organizationId: organizationId as string,
                  provenanceType,
                  sourceConversationId: sourceConversationId ?? null,
                },
                restrictionJudge
              )
            }
            throw new OrgMemoryDisabledError('Agent organization-scoped memory is disabled')
          }
          const known = await organizationExists(organizationId as string)
          if (!known) {
            throw new NotFoundError('Unknown organization')
          }
        }

        const tenant = organizationId ?? (projectId ? (await findProjectTenancy(projectId))?.organizationId : null)
        await requireMayRememberFrom(sourceConversationId, tenant)
        await requireConversationKeepsMemory(sourceConversationId, tenant)
        const topic =
          rawTopic === undefined
            ? undefined
            : scope === 'project'
              ? await resolveTopicForAgentProjectWrite(projectId as string, rawTopic)
              : await resolveOfficeTopicForWrite(organizationId as string, rawTopic)

        const outcome: { supersededId: string | null } = { supersededId: null }
        const writeOptions = {
          supersedesContent,
          onSuperseded: (id: string) => {
            outcome.supersededId = id
          },
        }

        const item =
          scope === 'project'
            ? await createProjectMemoryItemForProject(
                projectId as string,
                {
                  kind,
                  content,
                  confidence,
                  sourceConversationId: sourceConversationId ?? null,
                  provenanceType,
                  ...(salience !== undefined ? { salience } : {}),
                  ...(restrictedCollections ? { restrictedCollections } : {}),
                  ...(restrictionJudge ? { restrictionJudge: restrictionJudge.verdict } : {}),
                  ...(topic === undefined ? {} : { topic }),
                },
                writeOptions
              )
            : await createProjectMemoryItem(
                {
                  scope: 'organization',
                  projectId: null,
                  organizationId: organizationId as string,
                  kind,
                  content,
                  confidence,
                  sourceConversationId: sourceConversationId ?? null,
                  provenanceType,
                  ...(salience !== undefined ? { salience } : {}),
                  ...(topic === undefined ? {} : { topic }),
                },
                writeOptions
              )

        if (!item) {
          throw new NotFoundError('Unknown project')
        }
        if (restrictionJudge) await recordMemoryJudgeVerdict(item, restrictionJudge)

        const created = item.createdAt.getTime() === item.updatedAt.getTime()
        return { item, supersededId: outcome.supersededId, created }
      }
    )
  },
  { status: 201, tenancy: { fromPayload: 'body.organizationId, else the project row' } }
)
