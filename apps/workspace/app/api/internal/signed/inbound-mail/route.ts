import { internalApiRoute } from '@/lib/api/handler'
import { ENVELOPE_FROM_HEADER, ENVELOPE_TO_HEADER } from '@/lib/inbound-mail/contract'
import { receiveInboundMail } from '@/lib/inbound-mail/receive'

export const POST = internalApiRoute('Inbound mail', ({ request, signature }) => receiveInboundMail({ request, signature }), {
  auth: { signature: { keysEnv: 'INBOUND_MAIL_SIGNING_KEYS', components: [ENVELOPE_TO_HEADER, ENVELOPE_FROM_HEADER] } },
  tenancy: { fromPayload: 'the project address the x-envelope-to token resolves to' },
})
