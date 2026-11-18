import { apiRoute } from '@/lib/api/handler'
import { readInboundMailPart } from '@/lib/inbound-mail/service'

type Params = { id: string; mailId: string; partId: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => readInboundMailPart(session, params.id, params.mailId, params.partId),
  { authz: { enforcedBy: 'readInboundMailPart -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit)' } },
)
