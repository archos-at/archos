'use client'

import type { JSX } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useTranslations } from '@/i18n'
import type { ImpersonationWarning as Warning } from '../lib/impersonation'
import { FraudReport, type FraudReportProps } from './fraud-report'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export type ReportOffer = Omit<FraudReportProps, 'name' | 'own'>

export function ImpersonationWarning({ warning, own = false, report }: { warning: Warning; own?: boolean; report?: ReportOffer | null }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const title =
    own && warning.basis === 'rejected_signature'
      ? t('impersonationWarning.own')
      : warning.basis === 'member_name'
        ? t('impersonationWarning.memberName', { name: warning.name, address: warning.address })
        : t('impersonationWarning.rejectedSignature', { name: warning.name })
  return (
    <Alert
      className="border-danger [&>svg]:text-error"
      data-testid="impersonation-warning"
      data-basis={warning.basis}
      data-own={own || undefined}
    >
      <ShieldAlert aria-hidden />
      <AlertTitle className="line-clamp-none font-medium [overflow-wrap:anywhere]">{title}</AlertTitle>
      <AlertDescription className="text-foreground">{t(own ? 'impersonationWarning.ownConsequence' : 'impersonationWarning.consequence')}</AlertDescription>
      {report && <FraudReport {...report} name={warning.name} own={own} />}
    </Alert>
  )
}
