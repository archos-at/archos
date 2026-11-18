import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { planDocumentSchema } from '@/lib/runs/plan-documents'
import { addRunDocument } from '@/lib/runs/service'
import { getLocale } from '@/i18n/server'

type Params = { id: string; runId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const document = await parseJsonBody(request, planDocumentSchema)
    return addRunDocument(session, params.id, params.runId, document, await getLocale())
  },
  {
    authz: {
      enforcedBy:
        'addRunDocument (requireProjectAccess project:view + CHAT_PERMISSIONS; requirePlanDocumentsOpen refuses a restricted-folder document)',
    },
  }
)
