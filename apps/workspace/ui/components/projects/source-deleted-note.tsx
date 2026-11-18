'use client'

import type { JSX } from 'react'
import { FolderX } from 'lucide-react'
import { useLocale, useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { formatCalendarDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export function SourceDeletedNote({ at, className }: { at: string; className?: string }): JSX.Element {
  const t = useTranslations(commonCopy)
  const { locale } = useLocale()
  const date = formatCalendarDate(at, locale)
  return (
    <p
      role="note"
      className={cn('flex items-center gap-1 text-[11px] leading-[1.45] text-muted-foreground', className)}
      title={t('derivedSource.deletedOnTitle', { date })}
      data-testid="source-deleted-note"
    >
      <FolderX className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{t('derivedSource.deletedOn', { date })}</span>
    </p>
  )
}
