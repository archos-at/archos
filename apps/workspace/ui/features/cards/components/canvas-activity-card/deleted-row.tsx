'use client'

import type { JSX } from 'react'
import { CommentPin } from '@/components/ui/comment-pin'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { AgentChangeView } from '@/lib/changes/types'
import { cn } from '@/lib/utils'
import type { CanvasDeletedItem } from '../../lib/canvas-activity'
import type { LiveMarks } from '../../hooks/use-canvas-document'
import { useServerUndo } from '../../hooks/use-server-undo'
import type { TurnChanges } from '../../hooks/use-turn-changes'
import { ClampedText } from '../ClampedText'
import { ForPerson, UndoneLabel } from './row-labels'
import { UndoButton, UndoMessages } from './undo-controls'

export function DeletedRow({
  item,
  live,
  change,
  changes,
}: {
  item: CanvasDeletedItem
  live: LiveMarks
  change: AgentChangeView | undefined
  changes: TurnChanges
}): JSX.Element {
  const t = useTranslations(chatCopy)
  const serverUndo = useServerUndo(change, live, changes)
  const undone = change?.undoneAt != null
  return (
    <li className="flex gap-3" data-testid="canvas-activity-deleted" data-undone={undone || undefined}>
      <span className="flex w-20 shrink-0 justify-center pt-1" aria-hidden>
        <CommentPin as="span" number={item.number} done={!undone} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="card-meta text-muted-foreground flex flex-wrap items-center gap-x-1.5">
          <span>{t('cards.canvasActivity.deleted', { number: item.number })}</span>
          <ForPerson change={change} />
          {undone && <UndoneLabel who={change?.undoneByName ?? null} />}
        </p>
        <ClampedText className={cn('card-body', undone ? 'text-foreground' : 'text-muted-foreground line-through')}>
          {item.body}
        </ClampedText>
        <UndoMessages notice={serverUndo.notice} error={serverUndo.error} />
        {change?.canUndo && !undone && (
          <div className="pt-1">
            <UndoButton number={item.number} busy={serverUndo.busy} onClick={() => void serverUndo.undo()} />
          </div>
        )}
      </div>
    </li>
  )
}
