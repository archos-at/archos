import { apiRoute } from '@/lib/api/handler'
import { getInboundMailText } from '@/lib/inbound-mail/service'

type Params = { id: string; mailId: string }

export const GET = apiRoute<Params>(async ({ session, params }) => getInboundMailText(session, params.id, params.mailId), {
  authz: { enforcedBy: 'getInboundMailText -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit)' },
})
