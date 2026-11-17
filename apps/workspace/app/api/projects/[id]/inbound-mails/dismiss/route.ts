import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { dismissInboundMailsBodySchema } from '@/lib/inbound-mail/inbound-mail-wire'
import { dismissInboundMails } from '@/lib/inbound-mail/service'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) =>
    dismissInboundMails(session, params.id, await parseJsonBody(request, dismissInboundMailsBodySchema)),
  { authz: { enforcedBy: 'dismissInboundMails -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit)' } },
)
