import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { refuseLicensedFileForAgent } from '@/lib/base-knowledge/door-guard'
import { replaceVersionContent, toDocumentVersionView } from '@/lib/documents/lifecycle'
import { readVersionContent } from '@/lib/documents/version-content'
import { replaceContentRequestSchema } from '@/lib/documents/lifecycle-types'

type Params = { id: string; versionId: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => {
    await refuseLicensedFileForAgent(session, params.id)
    return new Response(await readVersionContent(session, params.id, params.versionId), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline',
      },
    })
  },
  {
    authz: {
      enforcedBy:
        'readVersionContent -> getAccessibleDocument (project:view | org membership | conversation viewer)',
    },
  }
)

export const PUT = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { content, ifMatch } = await parseJsonBody(request, replaceContentRequestSchema)
    const version = await replaceVersionContent(
      session,
      params.id,
      params.versionId,
      content,
      ifMatch,
      { request },
    )
    return { version: toDocumentVersionView(version) }
  },
  {
    authz: {
      enforcedBy:
        'replaceVersionContent -> getAccessibleDocument + requireProjectAccess (project:documents:write | project:edit, AND project:documents:generate)',
    },
  }
)
