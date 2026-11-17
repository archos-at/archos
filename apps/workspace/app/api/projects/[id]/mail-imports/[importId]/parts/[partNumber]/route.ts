import { apiRoute } from '@/lib/api/handler'
import { DOCUMENT_UPLOAD_LIMIT } from '@/lib/limits'
import { putMailImportPart } from '@/lib/mail-import/service'

type Params = { id: string; importId: string; partNumber: string }

export const PUT = apiRoute<Params>(
  ({ session, params, request }) =>
    putMailImportPart(session, params.id, params.importId, Number(params.partNumber), request),
  {
    authz: { enforcedBy: 'putMailImportPart (requireShelfWrite project:documents:write, own import)' },
    limits: { rule: DOCUMENT_UPLOAD_LIMIT },
  },
)
