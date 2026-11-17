'use client'

import type { JSX } from 'react'
import { ToneSwatch, type MeterTone } from '@/components/ui/segment-meter'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import { readMarkOf, type KnowledgeTally, type ReadMark } from '../lib/folder-knowledge'

export const READ_MARK_TONE: Record<ReadMark['state'], MeterTone> = {
  failed: 'destructive',
  held: 'warning',
  reading: 'inkSoft',
  unplaced: 'muted',
  allRead: 'ink',
}

export const READ_MARK_KEY: Record<ReadMark['state'], string> = {
  failed: 'brief.states.failed',
  held: 'brief.states.held',
  reading: 'brief.states.reading',
  unplaced: 'brief.unplacedShort',
  allRead: 'brief.allRead',
}

export function FolderReadState({
  tally,
  withUnplaced = false,
  dotOnly = false,
  exceptionsOnly = false,
  className,
}: {
  tally: KnowledgeTally | undefined
  withUnplaced?: boolean
  dotOnly?: boolean
  exceptionsOnly?: boolean
  className?: string
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const mark = tally ? readMarkOf(tally, { withUnplaced }) : null
  if (!mark) return null
  if (exceptionsOnly && (mark.state === 'allRead' || mark.state === 'unplaced')) return null
  const words = t(READ_MARK_KEY[mark.state], { count: mark.count })
  return (
    <span
      className={cn('text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs', className)}
      data-testid="folder-read-state"
      data-state={mark.state}
      title={dotOnly ? words : undefined}
    >
      <ToneSwatch tone={READ_MARK_TONE[mark.state]} />
      {/* Truncates rather than pushing its row: the swatch stays, the words give way. */}
      <span className={dotOnly ? 'sr-only' : 'min-w-0 truncate phone:sr-only'}>{words}</span>
    </span>
  )
}
