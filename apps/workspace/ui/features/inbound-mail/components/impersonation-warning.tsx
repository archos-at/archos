'use client'

/**
 * The warning above a held mail that reads as someone posing as another
 * (`riskLevel: 'impersonation'`): a full-width `Alert` before the header,
 * before anything can be checked, so the first thing read about „Dringend:
 * Kontoänderung Honorarnote“ under a colleague's name is that it is not
 * theirs.
 *
 * It says why (a signature the domain rejected, or a member's name on an
 * address that is not theirs) and what follows: The agent suggests nothing,
 * nothing is pre-selected, and a payment or bank change is checked by phone,
 * never by replying. No dismiss: the one yes is the bar's acknowledgement.
 *
 * The member whose own address a rejected mail carries reads it in their own
 * voice (`own`): „Diese E-Mail trägt Ihre Adresse, aber Ihre Domain hat sie
 * abgelehnt“, and to dismiss it unless they sent it. Telling Miriam that
 * someone poses as Miriam, beside „Haben Sie sie gesendet?“, taught the one
 * click a forger wants.
 *
 * A stop, not a caution: the signal red on the glyph and on the Alert's full
 * hairline (`border-danger`), the words in ink. No rule down its leading edge:
 * the owner prefers boxes without side stripes (`design-language.md`,
 * „Emphasis without a stripe“, 2026-10-27). Not the kit's `Alert variant="destructive"`, whose red
 * text on its tint measures 4.08:1 (axe, 2026-10-22), under the 4.5:1 WCAG
 * AA asks; for the same reason no gold either (`design-language.md`,
 * „Warning gold is a glyph colour“).
 */

import type { JSX } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useTranslations } from '@/i18n'
import type { ImpersonationWarning as Warning } from '../lib/impersonation'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export function ImpersonationWarning({ warning, own = false }: { warning: Warning; own?: boolean }): JSX.Element {
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
    </Alert>
  )
}
