import { ApiRequestError } from '@/adapters/api/api-error'
import { INBOUND_MAIL_REFUSALS, type InboundMailRefusal } from '@/lib/inbound-mail/inbound-mail-wire'

export type RefusalCode = InboundMailRefusal | 'unknown'

export function refusalOf(error: unknown): RefusalCode {
  if (!(error instanceof ApiRequestError) || !error.reason) return 'unknown'
  return (INBOUND_MAIL_REFUSALS as readonly string[]).includes(error.reason) ? (error.reason as InboundMailRefusal) : 'unknown'
}

export function refusalTerms(error: unknown): string[] {
  if (!(error instanceof ApiRequestError) || error.reason !== 'name_stop') return []
  const terms = error.details?.terms
  return Array.isArray(terms) ? terms.filter((term): term is string => typeof term === 'string' && term.trim() !== '') : []
}

export function refusalNeedsReload(code: RefusalCode): boolean {
  return code === 'stale' || code === 'part_not_waiting' || code === 'part_unknown' || code === 'gone'
}
