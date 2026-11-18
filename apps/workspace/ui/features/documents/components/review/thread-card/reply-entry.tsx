'use client'

import { useState, type JSX } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FieldError } from '@/components/ui/field'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { AnnotationRequestError } from '@/lib/annotations/client'
import { isLive, REPLY_TAKEN_UP_REASON, type AnnotationReplyView, type AnnotationView } from '@/lib/annotations/types'
import type { DocumentReview } from '../../../hooks/use-document-review'
import { agentAskingIn, takenUpByAgent } from '../../../lib/reply-taken-up'
import { Composer, type ComposerSend } from '../composer'
import { useFocusBackOnClose } from '../focus-return'
import { Message } from './message'

export function ReplyEntry({
  review,
  annotation,
  reply,
}: {
  review: DocumentReview
  annotation: AnnotationView
  reply: AnnotationReplyView
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const mayChange =
    annotation.canEdit &&
    isLive(annotation) &&
    reply.authorKind === 'person' &&
    reply.createdBy === review.me &&
    !takenUpByAgent(annotation, reply, agentAskingIn(review, annotation.id))
  const moreRef = useFocusBackOnClose<HTMLButtonElement>(editing && mayChange)
  const failureOf = (error: unknown) =>
    error instanceof AnnotationRequestError && error.reason === REPLY_TAKEN_UP_REASON ? t('review.replyTakenUp') : null

  const save = async (body: string, { mentions }: ComposerSend) => {
    const after = await review.editReply(annotation.id, reply.id, body, mentions)
    setEditing(false)
    return after.replies.find((candidate) => candidate.id === reply.id)?.mentions
  }

  const remove = async () => {
    setFailed(null)
    try {
      await review.removeReply(annotation.id, reply.id)
    } catch (error) {
      setFailed(failureOf(error) ?? t('review.actionFailed'))
    }
  }

  if (editing && mayChange) {
    return (
      <div className="space-y-1.5" data-testid="thread-reply-edit">
        <Composer
          autoFocus
          testId="thread-reply-edit-body"
          placeholder={t('review.replyEditLabel')}
          submitLabel={t('review.save')}
          documentId={review.documentId}
          initialBody={reply.body}
          initialMentions={reply.mentions}
          describeFailure={(error) => failureOf(error) ?? t('review.saveFailed')}
          onSubmit={save}
          onEscape={() => setEditing(false)}
        />
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>
            {t('review.editCancel')}
          </Button>
          {(review.piloti.available || review.pilotiWakes) && (
            <p className="text-muted-foreground text-[11px] leading-4">{t('review.replyEditNoWake')}</p>
          )}
        </div>
      </div>
    )
  }

  const actions: ActionMenuEntry[] = [
    { type: 'item', id: 'edit', label: t('review.edit'), icon: Pencil, onSelect: () => setEditing(true) },
    {
      type: 'item',
      id: 'delete',
      label: t('review.delete'),
      icon: Trash2,
      variant: 'destructive',
      onSelect: () => setConfirmDelete(true),
    },
  ]
  return (
    <div data-testid="thread-reply-entry">
      <Message
        authorKind={reply.authorKind}
        name={reply.createdByName}
        userId={reply.createdBy}
        at={reply.createdAt}
        body={reply.body}
        mentions={reply.mentions}
        viewerId={review.me}
        woken={reply.wokenBy ? { trigger: reply.wokenBy, number: annotation.number } : null}
        editedAt={reply.editedAt}
        actions={
          mayChange ? (
            <ActionMenu
              mode="dropdown"
              entries={actions}
              trigger={
                <Button
                  ref={moreRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 [&_svg]:size-3.5"
                  aria-label={t('review.replyMore')}
                  data-testid="thread-reply-more"
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              }
            />
          ) : null
        }
      />
      {failed && <FieldError className="mt-1 ml-8.5">{failed}</FieldError>}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('review.replyDeleteConfirm')}
        description={t('review.replyDeleteHint')}
        confirmLabel={t('review.delete')}
        cancelLabel={t('annotations.cancel')}
        onConfirm={remove}
      />
    </div>
  )
}
