import { apiRoute } from '@/lib/api/handler'
import { getUploadSummary } from '@/lib/upload-batches/service'

type Params = { id: string }

export const GET = apiRoute<Params>(async ({ session, params }) => getUploadSummary(session, params.id), {
  authz: { enforcedBy: 'getUploadSummary -> findOwnUploadBatch (the uploader only, within the organization)' },
})
