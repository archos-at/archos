import { apiRoute, parseFormData } from '@/lib/api/handler'
import { DOCUMENT_UPLOAD_LIMIT } from '@/lib/limits'
import { BadRequestError } from '@/lib/api/errors'
import { uploadSessionDocument } from '@/lib/session-documents/service'
import { parseConversationId } from '@/lib/session-documents/conversation-id'
import { readScreeningRelease } from '@/lib/upload-screening/service'
import { readUploadBatchId } from '@/lib/upload-batches/service'

export const POST = apiRoute(
  async ({ session, request }) => {
    const formData = await parseFormData(request)
    const projectId = formData.get('projectId')
    const file = formData.get('file')
    const originPath = formData.get('originPath')

    const conversationId = parseConversationId(formData.get('conversationId'))

    if (!(file instanceof File)) {
      throw new BadRequestError('file is required')
    }

    return uploadSessionDocument(
      session,
      {
        conversationId,
        projectId: typeof projectId === 'string' && projectId ? projectId : null,
        file,
        screeningRelease: readScreeningRelease(formData.get('screeningRelease')),
        uploadBatchId: readUploadBatchId(formData.get('uploadBatchId')),
        originPath: typeof originPath === 'string' ? originPath : null,
      },
      request,
    )
  },
  {
    authz: {
      enforcedBy:
        'uploadSessionDocument (createConversation → requireResourceAccess conversation:collaborator, and project:view when a project is named)',
    },
    limits: { rule: DOCUMENT_UPLOAD_LIMIT },
  },
)
