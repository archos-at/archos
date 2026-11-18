'use client'

import type { JSX } from 'react'
import { Check, Copy, Info, MailPlus, MoreHorizontal } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { capturePosthog } from '@/lib/analytics/posthog'
import type { AddressState } from '../hooks/use-inbound-mail-address'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export function InboundMailHeaderActions({
  state,
  onOpenAddress,
  compact = false,
}: {
  state: AddressState
  onOpenAddress: () => void
  compact?: boolean
}): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const [copied, raise] = useTransientFlag()
  if (state.kind === 'loading') return <Skeleton className="h-8 w-56" aria-hidden />
  if (state.kind === 'error') return null
  const { address } = state
  if (address.state === 'active' && address.address) {
    const value = address.address
    const copy = () =>
      void navigator.clipboard?.writeText(value).then(() => {
        raise()
        capturePosthog('inbound_mail_address_copied', { surface: 'header' })
      }, () => {})
    if (compact) {
      return (
        <>
          <ActionMenu
            mode="dropdown"
            align="end"
            trigger={
              <Button type="button" variant="ghost" size="icon" aria-label={t('header.addressMenu')} data-testid="inbound-mail-address-menu">
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            }
            entries={[
              { type: 'item', id: 'copy', label: t('header.addressCopy'), icon: Copy, onSelect: copy, testId: 'inbound-mail-address-copy' },
              { type: 'item', id: 'more', label: t('header.addressMore'), icon: Info, onSelect: onOpenAddress, testId: 'inbound-mail-address-open' },
            ]}
          />
          <span className="sr-only" role="status" aria-live="polite">
            {copied ? t('header.addressCopied') : ''}
          </span>
        </>
      )
    }
    return (
      <div className="flex min-w-0 items-center gap-3" data-testid="inbound-mail-header-address">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={copy}
          data-testid="inbound-mail-address-copy"
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {t(copied ? 'header.addressCopied' : 'header.addressCopy')}
        </Button>
        <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={onOpenAddress} data-testid="inbound-mail-address-open">
          <Info className="size-4" aria-hidden />
          {t('header.addressMore')}
        </Button>
        <span className="sr-only" role="status" aria-live="polite">
          {copied ? t('header.addressCopied') : ''}
        </span>
      </div>
    )
  }
  if (address.state === 'none' && address.canManage) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={onOpenAddress} data-testid="inbound-mail-address-open">
        <MailPlus className="size-4" aria-hidden />
        {t('address.create')}
      </Button>
    )
  }
  return null
}
