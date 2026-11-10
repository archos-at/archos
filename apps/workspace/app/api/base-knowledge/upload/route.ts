/**
 * Upload a file to the office shelf as base knowledge (ADR-0158): stored, and
 * proposed from its file name, with its text held until a person confirms the
 * copy public or attested. Nothing embeds, summarises or facets it before. Use
 * this, not the plain office shelf upload, for a standard, commentary or
 * directive: the plain upload reads the file at once. Multipart: `file`, and
 * the optional `folderId`.
 *
 * Needs org:office_shelf:manage, checked in `@/lib/base-knowledge/office/service`.
 */

import { apiRoute, parseFormData } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { DOCUMENT_UPLOAD_LIMIT } from '@/lib/limits'
import { uploadBaseKnowledge } from '@/lib/base-knowledge/office/service'
import { asProblem } from '@/lib/base-knowledge/http/problem'

export const POST = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => {
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
