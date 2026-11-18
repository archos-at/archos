import { apiRoute, parseQuery } from '@/lib/api/handler'
import { inboundMailListQuerySchema } from '@/lib/inbound-mail/inbound-mail-wire'
import { listInboundMails } from '@/lib/inbound-mail/service'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => listInboundMails(session, params.id, parseQuery(request, inboundMailListQuerySchema)),
  { authz: { enforcedBy: 'listInboundMails -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit)' } },
)
