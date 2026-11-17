import { apiRoute, parseFormData } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { DOCUMENT_UPLOAD_LIMIT } from '@/lib/limits'
import { uploadBaseKnowledge } from '@/lib/base-knowledge/office/service'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'

export const POST = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      const formData = await parseFormData(request)
      const file = formData.get('file')
      if (!(file instanceof File)) throw new BadRequestError('file is required')
      const folderId = formData.get('folderId')
      return uploadBaseKnowledge(session, file, request, { folderId: typeof folderId === 'string' && folderId ? folderId : null })
    }),
  {
    authz: { enforcedBy: 'uploadBaseKnowledge (canManageOfficeShelf)' },
    limits: { rule: DOCUMENT_UPLOAD_LIMIT },
  }
)
