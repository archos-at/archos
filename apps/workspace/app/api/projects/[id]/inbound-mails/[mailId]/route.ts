import { apiRoute } from '@/lib/api/handler'
import { getInboundMail } from '@/lib/inbound-mail/service'

type Params = { id: string; mailId: string }

export const GET = apiRoute<Params>(async ({ session, params }) => getInboundMail(session, params.id, params.mailId), {
  authz: { enforcedBy: 'getInboundMail -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit)' },
})
