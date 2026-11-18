import { apiRoute } from '@/lib/api/handler'
import { readInboundMailOriginal } from '@/lib/inbound-mail/service'
import { MAIL_ORIGINAL_DOWNLOAD_LIMIT } from '@/lib/limits/catalog'

type Params = { id: string; mailId: string }

export const GET = apiRoute<Params>(async ({ session, params }) => readInboundMailOriginal(session, params.id, params.mailId), {
  authz: {
    enforcedBy: 'readInboundMailOriginal -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit)',
  },
  limits: { rule: MAIL_ORIGINAL_DOWNLOAD_LIMIT },
})
