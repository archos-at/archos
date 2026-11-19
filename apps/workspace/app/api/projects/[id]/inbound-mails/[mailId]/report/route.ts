import { apiRoute } from '@/lib/api/handler'
import { reportInboundMail } from '@/lib/inbound-mail/report'

type Params = { id: string; mailId: string }

export const POST = apiRoute<Params>(async ({ session, params }) => reportInboundMail(session, params.id, params.mailId), {
  authz: { enforcedBy: 'reportInboundMail -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit), as dismissing' },
})
