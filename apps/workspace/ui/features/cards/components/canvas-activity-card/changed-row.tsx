'use client'

import { useState, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { CommentPin } from '@/components/ui/comment-pin'
import { useChatStore } from '@/features/chat/store'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { AnnotationRequestError, updateAnnotation } from '@/lib/annotations/client'
import type { AgentChangeView } from '@/lib/changes/types'
import { itemDecisionKey } from '../../card-decision'
import type { LiveMarks } from '../../hooks/use-canvas-document'
import { selectCardDecision } from '../../hooks/use-card-decision'
import { useServerUndo } from '../../hooks/use-server-undo'
import type { ShowInDocument } from '../../hooks/use-show-in-document'
import type { TurnChanges } from '../../hooks/use-turn-changes'
import { changePhrase } from '../../lib/canvas-activity-phrases'
import { standsAsChanged } from '../../lib/canvas-changes'
import { stillAsLeft, undoRequest, type CanvasChangedItem, type MarkState } from '../../lib/canvas-activity'
import { ClampedText } from '../ClampedText'
import { ForPerson, UndoneLabel } from './row-labels'
import { ThreadGlance } from './thread-glance'
import { UndoButton, UndoMessages } from './undo-controls'

export function ChangedRow({
  documentId,
  item,
  index,
  live,
  change,
  changes,
  messageId,
  cardKey,
  mayAct,
  onShow,
}: {
  documentId: string
  item: CanvasChangedItem
  index: number
  live: LiveMarks
  change: AgentChangeView | undefined
  changes: TurnChanges
  messageId?: string
  cardKey: string
  mayAct: boolean
  onShow: ShowInDocument
}): JSX.Element {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const stored = useChatStore((state) =>
    selectCardDecision(state, messageId, itemDecisionKey(cardKey, `${item.annotation_id}@${index}`))
  )
  const [replayed, setReplayed] = useState(false)
  const [replayBusy, setReplayBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const serverUndo = useServerUndo(change, live, changes)
  const current = live.lookup(item.annotation_id)
  const inverse = undoRequest(item)
  const undone = change ? change.undoneAt !== null : stored === 'rejected' || replayed
  const moved =
    !undone &&
    current !== undefined &&
    current !== 'gone' &&
    (change ? !change.canUndo && !standsAsChanged(change, current) : !stillAsLeft(item, current))
  const mayUndo = change
    ? change.canUndo && !undone && current !== 'gone'
    : inverse !== null && mayAct && !undone && !moved && current !== 'gone' && (current === undefined || current.canEdit)
  const busy = change ? serverUndo.busy : replayBusy

  const replayUndo = async () => {
    if (replayBusy || inverse === null) return
    setReplayBusy(true)
    setError(null)
    try {
      const now = (await live.refresh())?.(item.annotation_id)
      if (now === 'gone' || (now && !stillAsLeft(item, now))) return
      const updated = await updateAnnotation(documentId, item.annotation_id, inverse)
      live.adopt(updated)
      setReplayed(true)
    } catch (failure) {
      if (failure instanceof AnnotationRequestError && failure.status === 409) {
        await live.refresh()
      } else if (failure instanceof AnnotationRequestError && failure.status === 404) {
        live.forget(item.annotation_id)
      } else if (failure instanceof AnnotationRequestError && failure.status === 403) {
        setError(t('cards.canvasActivity.forbidden'))
      } else {
        setError(t('cards.canvasActivity.error'))
      }
    } finally {
      setReplayBusy(false)
    }
  }

  const phrases = item.changes.map((entry) => changePhrase(t, locale, entry)).join(' · ')
  const state: MarkState | null = current === 'gone' ? 'gone' : moved && current ? current.status : null

  return (
    <li className="flex gap-3" data-testid="canvas-activity-changed" data-undone={undone || undefined}>
      <span className="flex w-20 shrink-0 justify-center pt-1" aria-hidden>
        <CommentPin as="span" number={item.number} done={undone || current === 'gone'} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="card-meta text-muted-foreground flex flex-wrap items-center gap-x-1.5">
          <span className="text-foreground font-mono">#{item.number}</span>
          <span className="text-foreground">{phrases}</span>
          <ForPerson change={change} />
          {undone && <UndoneLabel who={change?.undoneByName ?? null} />}
          {!undone && state && (
            <span className="text-muted-foreground ml-auto" data-testid="canvas-activity-state">
              {state === 'gone'
                ? t('cards.canvasActivity.state.gone')
                : t('cards.canvasActivity.movedSince', { state: t(`cards.canvasActivity.status.${state}`) })}
            </span>
          )}
        </p>
        <ClampedText className="card-body text-foreground">{`„${item.note}“`}</ClampedText>
        <ThreadGlance mark={current} />
        {error && (
          <p className="card-caption text-destructive" role="alert">
            {error}
          </p>
        )}
        <UndoMessages notice={serverUndo.notice} error={serverUndo.error} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {mayUndo && (
            <UndoButton
              number={item.number}
              busy={busy}
              onClick={() => void (change ? serverUndo.undo() : replayUndo())}
            />
          )}
          {current !== 'gone' && (
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
