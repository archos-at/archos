import { apiRoute } from '@/lib/api/handler'
import { cancelMailImport, resumeMailImportUpload } from '@/lib/mail-import/service'

type Params = { id: string; importId: string }

export const GET = apiRoute<Params>(
  ({ session, params }) => resumeMailImportUpload(session, params.id, params.importId),
  { authz: { enforcedBy: 'resumeMailImportUpload (requireShelfWrite project:documents:write, own import)' } },
)

export const DELETE = apiRoute<Params>(
  ({ session, params }) => cancelMailImport(session, params.id, params.importId),
  { authz: { enforcedBy: 'cancelMailImport (own import, or org:projects:administer)' } },
)
