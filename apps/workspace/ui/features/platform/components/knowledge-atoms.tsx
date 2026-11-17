'use client'

import type { JSX } from 'react'
import { useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SourceSignalChip } from '@/features/layout/components/SourceSignalChip'
import { useTranslations } from '@/i18n'
import { knowledgeCopy } from '@/i18n/namespaces/knowledge'
import { platformCopy } from '@/i18n/namespaces/platform'
import {
  docClassAuthority,
  docClassSignal,
  resolveDocClass,
  type DocClass,
} from '@/lib/knowledge/doc-class'
import type { KnowledgeFileState } from '@/lib/knowledge/service'

export function useDocClassLabel(): (docClass: DocClass | string | null | undefined) => string {
  const t = useTranslations(platformCopy)
  return useCallback((docClass) => t(`knowledge.docClasses.${resolveDocClass(docClass)}`), [t])
}

export function DocClassChip({ docClass }: { docClass: string | null }): JSX.Element {
  const label = useDocClassLabel()(docClass)
  const tag = docClassAuthority(docClass)
  const text = tag && !label.includes(tag) ? `${label} · ${tag}` : label
  return <SourceSignalChip signal={docClassSignal(docClass)}>{text}</SourceSignalChip>
}

export const STATE_VARIANT: Record<
  KnowledgeFileState,
  'success' | 'info' | 'warning' | 'destructive' | 'secondary'
> = {
  ingested: 'success',
  pending: 'info',
  failed: 'destructive',
  stale: 'warning',
  removed: 'secondary',
  inconsistent: 'destructive',
}

export function KnowledgeStateBadge({
  state,
  hint = 'none',
}: {
  state: KnowledgeFileState
  hint?: 'none' | 'tooltip'
}): JSX.Element {
  const tk = useTranslations(knowledgeCopy)
  const badge = <Badge variant={STATE_VARIANT[state]}>{tk(`states.${state}`)}</Badge>
  if (hint === 'none') return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{tk(`stateHints.${state}`)}</TooltipContent>
    </Tooltip>
  )
}
