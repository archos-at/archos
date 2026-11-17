'use client'

import type { JSX } from 'react'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { FileItem } from '../file-types'
import { revisionCount } from '../lib/revision-chain'

export function isOlderRevisionEntry(file: FileItem): boolean {
  return file.revision?.supersededBy != null
}

export function RevisionCount({
  file,
  className,
}: {
  file: FileItem
  className?: string
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  if (isOlderRevisionEntry(file)) return null
  const count = revisionCount(file)
  if (count <= 1) return null
  return (
    <span
      className={cn(
        'text-muted-foreground shrink-0 whitespace-nowrap text-xs font-normal tabular-nums',
        className
      )}
      title={t('revisionBadge.countTitle', { count })}
      data-testid="revision-count"
    >
      {t('revisionBadge.count', { count })}
    </span>
  )
}

export function OlderRevisionBadge({
  file,
  className,
}: {
  file: FileItem
  className?: string
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const newer = file.revision?.supersededBy
  if (!newer) return null
  const replacedBy = t('revisionBadge.olderTitle', { name: newer.filename })
  return (
    <Badge
      variant="secondary"
      className={cn('text-muted-foreground shrink-0 font-normal', className)}
      title={replacedBy}
      aria-label={`${t('revisionBadge.older')}. ${replacedBy}`}
      data-testid="revision-badge"
      data-state="older"
    >
      {t('revisionBadge.older')}
    </Badge>
  )
}
