'use client'

/**
 * The E-Mail-Eingang's header action: the project's address itself.
 *
 * The first thing a person comes here for, after the mail, is the address to
 * put in Cc. So the header shows it, and a press copies it; „Mehr“ beside it
 * opens the dialog with what it is for, the contact card and the size limit.
 * Without an address, a manager reads „Adresse erzeugen“ (the dialog, which
 * says what it is for before anything is made); a member reads nothing here,
 * the empty list says whom to ask. The way back to Dateien is the section
 * frame's breadcrumb, not a button of its own.
 */

import type { JSX } from 'react'
import { Info, MailPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyableValue } from '@/components/ui/copyable-value'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { capturePosthog } from '@/lib/analytics/posthog'
import type { AddressState } from '../hooks/use-inbound-mail-address'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export function InboundMailHeaderActions({ state, onOpenAddress }: { state: AddressState; onOpenAddress: () => void }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  if (state.kind === 'loading') return <Skeleton className="h-8 w-56" aria-hidden />
  if (state.kind === 'error') return null
  const { address } = state
  if (address.state === 'active' && address.address) {
    const value = address.address
    return (
      <div className="flex min-w-0 items-center gap-1" data-testid="inbound-mail-header-address">
        <CopyableValue
          value={value}
          className="text-foreground border-border bg-card h-8 min-w-0 items-center rounded-md border px-2.5 font-mono text-xs [&>span]:truncate"
          onCopied={() => capturePosthog('inbound_mail_address_copied', { surface: 'header' })}
        >
          {value}
        </CopyableValue>
        <Button type="button" variant="ghost" size="sm" onClick={onOpenAddress} data-testid="inbound-mail-address-open">
          <Info className="size-4" aria-hidden />
          {t('header.addressMore')}
        </Button>
      </div>
    )
  }
  if (address.state === 'none' && address.canManage) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={onOpenAddress} data-testid="inbound-mail-address-open">
        <MailPlus className="size-4" aria-hidden />
        {t('address.create')}
      </Button>
    )
  }
  return null
}
