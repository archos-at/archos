'use client'

import type { JSX } from 'react'
import { Check, Undo2, X } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { AgentChangeView } from '@/lib/changes/types'
import { cn } from '@/lib/utils'
import type { MarkState } from '../../lib/canvas-activity'

export function ForPerson({ change }: { change: AgentChangeView | undefined }): JSX.Element | null {
  const t = useTranslations(chatCopy)
  if (!change?.onBehalfOfName) return null
  return (
    <>
      <span aria-hidden>·</span>
      <span data-testid="canvas-activity-for">{t('cards.canvasActivity.forPerson', { name: change.onBehalfOfName })}</span>
    </>
  )
}

export function UndoneLabel({ who }: { who: string | null }): JSX.Element {
  const t = useTranslations(chatCopy)
  return (
    <span className="text-muted-foreground ml-auto inline-flex items-center gap-1" data-testid="canvas-activity-state">
      <Undo2 aria-hidden className="size-3" />
      {t('cards.canvasActivity.undone')}
      {who && <span>· {who}</span>}
    </span>
  )
}

export function SkippedNote({ by }: { by: string | null | undefined }): JSX.Element | null {
  const t = useTranslations(chatCopy)
  if (by === undefined) return null
  return (
    <>
      <span aria-hidden>·</span>
      <span data-testid="canvas-activity-skipped">
        {by ? t('cards.canvasActivity.batch.alreadyBy', { name: by }) : t('cards.canvasActivity.batch.already')}
      </span>
    </>
  )
}

export function MarkStateLabel({ state, who }: { state: MarkState; who: string | null }): JSX.Element {
  const t = useTranslations(chatCopy)
  const kept = state === 'open' || state === 'resolved'
  const Icon = kept ? Check : X
  return (
    <span
      className={cn('ml-auto inline-flex items-center gap-1', kept ? 'text-success' : 'text-muted-foreground')}
      data-testid="canvas-activity-state"
    >
      <Icon aria-hidden className="size-3" />
      {t(`cards.canvasActivity.state.${state}`)}
      {who && <span className="text-muted-foreground">· {who}</span>}
    </span>
  )
}
