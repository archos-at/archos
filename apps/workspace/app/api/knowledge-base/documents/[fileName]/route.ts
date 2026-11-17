import { apiRoute } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { streamKnowledgeBaseDocumentFor } from '@/lib/knowledge/released-corpus'

export const GET = apiRoute<{ fileName?: string }>(
  async ({ params, session }) => {
    const fileName = typeof params.fileName === 'string' ? params.fileName : ''
    if (!fileName) throw new BadRequestError('Missing file name')
    return streamKnowledgeBaseDocumentFor(session, fileName)
  },
  {
    authz: {
      sessionOnly: true,
      why: 'needs no permission: every member reads the base corpus. Which file is decided in the service, by the office’s entitled countries and the file’s release mark (lib/knowledge/released-corpus.ts)',
    },
  }
)
