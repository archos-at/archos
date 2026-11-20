import type { InboundMailSummaryView } from '@/lib/inbound-mail/inbound-mail-wire'

export function isQuietMail(mail: Pick<InboundMailSummaryView, 'automatic' | 'riskLevel'>): boolean {
  return mail.automatic && mail.riskLevel !== 'impersonation'
}

export function waitingShownCount(mails: readonly Pick<InboundMailSummaryView, 'status' | 'automatic' | 'riskLevel'>[]): number {
  return mails.filter((mail) => mail.status === 'waiting' && !isQuietMail(mail)).length
}
