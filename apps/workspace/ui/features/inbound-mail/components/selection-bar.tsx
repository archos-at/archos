'use client'

import type { JSX } from 'react'
import { useId } from 'react'
import { CircleAlert, X } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { cn } from '@/lib/utils'
import type { IncompleteReason } from '@/lib/inbound-mail/inbound-mail-wire'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export type BulkBlock = { reason: IncompleteReason | 'too_many'; count: number } | null

export interface SelectionBarProps {
  count: number
  block: BulkBlock
  max: number
  filing: boolean
  dismissing: boolean
  onFile: () => void
  onDismiss: () => void
  onClear: () => void
  className?: string
}

export function SelectionBar({ count, block, max, filing, dismissing, onFile, onDismiss, onClear, className }: SelectionBarProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const whyId = useId()
  const reason = block ? t(`bulk.blocked.${block.reason}`, { count: block.count, max }) : null
  return (
    <div
      role="toolbar"
      aria-label={t('bulk.selected', { count })}
      data-testid="inbound-mail-selection-bar"
      className={cn(
        'flex flex-col gap-1.5',
        'animate-in fade-in-0 slide-in-from-bottom-1 duration-base ease-entrance motion-reduce:animate-none',
        className
      )}
    >
      {/* Two rows on purpose: the list is 22rem, and the count, the reason and both actions in one row wrapped one button alone. */}
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" className="-ml-2 size-8" aria-label={t('bulk.clear')} onClick={onClear} data-testid="selection-clear">
          <X className="size-4" aria-hidden />
        </Button>
        <span className="text-sm font-medium tabular-nums">{t('bulk.selected', { count })}</span>
      </div>
      {/* Why „Ablegen“ is off is said in words under the count: behind a 16px ⓘ a finger never found it. */}
      {reason && (
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs text-pretty" id={whyId} data-testid="selection-why">
          <CircleAlert className="text-warning mt-px size-3.5 shrink-0" aria-hidden />
          <span>{reason}</span>
        </p>
      )}
      {/* The secondary, then the primary at the end, 12px apart, as in Dateien's selection bar and the decision bar. */}
      <div className="flex items-center gap-3">
        <BusyButton
          type="button"
          size="sm"
          variant="secondary"
          busy={dismissing}
          busyLabel={t('bar.dismissBusy')}
          blocked={filing}
          onClick={onDismiss}
          data-testid="selection-dismiss"
        >
          {t('bulk.dismiss')}
        </BusyButton>
        <BusyButton
          type="button"
          size="sm"
          busy={filing}
          busyLabel={t('bulk.fileSuggestedBusy')}
          blocked={dismissing}
          disabled={block !== null}
          aria-describedby={reason ? whyId : undefined}
          onClick={onFile}
          className="min-w-0 flex-1"
          data-testid="selection-file"
        >
          {t('bulk.fileSuggested')}
        </BusyButton>
      </div>
    </div>
  )
}
