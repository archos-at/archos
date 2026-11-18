import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { formatCitationsSchema } from '@/lib/citations/citation-wire'
import { renderCitations } from '@/lib/citations/render'

export const POST = apiRoute(
  async ({ request }) => {
    const { format, items } = await parseJsonBody(request, formatCitationsSchema)
    return { text: await renderCitations(items, format) }
  },
  {
    authz: {
      sessionOnly: true,
      why: 'pure formatting of citation text supplied in the request body; reads no stored data',
    },
  }
)
