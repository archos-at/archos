'use client'

import type { JSX } from 'react'
import { Chip, type ChipProps } from '@/components/ui/chip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { BaseKnowledgeEntry } from '@/lib/base-knowledge/wire'
import { isSuperseded, standFromBinding, standOf, type EntryStand } from '@/lib/base-knowledge/office/listing'

export const day = (iso: string, locale: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso).toLocaleDateString(locale === 'de' ? 'de-AT' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

export const superseded = isSuperseded

export function EntryName({ entry }: { entry: BaseKnowledgeEntry }): JSX.Element {
  const { designation, title } = entry.values
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-medium" data-testid="base-knowledge-entry-name">
        {designation ?? title}
      </span>
      <span className="text-muted-foreground truncate text-xs">
        {designation ? title : entry.fileName}
      </span>
    </span>
  )
}

function Explained({ hint, children }: { hint: string; children: JSX.Element }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-64">{hint}</TooltipContent>
    </Tooltip>
  )
}

const STAND_VARIANT: Record<EntryStand, ChipProps['variant']> = {
  proposed: 'info',
  superseded: 'muted',
  current: 'success',
  newer_edition: 'info',
  checked: 'outline',
  check_due: 'muted',
}

const STAND_LABEL = {
  proposed: 'status.proposed',
  superseded: 'status.superseded',
  current: 'status.current',
  newer_edition: 'status.newerEdition',
  checked: 'status.checkedOn',
  check_due: 'status.checkDue',
} as const satisfies Record<EntryStand, string>

export function StatusChip({ entry }: { entry: BaseKnowledgeEntry }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const { locale } = useLocale()
  const stand = standOf(entry)
  const hinted = standFromBinding(entry) && (stand === 'current' || stand === 'newer_edition')
  const checkedAt = entry.freshness.lastCheck?.checkedAt
  const chip = (
    <Chip size="sm" variant={STAND_VARIANT[stand]} tabIndex={hinted ? 0 : undefined} data-testid="base-knowledge-status" data-stand={stand}>
      {t(STAND_LABEL[stand], { date: checkedAt ? day(checkedAt, locale) : '' })}
    </Chip>
  )
  if (!hinted || !entry.binding) return chip
  const via = viaOf(entry.binding)
  const hint = via ? t('status.bindingHintVia', { label: entry.binding.editionLabel, via }) : t('status.bindingHint', { label: entry.binding.editionLabel })
  return <Explained hint={hint}>{chip}</Explained>
}

export function TextUseChip({ entry }: { entry: BaseKnowledgeEntry }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const state =
    entry.status === 'proposed'
      ? 'held'
      : entry.textUse === 'metadata_only'
        ? 'metadataOnly'
        : 'used'
  return (
    <Explained hint={t(`text.${state}Hint`)}>
      <Chip
        size="sm"
        variant={state === 'used' ? 'outline' : 'muted'}
        tabIndex={0}
        data-testid="base-knowledge-text-use"
      >
        {t(`text.${state}`)}
      </Chip>
    </Explained>
  )
}

export function viaOf(binding: NonNullable<BaseKnowledgeEntry['binding']>): string | null {
  return [binding.via?.designation, binding.via?.editionLabel].filter(Boolean).join(' ') || null
}

export function CurrencyNote({ entry }: { entry: BaseKnowledgeEntry }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const { locale } = useLocale()
  const { binding } = entry
  const lastCheck = entry.freshness.lastCheck
  const via = binding ? viaOf(binding) : null
  return (
    <span className="text-muted-foreground flex flex-col text-xs" data-testid="base-knowledge-currency">
      {binding && (
        <span data-testid="base-knowledge-currency-binding">
          {via ? t('currency.bindingVia', { label: binding.editionLabel, via }) : t('currency.binding', { label: binding.editionLabel })}
        </span>
      )}
      {!standFromBinding(entry) && (
        <span data-testid="base-knowledge-currency-check">
          {lastCheck
            ? t('currency.checked', { date: day(lastCheck.checkedAt, locale), result: t(`detail.checkResult.${lastCheck.result}`) })
            : t('currency.unchecked', { months: Math.round(entry.freshness.intervalDays / 30.4) })}
        </span>
      )}
    </span>
  )
}
