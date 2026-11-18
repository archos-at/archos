import { apiRoute } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import { refuseLicensedFileForAgent } from '@/lib/base-knowledge/door-guard'
import { getDocumentVersionView } from '@/lib/documents/lifecycle'
import { readVersionContent } from '@/lib/documents/version-content'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!from || !to) throw new BadRequestError('from and to are required')
    await refuseLicensedFileForAgent(session, params.id)

    const [fromVersion, toVersion, fromContent, toContent] = await Promise.all([
      getDocumentVersionView(session, params.id, from),
      getDocumentVersionView(session, params.id, to),
      readVersionContent(session, params.id, from),
      readVersionContent(session, params.id, to),
    ])
    return {
      from: { version: fromVersion, content: fromContent },
      to: { version: toVersion, content: toContent },
    }
  },
  { authz: { enforcedBy: 'getDocumentVersionView / readVersionContent -> getAccessibleDocument (project:view | org membership | conversation viewer)' } }
)
