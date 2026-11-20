'use client'

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { CommentPin } from '@/components/ui/comment-pin'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { AgentChangeView } from '@/lib/changes/types'
import { cn } from '@/lib/utils'
import type { CanvasRepliedItem } from '../../lib/canvas-activity'
import type { LiveMarks } from '../../hooks/use-canvas-document'
import { useServerUndo } from '../../hooks/use-server-undo'
import type { ShowInDocument } from '../../hooks/use-show-in-document'
import type { TurnChanges } from '../../hooks/use-turn-changes'
import { ClampedText } from '../ClampedText'
import { ForPerson, UndoneLabel } from './row-labels'
import { ThreadGlance } from './thread-glance'
import { UndoButton, UndoMessages } from './undo-controls'

export function RepliedRow({
  item,
  live,
  change,
  changes,
  onShow,
}: {
  item: CanvasRepliedItem
  live: LiveMarks
  change: AgentChangeView | undefined
  changes: TurnChanges
  onShow: ShowInDocument
}): JSX.Element {
  const t = useTranslations(chatCopy)
  const serverUndo = useServerUndo(change, live, changes)
  const undone = change?.undoneAt != null
  return (
    <li className="flex gap-3" data-testid="canvas-activity-replied" data-undone={undone || undefined}>
      <span className="flex w-20 shrink-0 justify-center pt-1" aria-hidden>
        <CommentPin as="span" number={item.number} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="card-meta text-muted-foreground flex flex-wrap items-center gap-x-1.5">
          <span>{t('cards.canvasActivity.repliedIn', { number: item.number })}</span>
          <ForPerson change={change} />
          {undone && <UndoneLabel who={change?.undoneByName ?? null} />}
        </p>
        <ClampedText className={cn('card-body', undone ? 'text-muted-foreground line-through' : 'text-foreground')}>
          {`„${item.excerpt}“`}
        </ClampedText>
        <ThreadGlance mark={live.lookup(item.annotation_id)} />
        <UndoMessages notice={serverUndo.notice} error={serverUndo.error} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {change?.canUndo && !undone && (
            <UndoButton number={item.number} busy={serverUndo.busy} onClick={() => void serverUndo.undo()} />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onShow(item.annotation_id)}
            aria-label={t('cards.canvasActivity.showThreadLabel', { number: item.number })}
          >
            {t('cards.canvasActivity.show')}
          </Button>
        </div>
      </div>
    </li>
  )
}
