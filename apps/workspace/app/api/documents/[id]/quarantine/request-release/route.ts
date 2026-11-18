import { apiRoute } from '@/lib/api/handler'
import { requestQuarantineRelease } from '@/lib/upload-screening/review'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => requestQuarantineRelease(session, params.id),
  {
    authz: {
      enforcedBy:
        'requestQuarantineRelease -> getAccessibleDocument (the shelf rule; a quarantined file only for its uploader or a reviewer) and createdBy = the session',
    },
  }
)
