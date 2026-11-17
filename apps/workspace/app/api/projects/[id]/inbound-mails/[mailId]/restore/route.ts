import { apiRoute } from '@/lib/api/handler'
import { restoreInboundMail } from '@/lib/inbound-mail/service'

type Params = { id: string; mailId: string }

export const POST = apiRoute<Params>(async ({ session, params }) => restoreInboundMail(session, params.id, params.mailId), {
  authz: { enforcedBy: 'restoreInboundMail -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit)' },
})
