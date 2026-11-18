'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { Archive, ChevronRight } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { StatCardIcon } from '@/components/ui/stat-card'
import { cn } from '@/lib/utils'

export function OfficeShelfEntryCard(): JSX.Element {
  const t = useTranslations(projectsCopy)

  return (
    <Link
      href="/app/office-shelf"
      aria-label={t('officeShelfCard.aria')}
      className={cn(
        'group flex w-full items-center gap-3.5 rounded-surface bg-card px-4 py-3.5 shadow-sm transition-colors duration-quick ease-out focus-visible:outline-none motion-reduce:transition-none',
        FOCUS_RING,
      )}
    >
      <StatCardIcon icon={Archive} tone="office" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{t('officeShelfCard.title')}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{t('officeShelfCard.subtitle')}</span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-quick ease-out group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
        aria-hidden
      />
    </Link>
  )
}
