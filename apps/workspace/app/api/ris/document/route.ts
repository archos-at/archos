import { apiRoute, parseQuery } from '@/lib/api/handler'
import { RIS_DOCUMENT_LIMIT } from '@/lib/limits/catalog'
import { NotFoundError, UpstreamError } from '@/lib/api/errors'
import { risDocumentQuerySchema } from '@/lib/ris/document-wire'
import { fetchRisDocument, RisDocumentUnavailableError } from '@/lib/ris/document'

export const GET = apiRoute(
  async ({ request }) => {
    const { reference, application, passage } = parseQuery(request, risDocumentQuerySchema)
    try {
      return await fetchRisDocument(reference, application, passage)
    } catch (error) {
      if (error instanceof RisDocumentUnavailableError) {
        if (error.status === 404) throw new NotFoundError(error.message)
        throw new UpstreamError(error.message)
      }
      throw new UpstreamError('RIS is not reachable right now')
    }
  },
  {
    limits: { rule: RIS_DOCUMENT_LIMIT },
    authz: {
      sessionOnly: true,
      why: 'reads a public RIS page through the agent’s host-allow-listed client — no tenant resource to authorize against, only an origin that must not be a free fetcher for the internet',
    },
  }
)
