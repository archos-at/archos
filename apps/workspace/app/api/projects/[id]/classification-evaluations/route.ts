import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { evaluateProjectClassification } from '@/lib/project-intake/classification'
import { classificationEvaluateRequestSchema, type ClassificationEvaluation } from '@/lib/project-intake/classification-wire'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }): Promise<ClassificationEvaluation> => {
    const body = await parseJsonBody(request, classificationEvaluateRequestSchema)
    return evaluateProjectClassification(session, params.id, body)
  },
  { authz: { enforcedBy: 'evaluateProjectClassification (requireProjectAccess project:view)' } }
)
