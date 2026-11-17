import { apiRoute } from '@/lib/api/handler'
import {
  createInboundMailAddress,
  deleteInboundMailAddress,
  getInboundMailAddress,
} from '@/lib/inbound-mail/address-service'

type Params = { id: string }

export const GET = apiRoute<Params>(async ({ session, params }) => getInboundMailAddress(session, params.id), {
  authz: { enforcedBy: 'getInboundMailAddress -> requireMailReviewer (inbound-mail entitlement; project:documents:write any-of project:edit)' },
})

export const POST = apiRoute<Params>(async ({ session, params }) => createInboundMailAddress(session, params.id), {
  authz: { enforcedBy: 'createInboundMailAddress -> requireAddressManager (inbound-mail entitlement; project:manage)' },
})

export const DELETE = apiRoute<Params>(async ({ session, params }) => deleteInboundMailAddress(session, params.id), {
  authz: { enforcedBy: 'deleteInboundMailAddress -> requireAddressManager (inbound-mail entitlement; project:manage)' },
})
