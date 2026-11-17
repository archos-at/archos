'use client'

import type { DocumentAuthor } from '@/lib/db/schema/documents'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'

export function AuthorshipLine({
  authoredBy,
  className,
}: {
  authoredBy: DocumentAuthor | null | undefined
  className?: string
}) {
  const t = useTranslations(filesCopy)
  if (authoredBy !== 'agent') return null
  return (
    <p className={cn('truncate text-[11px] leading-[1.45] text-muted-foreground', className)}>
      {t('authorship.byAgent')}
    </p>
  )
}
