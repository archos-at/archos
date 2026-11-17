'use client'

import type { JSX } from 'react'
import { Eye, Lock } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'

export function useFolderOwnAccessLabel(): (ownAccess: { everyoneReads: boolean }) => string {
  const t = useTranslations(filesCopy)
  return (ownAccess) => t(ownAccess.everyoneReads ? 'folders.access.ownListEveryoneReads' : 'folders.access.ownList')
}

export function FolderAccessMark({
  label,
  names,
  className,
  testId,
}: {
  label: string
  names?: readonly string[]
  className?: string
  testId?: string
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn('text-muted-foreground inline-flex shrink-0 items-center', className)}
          data-testid={testId}
          data-names={names?.join(', ')}
        >
          <Lock className="size-3.5" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{label}</TooltipContent>
    </Tooltip>
  )
}

export function FolderReadOnlyBadge({ testId }: { testId?: string }): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className="text-muted-foreground shrink-0 gap-1 font-normal" data-testid={testId}>
          <Eye className="size-3" aria-hidden />
          {t('folders.access.readOnlyBadge')}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{t('folders.access.readOnlyHint')}</TooltipContent>
    </Tooltip>
  )
}
