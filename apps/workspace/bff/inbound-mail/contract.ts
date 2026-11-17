import { publicSiteOrigin } from '@/shared/public-site'

export const INBOUND_MAIL_WEBHOOK_PATH = '/api/internal/signed/inbound-mail'

export const ENVELOPE_TO_HEADER = 'x-envelope-to'

export const ENVELOPE_FROM_HEADER = 'x-envelope-from'

export const NULL_SENDER = '<>'

export function decodeEnvelopeAddress(header: string): string {
  return header === NULL_SENDER ? '' : decodeURIComponent(header)
}

export const VERDICT_HEADER = 'x-inbound-verdict'
export const VERDICT_REJECT = 'reject'

export const MAX_RAW_MESSAGE_BYTES = 26 * 1024 * 1024

export const SIGNED_COMPONENTS = [
  '@method',
  '@target-uri',
  'content-digest',
  'content-length',
  ENVELOPE_TO_HEADER,
  ENVELOPE_FROM_HEADER,
] as const

export const SIGNATURE_LIFETIME_SECONDS = 300

export const REJECT_TEXT_TEMPLATE =
  'This message could not be delivered: the address is unknown or no longer valid. ' +
  'Help: {site}/e-mail-eingang/ Privacy: {site}/datenschutz/'

export const SITE_PLACEHOLDER = '{site}'

export const REJECT_TEXT_WITHOUT_SITE = 'This message could not be delivered: the address is unknown or no longer valid.'

export function rejectText(site: string | null | undefined): string {
  const origin = publicSiteOrigin(site)
  return origin === null ? REJECT_TEXT_WITHOUT_SITE : REJECT_TEXT_TEMPLATE.split(SITE_PLACEHOLDER).join(origin)
}

export type DeliveryOutcome = 'accepted' | 'rejected' | 'retry'

export function deliveryOutcome(status: number, verdict: string | null): DeliveryOutcome {
  if (status >= 200 && status < 300) return 'accepted'
  if (status >= 400 && status < 500 && verdict === VERDICT_REJECT) return 'rejected'
  return 'retry'
}

export {
  DROPPED_REASONS,
  INBOUND_SENDER_TRUSTS,
  NOT_STAGED_REASONS,
  PART_RISK_FLAGS,
  SENDER_FLAGS,
  SENDER_REASONS,
  type DroppedReason,
  type InboundSenderTrust,
  type NotStagedReason,
  type PartRiskFlag,
  type SenderFlag,
  type SenderReason,
} from './inbound-mail-vocabulary'
