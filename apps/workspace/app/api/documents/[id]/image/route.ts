import { publicApiRoute } from '@/lib/api/handler'
import { streamDocumentImage } from '@/lib/documents/document-delivery'

type Params = { id: string }

export const GET = publicApiRoute<Params>(
  async ({ request, params }) =>
    streamDocumentImage(params.id, new URL(request.url).searchParams),
  {
    why:
      'Unauthenticated by necessity: the Next image optimizer fetches this route with a ' +
      'headerless internal request, so no session cookie can reach it. Authorization is the ' +
      'HMAC signature on the URL, minted by getDocumentPreview/getDocumentThumbnail only after ' +
      'getAccessibleDocument enforced project:view, and bound to org + document + variant + ' +
      'expiry. The route serves image content types only, and re-derives tenancy from the ' +
      'signed org claim rather than trusting the caller.',
  }
)
