import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { decideQuarantinedDocuments } from '@/lib/upload-screening/decisions'
import { quarantineDecisionsSchema } from '@/lib/upload-screening/decisions-wire'

export const POST = apiRoute(
  async ({ session, request }) =>
    decideQuarantinedDocuments(
      session,
      await parseJsonBody(request, quarantineDecisionsSchema),
      request
    ),
  {
    authz: {
      enforcedBy:
        'decideQuarantinedDocuments, per document: allow -> releaseQuarantinedDocument (mayReviewQuarantine and the folder write); delete -> getAccessibleDocument, mayReviewQuarantine, then the shelf delete (deleteDocument | deleteSessionDocument)',
    },
  }
)
