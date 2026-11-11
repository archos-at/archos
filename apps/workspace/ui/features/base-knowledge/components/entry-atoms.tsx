'use client'

/**
 * The atoms an office standard is shown with, in the list and in its sheet:
 * its name (designation first, as it is cited), its status, what happens to
 * its text, and its last check. Each chip carries a tooltip that says what the
 * state means for the answers, so a person learns the vocabulary where it is
 * used rather than from a help page.
 */

import type { JSX } from 'react'
import { Chip } from '@/components/ui/chip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { BaseKnowledgeEntry } from '@/lib/base-knowledge/wire'

export const day = (iso: string, locale: string) =>
  new Date(iso).toLocaleDateString(locale === 'de' ? 'de-AT' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

/** Whether the entry needs a check: confirmed and overdue (never checked, too old, or found not current). */
export const checkDue = (entry: BaseKnowledgeEntry) =>
  entry.status === 'confirmed' && entry.freshness.overdue

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

export function StatusChip({ entry }: { entry: BaseKnowledgeEntry }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  if (entry.status === 'proposed') {
    return (
      <Chip size="sm" variant="info" data-testid="base-knowledge-status">
        {t('status.proposed')}
      </Chip>
    )
  }
  if (entry.edition && !entry.edition.inForce) {
    return (
      <Chip size="sm" variant="muted" data-testid="base-knowledge-status">
        {t('status.superseded')}
      </Chip>
    )
  }
  if (checkDue(entry)) {
    return (
      <Chip size="sm" variant="warning" data-testid="base-knowledge-status">
        {t('status.checkDue')}
      </Chip>
    )
  }
  return (
    <Chip size="sm" variant="success" data-testid="base-knowledge-status">
      {t('status.confirmed')}
    </Chip>
  )
}

/** What happens to the text: held until confirmed, metadata only without the AI statement, or read. */
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

export function LastChecked({
  entry,
  locale,
}: {
  entry: BaseKnowledgeEntry
  locale: string
}): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const { lastCheck, dueAt } = entry.freshness
  if (entry.status === 'proposed') return <span className="text-muted-foreground text-xs">–</span>
  return (
    <span className={checkDue(entry) ? 'text-warning text-xs' : 'text-muted-foreground text-xs'}>
      {lastCheck ? t('checked.on', { date: day(lastCheck.checkedAt, locale) }) : t('checked.never')}
      {dueAt && !checkDue(entry) && (
        <span className="block">{t('checked.dueOn', { date: day(dueAt, locale) })}</span>
      )}
    </span>
  )
}
