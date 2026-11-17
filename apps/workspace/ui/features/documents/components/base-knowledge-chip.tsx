'use client'

import Link from 'next/link'
import type { JSX } from 'react'
import { Library } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { FileItem } from '../file-types'

export function BaseKnowledgeChip({ file, className }: { file: Pick<FileItem, 'baseKnowledgeEntryId'>; className?: string }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  if (!file.baseKnowledgeEntryId) return null
  return (
    <Chip asChild size="sm" variant="info" interactive className={cn('shrink-0', className)}>
      <Link
        href={`/app/base-knowledge?file=${encodeURIComponent(file.baseKnowledgeEntryId)}`}
        onClick={(event) => event.stopPropagation()}
        title={t('baseKnowledge.open')}
        data-testid="base-knowledge-chip"
      >
        <Library aria-hidden />
        {t('baseKnowledge.label')}
      </Link>
    </Chip>
  )
}
