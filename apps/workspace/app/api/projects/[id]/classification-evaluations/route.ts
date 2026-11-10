/**
 * Evaluate a building's class (ADR-0169): `POST { buildingId?, planned?,
 * existing?, on? }` → the class on the planned values and on the Bestand's,
 * the shift, and the document for every open input. A read; nothing is
 * written. Thin handler; the rules live in `@/lib/project-intake/classification`.
 */

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
