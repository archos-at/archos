import { z } from 'zod'
import { captureServer } from '@/lib/analytics/posthog-server'
import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import { bimQuerySchema, runBimQuery, BimModelNotReadyError } from '@/lib/bim/query'
import {
  assertInternalIfcModelsEnabled,
  describeModel,
  resolveInternalModel,
} from '@/lib/bim/internal-access'
import { modelShelf } from '@/lib/bim/model-shelf'

const requestSchema = z
  .object({
    organizationId: z.string().min(1).max(255),
    projectId: z.guid().optional(),
    modelId: z.guid().optional(),
    modelName: z.string().trim().min(1).max(255).optional(),
    compareWithName: z.string().trim().min(1).max(255).optional(),
    query: bimQuerySchema,
  })
  .refine((value) => Boolean(value.projectId || value.modelId), {
    message: 'projectId or modelId is required',
  })

export const POST = internalApiRoute(
  'Internal BIM Query',
  async ({ request }) => {
    const { organizationId, projectId, modelId, modelName, compareWithName, query } =
      await parseJsonBody(request, requestSchema)

    await assertInternalIfcModelsEnabled(organizationId)

    const resolution = await resolveInternalModel({
      organizationId,
      projectId,
      modelId,
      modelName,
    })
    if (!resolution.resolved) return resolution
    const { model: selected, readable } = resolution

    let resolvedQuery = query
    if (query.op === 'compliance-diff' || query.op === 'compare') {
      if (!compareWithName) {
        return {
          resolved: false,
          reason: 'compare_target_missing',
          message: 'Für einen Vergleich muss die zweite Revision benannt werden.',
          models: readable.map(describeModel),
        }
      }
      const needle = compareWithName.toLowerCase()
      const matches = readable.filter(
        (candidate) =>
          candidate.id !== selected.id && candidate.filename.toLowerCase().includes(needle)
      )
      if (matches.length !== 1) {
        return {
          resolved: false,
          reason: matches.length === 0 ? 'no_match' : 'ambiguous',
          message:
            matches.length === 0
              ? `Keine zweite Revision mit dem Namen „${compareWithName}“ gefunden.`
              : `Mehrere Revisionen passen auf „${compareWithName}“. Bitte eindeutig benennen.`,
          models: readable.map(describeModel),
        }
      }
      resolvedQuery = { ...query, baseModelId: matches[0].id }
    }

    const announce = (ok: boolean): void => {
      captureServer({
        event: 'bim_query_executed',
        distinctId: null,
        organizationId,
        properties: { kind: query.op, ok },
      })
    }

    try {
      const result = await runBimQuery(resolvedQuery, { modelId: selected.id, organizationId })
      announce(true)
      return {
        resolved: true,
        ...result,
        selection: {
          shelf: modelShelf(selected),
          projectId: selected.projectId,
          projectHasOwnModel: readable.some((model) => modelShelf(model) === 'project'),
        },
      }
    } catch (error) {
      announce(false)
      if (error instanceof BimModelNotReadyError) {
        return {
          resolved: false,
          reason: error.modelStatus === 'failed' ? 'extraction_failed' : 'not_ready',
          message: error.message,
          models: [describeModel(selected)],
        }
      }
      throw error
    }
  },
  { tenancy: { fromPayload: 'body.organizationId' } }
)
