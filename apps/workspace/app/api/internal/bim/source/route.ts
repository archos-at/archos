import { z } from 'zod'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import {
  assertInternalIfcModelsEnabled,
  describeModel,
  getInternalModelSource,
  resolveInternalModel,
} from '@/lib/bim/internal-access'

const requestSchema = z
  .object({
    organizationId: z.string().min(1).max(255),
    projectId: z.guid().optional(),
    modelId: z.guid().optional(),
    modelName: z.string().trim().min(1).max(255).optional(),
  })
  .refine((value) => Boolean(value.projectId || value.modelId), {
    message: 'projectId or modelId is required',
  })

export const POST = internalApiRoute(
  'Internal BIM Source',
  async ({ request }) => {
    const { organizationId, projectId, modelId, modelName } = await parseJsonBody(
      request,
      requestSchema
    )

    await assertInternalIfcModelsEnabled(organizationId)

    const resolution = await resolveInternalModel({
      organizationId,
      projectId,
      modelId,
      modelName,
    })
    if (!resolution.resolved) return resolution

    const source = await getInternalModelSource(resolution.model, organizationId)
    return {
      resolved: true,
      model: {
        ...describeModel(resolution.model),
        schemaVersion: resolution.model.schemaVersion,
        updatedAt: resolution.model.updatedAt.toISOString(),
      },
      source,
    }
  },
  { tenancy: { fromPayload: 'body.organizationId' } }
)
