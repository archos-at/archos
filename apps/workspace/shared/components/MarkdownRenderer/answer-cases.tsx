'use client'

import { type FC, type ReactNode } from 'react'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'

export const tableRowClass = ({ active, muted, conflict = false }: { active: boolean; muted: boolean; conflict?: boolean }): string =>
  cn(
    'border-base border-t first:border-t-0',
    conflict && 'bg-warning-subtle',
    active && 'bg-success-subtle',
    muted && '[&>td]:text-muted-foreground'
  )

export const ListCase: FC<{ active: boolean; muted: boolean; id?: string; compact: boolean; children: ReactNode }> = ({
  active,
  muted,
  id,
  compact,
  children,
}) => (
  <li
    id={id}
    data-active={active ? 'true' : undefined}
    className={cn(
      compact ? 'text-sm' : 'text-answer',
      muted ? 'text-muted-foreground' : 'text-foreground',
      active && '-ml-2 rounded-control bg-success-subtle py-0.5 pl-2'
    )}
  >
    {children}
  </li>
)

export function useOutcomeLabel(): (word: string, where: 'cell' | 'tally') => string {
  const t = useTranslations(commonCopy)
  return (word, where) => {
    if (word === '@pass') return t('markdown.limitKept')
    if (word === '@fail') return t('markdown.limitMissed')
    if (word === '@conflict') return t(where === 'tally' ? 'markdown.tallyConflict' : 'markdown.outcomeConflict')
    return word
  }
}
