import { apiRoute, parseFormData } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { DOCUMENT_UPLOAD_LIMIT } from '@/lib/limits'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { addBaseKnowledgeEdition } from '@/lib/base-knowledge/office/new-edition'

type Params = { entryId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      const file = (await parseFormData(request)).get('file')
      if (!(file instanceof File)) throw new BadRequestError('file is required')
      return addBaseKnowledgeEdition(session, params.entryId, file, request)
    }),
  {
    authz: { enforcedBy: 'addBaseKnowledgeEdition → uploadBaseKnowledge (canManageOfficeShelf)' },
    limits: { rule: DOCUMENT_UPLOAD_LIMIT },
    status: 201,
  },
)
