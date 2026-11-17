import { apiRoute } from '@/lib/api/handler'
import { rotateInboundMailAddress } from '@/lib/inbound-mail/address-service'

type Params = { id: string }

export const POST = apiRoute<Params>(async ({ session, params }) => rotateInboundMailAddress(session, params.id), {
  authz: { enforcedBy: 'rotateInboundMailAddress -> requireAddressManager (inbound-mail entitlement; project:manage)' },
})
