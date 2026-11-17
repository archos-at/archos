import type { InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'

const DAY_MS = 24 * 60 * 60 * 1000

export const EXPIRY_INLINE_DAYS = 7

export function expiryShownInline(view: Pick<InboundMailView, 'status' | 'expiresAt'>, now: number): boolean {
  if (view.status !== 'waiting') return false
  return new Date(view.expiresAt).getTime() - now < EXPIRY_INLINE_DAYS * DAY_MS
}
