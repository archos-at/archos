import { apiRoute, parseFormData } from '@/lib/api/handler'
import { DOCUMENT_UPLOAD_LIMIT } from '@/lib/limits'
import { BadRequestError } from '@/lib/api/errors'
import { readRevisionOf } from '@/lib/documents/revision-upload'
import { uploadDocument } from '@/lib/documents/document-dispatch'
import { SHELF_SCOPES, shelfOf } from '@/lib/documents/shelf-scope'
import { uploadToOfficeShelf } from '@/lib/base-knowledge/office/norm-intake'
import { announceNormReadingAtUpload } from '@/lib/base-knowledge/office/upload-reading-event'
import { readScreeningRelease } from '@/lib/upload-screening/service'
import { readUploadBatchId } from '@/lib/upload-batches/service'

const text = (value: FormDataEntryValue | null): string | undefined =>
  typeof value === 'string' && value ? value : undefined

export const POST = apiRoute(
  async ({ session, request }) => {
    const formData = await parseFormData(request)
    const file = formData.get('file')
    if (!(file instanceof File)) throw new BadRequestError('file is required')
    const scope = text(formData.get('scope'))
    if (scope !== undefined && !(SHELF_SCOPES as readonly string[]).includes(scope)) {
      throw new BadRequestError(`scope must be one of ${SHELF_SCOPES.join(', ')}`)
    }
    const shelf = shelfOf({ scope: scope as (typeof SHELF_SCOPES)[number] | undefined, projectId: text(formData.get('projectId')) }, request)
    const input = {
      folderId: text(formData.get('folderId')) ?? null,
      originPath: text(formData.get('originPath')) ?? null,
      screeningRelease: readScreeningRelease(formData.get('screeningRelease')),
      uploadBatchId: readUploadBatchId(formData.get('uploadBatchId')),
      revisionOf: readRevisionOf(formData.get('revisionOf') ?? formData.get('fassungOf')),
    }
    const uploaded =
      shelf.kind === 'project'
        ? await uploadDocument(session, { projectId: shelf.projectId, file, ...input }, request)
        : await uploadToOfficeShelf(session, file, request, input)
    announceNormReadingAtUpload(session, {
      shelf: shelf.kind === 'project' ? 'project' : 'office_shelf',
      fileName: file.name,
      uploadId: input.uploadBatchId,
      revisionOf: input.revisionOf,
    })
    return uploaded
  },
  {
    authz: {
      enforcedBy:
        'uploadDocument (requireProjectAccess project:documents:write) | uploadToOfficeShelf → uploadOfficeShelfDocument (canManageOfficeShelf)',
    },
    limits: { rule: DOCUMENT_UPLOAD_LIMIT },
  }
)
