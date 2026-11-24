'use client'

import { useId, useState, type JSX } from 'react'
import { Check, Link2, MoreHorizontal, Pencil, RotateCcw, Scale, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FieldError } from '@/components/ui/field'
import { Kbd } from '@/components/ui/kbd'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { ANNOTATION_KINDS, isLive, type AnnotationView } from '@/lib/annotations/types'
import { wakeTurnId } from '@/lib/annotations/wake-ids'
import { cn } from '@/lib/utils'
import { isAgentKind } from '@/lib/agent-kind'
import { askRegionOf } from '../../hooks/use-canvas-ask'
import type { DocumentReview } from '../../hooks/use-document-review'
import { useFollowEnd } from '../../hooks/use-follow-end'
import { useSelfAssignee } from '../../hooks/use-self-assignee'
import { Composer, type ComposerSend } from './composer'
import { useFocusBackOnClose } from './focus-return'
import { AgentThreadRow, AgentWorkRow } from './thread-card/agent-rows'
import { KIND_ICONS } from './thread-card/kind-picker'
import { Message } from './thread-card/message'
import { ReplyEntry } from './thread-card/reply-entry'
import { ResponsibilityRow } from './thread-card/responsibility-row'
import { RevisionLines } from './thread-card/revision-lines'
import { ReviewCard, type CardPlacement } from './thread-card/review-card'

export { DraftCard } from './thread-card/draft-card'
export { KIND_ICONS } from './thread-card/kind-picker'
export { ReviewCard, type CardPlacement } from './thread-card/review-card'

export function ThreadCard({
  review,
  annotation,
  placement,
  canPickAssignee,
  onCopyLink,
  walk,
}: {
  review: DocumentReview
  annotation: AnnotationView
  placement: CardPlacement
  canPickAssignee: boolean
  onCopyLink?: (annotation: AnnotationView) => void
  walk?: { index: number; total: number; onNext: () => void } | null
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const self = useSelfAssignee(review)
  const headerId = useId()
  const KindIcon = KIND_ICONS[annotation.kind]
  const proposed = annotation.status === 'proposed'
  const live = isLive(annotation)
  const { piloti } = review
  const agentReplies = annotation.replies.filter((reply) => isAgentKind(reply.authorKind)).length
  const threadAsk = piloti.asks.find(
    (ask) =>
      ask.replyInThread &&
      ask.annotationId === annotation.id &&
      (ask.status === 'failed' ||
        ask.status === 'declined' ||
        (ask.status === 'answered' && ask.degraded.includes('thread')) ||
        (ask.status === 'thinking' && agentReplies <= ask.baseline))
  )
  const thread = useFollowEnd<HTMLDivElement>(
    `${annotation.replies.length}:${annotation.pilotiWork?.state ?? ''}:${threadAsk?.id ?? ''}:${threadAsk?.status ?? ''}`
  )

  const sendReply = async (body: string, { piloti: mentioned, mentions }: ComposerSend) => {
    thread.follow()
    const { annotation: after, wake, replyId } = await review.reply(annotation.id, body, {
      addressesPiloti: mentioned,
      mentions,
    })
    const kept = after.replies.find((reply) => reply.id === replyId)?.mentions
    if (wake !== 'off' || !piloti.available) return kept
    piloti.ask({
      text: body.trim(),
      region: askRegionOf(annotation),
      annotationId: annotation.id,
      replyInThread: true,
      baseline: agentReplies,
      ...(replyId ? { turnId: wakeTurnId(replyId) } : {}),
    })
    return kept
  }

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    setFailed(false)
    try {
      await run()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const move = (status: 'open' | 'resolved' | 'dismissed') =>
    act(() => review.update(annotation.id, { status, expectedStatus: annotation.status }))

  const mayReword = annotation.canEdit && annotation.authorKind === 'person' && annotation.createdBy === review.me
  const menuRef = useFocusBackOnClose<HTMLButtonElement>(editing && mayReword)

  const saveEdit = async (body: string, { mentions }: ComposerSend) => {
    const after = await review.update(annotation.id, { body, mentions })
    setEditing(false)
    return after.mentions
  }

  const menu: ActionMenuEntry[] = [
    ...(mayReword
      ? [
          {
            type: 'item' as const,
            id: 'edit',
            label: t('review.edit'),
            icon: Pencil,
            onSelect: () => setEditing(true),
          },
        ]
      : []),
    ...ANNOTATION_KINDS.filter((kind) => kind !== annotation.kind && annotation.canEdit).map((kind) => ({
      type: 'item' as const,
      id: `kind-${kind}`,
      label: t('review.makeKind', { kind: t(`annotations.kinds.${kind}`) }),
      icon: KIND_ICONS[kind],
      onSelect: () => void act(() => review.update(annotation.id, { kind })),
    })),
    ...(piloti.available && annotation.onCurrentRevision
      ? [
          {
            type: 'item' as const,
            id: 'ask',
            label: t('review.askAgent'),
            icon: Sparkles,
            onSelect: () => void piloti.compose(askRegionOf(annotation), { annotationId: annotation.id }),
          },
        ]
      : []),
    ...(review.pilotiWakes && annotation.canEdit && annotation.status === 'open'
      ? [
          {
            type: 'item' as const,
            id: 'delegate',
            label: annotation.delegatedBy ? t('review.takeBackFromAgent') : t('review.delegateToPiloti'),
            icon: annotation.delegatedBy ? Undo2 : Sparkles,
            onSelect: () =>
              void act(() => review.update(annotation.id, { delegateToPiloti: !annotation.delegatedBy })),
          },
        ]
      : []),
    ...(onCopyLink
      ? [{ type: 'item' as const, id: 'link', label: t('review.copyLink'), icon: Link2, onSelect: () => onCopyLink(annotation) }]
      : []),
    ...(annotation.canDelete
      ? [
          { type: 'separator' as const },
          {
            type: 'item' as const,
            id: 'delete',
            label: t('review.delete'),
            icon: Trash2,
            variant: 'destructive' as const,
            onSelect: () => setConfirmDelete(true),
          },
        ]
      : []),
    ...(!annotation.canDelete && annotation.deleteRefused
      ? [
          { type: 'separator' as const },
          ...(annotation.canEdit && annotation.status === 'open'
            ? [
                {
                  type: 'item' as const,
                  id: 'resolve-instead',
                  label: t('review.resolveInstead'),
                  icon: Check,
                  testId: 'thread-resolve-instead',
                  onSelect: () => void move('resolved'),
                },
              ]
            : []),
          {
            type: 'item' as const,
            id: 'delete',
            label: t('review.delete'),
            hint: t(`review.deleteRefused.${annotation.deleteRefused}`),
            icon: Trash2,
            disabled: true,
            testId: 'thread-delete-refused',
          },
        ]
      : []),
  ]

  return (
    <ReviewCard placement={placement} testId="review-thread" labelledBy={headerId}>
      <RevisionLines review={review} annotation={annotation} busy={busy} onCarry={() => void act(() => review.carry(annotation))} />
      {walk && proposed && (
        <div className="bg-muted flex items-center gap-2 border-b py-1 pr-1.5 pl-3" data-testid="thread-walk">
          <span className="text-muted-foreground text-[11px] font-medium tabular-nums">
            {t('review.walkPosition', { index: walk.index, total: walk.total })}
          </span>
          {walk.total > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-6 gap-1.5 px-2 text-xs"
              aria-keyshortcuts="J"
              data-testid="thread-walk-next"
              onClick={walk.onNext}
            >
              {t('review.walkNext')}
              <Kbd className="h-4 min-w-4 px-1 text-[10px]">J</Kbd>
            </Button>
          )}
        </div>
      )}
      <div className={cn('flex items-center gap-1.5 border-b px-3 py-2', placement === 'docked' && 'pr-12')}>
        <KindIcon className="text-muted-foreground size-3.5" aria-hidden />
        {/* What the card is about, which names it as a dialog: the kind, the number, its state. */}
        <span id={headerId} className="flex min-w-0 items-center gap-1.5">
          <span className="text-foreground text-xs font-medium">{t(`annotations.kinds.${annotation.kind}`)}</span>{' '}
          <span className="text-muted-foreground font-mono text-[11px]">#{annotation.number}</span>
          {proposed && (
            <span className="text-muted-foreground border-foreground/50 ml-1 rounded-full border border-dashed px-1.5 text-[10px] font-medium">
              {t('review.proposal')}
            </span>
          )}
          {!live && (
            <span className="text-muted-foreground bg-muted ml-1 rounded-full px-1.5 text-[10px] font-medium">
              {annotation.status === 'resolved' ? t('review.resolved') : t('review.dismissed')}
            </span>
          )}
        </span>
        <span className="ml-auto flex items-center">
          {annotation.canEdit && annotation.status === 'open' && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 [&_svg]:size-3.5"
              disabled={busy}
              aria-label={t('review.resolve')}
              title={`${t('review.resolve')} (E)`}
              data-testid="thread-resolve"
              onClick={() => void move('resolved')}
            >
              <Check aria-hidden />
            </Button>
          )}
          {annotation.canEdit && !live && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 [&_svg]:size-3.5"
              disabled={busy}
              aria-label={t('review.reopen')}
              title={t('review.reopen')}
              onClick={() => void move('open')}
            >
              <RotateCcw aria-hidden />
            </Button>
          )}
          {menu.length > 0 && (
            <ActionMenu
              mode="dropdown"
              entries={menu}
              trigger={
                <Button
                  ref={menuRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 [&_svg]:size-3.5"
                  aria-label={t('review.more')}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              }
            />
          )}
          {/* Docked in the phone's sheet, the sheet's own × closes it. */}
          {placement !== 'docked' && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 [&_svg]:size-3.5"
              aria-label={t('review.closeThread')}
              onClick={() => review.select(null)}
            >
              <X aria-hidden />
            </Button>
          )}
        </span>
      </div>

      {annotation.delegatedBy && (
        <div className="border-b px-3 py-1.5" data-testid="thread-delegate">
          <Chip size="sm" variant="secondary" className="gap-1">
            <AgentGlyph size="xs" />
            {t('review.piloti.delegateChip', { name: annotation.delegatedByName ?? t('review.someone') })}
          </Chip>
        </div>
      )}

      <div
        ref={thread.ref}
        onScroll={thread.onScroll}
        data-testid="thread-messages"
        className="max-h-[min(22rem,50svh)] space-y-3 overflow-y-auto px-3 py-3"
      >
        {editing && mayReword ? (
          <div className="space-y-1.5" data-testid="thread-edit">
            <Composer
              autoFocus
              testId="thread-edit-body"
              placeholder={t('review.editLabel', { number: annotation.number })}
              submitLabel={t('review.save')}
              documentId={review.documentId}
              initialBody={annotation.body}
              initialMentions={annotation.mentions}
              describeFailure={() => t('review.saveFailed')}
              onSubmit={saveEdit}
              onEscape={() => setEditing(false)}
            />
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>
              {t('review.editCancel')}
            </Button>
          </div>
        ) : (
          <Message
            authorKind={annotation.authorKind}
            name={annotation.createdByName}
            userId={annotation.createdBy}
            at={annotation.createdAt}
            body={annotation.body}
            mentions={annotation.mentions}
            viewerId={review.me}
            proposal={proposed}
          />
        )}
        {annotation.basis && (
          <p className="text-muted-foreground ml-8.5 flex items-center gap-1.5 text-[11px]">
            <Scale className="size-3 shrink-0" aria-hidden />
            <span className="font-mono">{annotation.basis}</span>
          </p>
        )}
        {annotation.replies.map((reply) => (
          <ReplyEntry key={reply.id} review={review} annotation={annotation} reply={reply} />
        ))}
        <AgentWorkRow annotation={annotation} />
        {threadAsk && <AgentThreadRow ask={threadAsk} review={review} />}
      </div>

      {proposed && annotation.canEdit && (
        <div className="bg-muted space-y-2 border-t px-3 py-2.5">
          <p className="text-muted-foreground text-[11px] leading-4">{t('review.proposalHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 justify-between text-xs"
              disabled={busy}
              data-testid="thread-dismiss"
              onClick={() => void move('dismissed')}
            >
              {t('review.dismiss')}
              <Kbd className="ml-2 pointer-coarse:hidden">{t('review.dismissKey')}</Kbd>
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 justify-between text-xs"
              disabled={busy}
              data-testid="thread-accept"
              onClick={() => void move('open')}
            >
              {t('review.accept')}
              <Kbd className="bg-background/15 text-background ml-2 border-transparent pointer-coarse:hidden">E</Kbd>
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t px-3 py-2.5">
        <ResponsibilityRow
          documentId={review.documentId}
          assigneeUserId={annotation.assigneeUserId}
          assigneeName={annotation.assigneeUserId ? (annotation.assigneeName ?? t('review.someone')) : null}
          dueOn={annotation.dueOn}
          editable={annotation.canEdit && live}
          canPickAssignee={canPickAssignee}
          self={self}
          onAssignee={(person) => void act(() => review.update(annotation.id, { assigneeUserId: person?.userId ?? null }))}
          onDueOn={(dueOn) => void act(() => review.update(annotation.id, { dueOn }))}
        />
        {annotation.canEdit && (
          <Composer
            testId="thread-reply"
            placeholder={t('review.replyPlaceholder')}
            submitLabel={t('review.send')}
            mentionAgent={piloti.available}
            documentId={review.documentId}
            pickerSide="above"
            onSubmit={sendReply}
            onEscape={() => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
            }}
          />
        )}
        {failed && <FieldError>{t('review.actionFailed')}</FieldError>}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('review.deleteConfirm', { number: annotation.number })}
        confirmLabel={t('review.delete')}
        cancelLabel={t('annotations.cancel')}
        onConfirm={() => act(() => review.remove(annotation.id))}
      />
    </ReviewCard>
  )
}
