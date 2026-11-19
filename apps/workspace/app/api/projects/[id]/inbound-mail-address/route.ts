import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import {
  createInboundMailAddress,
  deleteInboundMailAddress,
  getInboundMailAddress,
  setInboundMailForwardedFrom,
} from '@/lib/inbound-mail/address-service'
import { inboundMailForwardedFromBodySchema } from '@/lib/inbound-mail/forwarding-addresses'

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

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) =>
    setInboundMailForwardedFrom(session, params.id, await parseJsonBody(request, inboundMailForwardedFromBodySchema)),
  { authz: { enforcedBy: 'setInboundMailForwardedFrom -> requireAddressManager (inbound-mail entitlement; project:manage)' } },
)
