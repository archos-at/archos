import { apiRoute } from '@/lib/api/handler'
import { releaseQuarantinedDocument } from '@/lib/upload-screening/review'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => releaseQuarantinedDocument(session, params.id, request),
  {
    authz: {
      enforcedBy:
        'releaseQuarantinedDocument -> mayReviewQuarantine (org:projects:administer | project:manage on the project | org:office_shelf:manage for the Büroablage)',
    },
  }
)
