'use client'

import { useState, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { StackedLabel } from '@/components/ui/stacked-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useChatStore } from '@/features/chat/store'
import type { AgentChangeView } from '@/lib/changes/types'
import { itemDecisionKey } from '../../card-decision'
import type { LiveMarks } from '../../hooks/use-canvas-document'
import { selectCardDecision } from '../../hooks/use-card-decision'
import { useServerUndo } from '../../hooks/use-server-undo'
import type { ShowInDocument } from '../../hooks/use-show-in-document'
import type { TurnChanges } from '../../hooks/use-turn-changes'
import { createdState, isProposed, markState, type CanvasSetItem } from '../../lib/canvas-activity'
import { ClampedText } from '../ClampedText'
import { answerMark } from './answer-mark'
import { ForPerson, MarkStateLabel, SkippedNote, UndoneLabel } from './row-labels'
import { PageSilhouette } from './page-silhouette'
import { ThreadGlance } from './thread-glance'
import { UndoButton, UndoMessages } from './undo-controls'

export function SetRow({
  documentId,
  item,
  live,
  change,
  changes,
  messageId,
  cardKey,
  mayAct,
  skippedBy,
  thumbnail,
  aspect,
  onAspect,
  onShow,
}: {
  documentId: string
  item: CanvasSetItem
  live: LiveMarks
  change: AgentChangeView | undefined
  changes: TurnChanges
  messageId?: string
  cardKey: string
  mayAct: boolean
  skippedBy?: string | null
  thumbnail: string | null
  aspect: number
  onAspect: (aspect: number) => void
  onShow: ShowInDocument
}): JSX.Element {
  const t = useTranslations(chatCopy)
  const decision = useChatStore((state) =>
    selectCardDecision(state, messageId, itemDecisionKey(cardKey, item.annotation_id))
  )
  const [busy, setBusy] = useState<'open' | 'dismissed' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const serverUndo = useServerUndo(change, live, changes)
  const current = live.lookup(item.annotation_id)
  const proposal = isProposed(item)
  const undone = change?.undoneAt != null
  const state = undone ? 'gone' : proposal ? markState(decision, current) : createdState(current)
  const mayAnswer = state === 'proposed' && mayAct && (current === undefined || current === 'gone' || current.canEdit)
  const mayUndo = !proposal && change?.canUndo === true && !undone
  const showState = proposal ? state !== 'proposed' : state !== 'open'

  const answer = async (status: 'open' | 'dismissed') => {
    if (busy) return
    setBusy(status)
    setError(null)
    try {
      const outcome = await answerMark(documentId, item.annotation_id, status, live)
      if (outcome === 'moved') await live.refresh()
      else if (outcome === 'forbidden') setError(t('cards.canvasActivity.forbidden'))
      else if (outcome === 'failed') setError(t('cards.canvasActivity.error'))
    } finally {
      setBusy(null)
    }
  }

  const kind = t(`cards.canvasActivity.kinds.${item.kind}`)
  const who = current && current !== 'gone' ? (state === 'open' ? current.acceptedByName : current.closedByName) : null

  return (
    <li className="flex gap-3" data-testid={`canvas-activity-${item.action}`} data-state={state}>
      <PageSilhouette item={item} state={state} thumbnail={thumbnail} aspect={aspect} onAspect={onAspect} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="card-meta text-muted-foreground flex flex-wrap items-center gap-x-1.5">
          <span className="text-foreground font-mono">#{item.number}</span>
          <span aria-hidden>·</span>
          <span>{kind}</span>
          <span aria-hidden>·</span>
          <span>{t('cards.canvasActivity.page', { page: item.page })}</span>
          <ForPerson change={change} />
          <SkippedNote by={skippedBy} />
          {undone ? (
            <UndoneLabel who={change?.undoneByName ?? null} />
          ) : (
            showState && <MarkStateLabel state={state} who={decision ? null : who} />
          )}
        </p>
        <ClampedText className="card-body text-foreground">{item.body}</ClampedText>
        <ThreadGlance mark={current} />
        {error && (
          <p className="card-caption text-destructive" role="alert">
            {error}
          </p>
        )}
        <UndoMessages notice={serverUndo.notice} error={serverUndo.error} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {mayAnswer && (
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => void answer('open')}
                aria-label={t('cards.canvasActivity.acceptLabel', { number: item.number })}
                aria-disabled={busy !== null || undefined}
                aria-busy={busy === 'open' || undefined}
                className="aria-disabled:cursor-default"
              >
                <StackedLabel
                  busy={busy === 'open'}
                  idle={t('cards.canvasActivity.accept')}
                  working={t('cards.canvasActivity.accepting')}
                />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void answer('dismissed')}
                aria-label={t('cards.canvasActivity.rejectLabel', { number: item.number })}
                aria-disabled={busy !== null || undefined}
                aria-busy={busy === 'dismissed' || undefined}
                className="aria-disabled:cursor-default aria-disabled:opacity-50"
              >
                {t('cards.canvasActivity.reject')}
              </Button>
            </>
          )}
          {mayUndo && <UndoButton number={item.number} busy={serverUndo.busy} onClick={() => void serverUndo.undo()} />}
          {state !== 'gone' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onShow(item.annotation_id)}
              aria-label={t('cards.canvasActivity.showMarkLabel', { number: item.number })}
            >
              {t('cards.canvasActivity.show')}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
