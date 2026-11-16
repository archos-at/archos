import type { ImpersonationBasis } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { InboundMailSummaryView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'

export interface ImpersonationWarning {
  basis: ImpersonationBasis
  name: string
  address: string
}

export function impersonationWarningOf(view: Pick<InboundMailView, 'riskLevel' | 'impersonation' | 'sender'>): ImpersonationWarning | null {
  if (view.riskLevel !== 'impersonation') return null
  const address = view.sender?.address ?? ''
  return {
    basis: view.impersonation ?? 'rejected_signature',
    name: view.sender?.name?.trim() || address,
    address,
  }
}

export function bulkSelectable(mail: Pick<InboundMailSummaryView, 'riskLevel'>): boolean {
  return mail.riskLevel !== 'impersonation'
}

export function guardImpersonation(view: InboundMailView): InboundMailView {
  if (view.riskLevel !== 'impersonation') return view
  if (view.parts.every((part) => part.suggestion === null && !part.preselected)) return view
  return { ...view, parts: view.parts.map((part) => ({ ...part, suggestion: null, preselected: false })) }
}
