'use client'

import type { JSX } from 'react'
import { forwardRef } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Layers,
  Mail,
  MailOpen,
  MessageSquare,
  MoreHorizontal,
  ArrowUpRight,
  Check,
  Reply,
} from 'lucide-react'

import { namespaceRoot, useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import { inboxItemCopy } from '@/lib/inbox/item-copy'
import {
  inboxTypePresentation,
  isMarkAnchored,
  UNKNOWN_TYPE_PRESENTATION,
  type InboxItemView,
} from '@/lib/inbox/types'
import { ActionMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { AttentionDot } from '@/components/ui/attention-dot'
import { Quote } from '@/components/ui/quote'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { motion, motionQuick, motionQuickExit, useMotionToken } from '@/components/motion'
import { cn } from '@/lib/utils'
import { documentLifecycleClient } from '@/lib/documents/lifecycle-client'
import { DiscussDocumentButton } from '@/features/documents/components/discuss-document-button'
import { projectIdFromDocumentHref } from '@/features/documents/lib/document-question'
import { compareRevisionHref } from '@/features/documents/lib/revision-compare-link'
import { withReviewBack } from '@/features/documents/lib/open-review'
import { Composer } from '@/features/documents/components/review/composer'
import { useFocusBackOnClose } from '@/features/documents/components/review/focus-return'
import { MentionText } from './MentionText'
import { InboxItemFace } from './InboxItemFace'
import { MARK_CLIENT, useMarkAnswer, type InboxMarkClient } from '../hooks/use-mark-answer'
import { InboxItemCaption } from './InboxItemCaption'
import { inboxDue } from '../lib/inbox-due'
import { InboxReviewDecision, type InboxReviewClient } from './InboxReviewDecision'
import { InboxNormSuggestionDecision, type InboxNormDecisionClient } from './InboxNormSuggestionDecision'
import { isPlainClick } from '../lib/plain-click'
import { UploadReportLines } from '@/features/uploads/components/upload-report'

export type { InboxMarkClient }

export interface InboxItemRowProps {
  item: InboxItemView
  onOpen?: (item: InboxItemView) => void
  onArchive?: (itemId: string) => void
  onUnarchive?: (itemId: string) => void
  onMarkRead?: (itemId: string) => void
  onMarkUnread?: (itemId: string) => void
  focused?: boolean
  viewerId?: string | null
  markClient?: InboxMarkClient
  reviewClient?: InboxReviewClient
  normDecisionClient?: InboxNormDecisionClient
}

export const InboxItemRow = forwardRef<HTMLLIElement, InboxItemRowProps>(function InboxItemRow(
  {
    item,
    onOpen,
    onArchive,
    onUnarchive,
    onMarkRead,
    onMarkUnread,
    focused = false,
    viewerId = null,
    reviewClient = documentLifecycleClient,
    markClient = MARK_CLIENT,
    normDecisionClient,
  },
  ref,
): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const tFiles = useTranslations(filesCopy)
  const { locale } = useLocale()

  const presentation = inboxTypePresentation(item.type) ?? UNKNOWN_TYPE_PRESENTATION

  const documentProjectId =
    item.resourceType === 'document' ? projectIdFromDocumentHref(item.href) : null

  const compareHref =
    item.type === 'document.new_revision' &&
    item.state !== 'inert' &&
    item.resourceType === 'document' &&
    item.related !== null &&
    item.anchorId !== null &&
    item.anchorId !== item.resourceId
      ? compareRevisionHref(item.href, item.anchorId)
      : null

  const inert = item.state === 'inert'
  const unread = !item.read
  const resolved = item.state === 'resolved'
  const isWarning = presentation.tone === 'warning' && !inert

  const redacted = !item.href

  const { title, body } = inboxItemCopy(item, t, namespaceRoot(collaborationCopy, locale), locale)
  const archived = item.archived

  const markRow =
    isMarkAnchored(item.type) && !inert && !redacted && item.resourceType === 'document' && item.anchorId !== null
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams?.toString()
  const here = pathname ? `${pathname}${query ? `?${query}` : ''}` : null
  const linkHref = markRow && item.href ? withReviewBack(item.href, here) : item.href
  const {
    answerHere,
    answerInReview,
    canResolveMark,
    replying,
    setReplying,
    markBusy,
    markOutcome,
    setMarkOutcome,
    untold,
    sendReply,
    resolveMark,
    undoResolve,
    offerUndo,
  } = useMarkAnswer({ item, markRow, markClient, onOpen })
  const replyButtonRef = useFocusBackOnClose<HTMLButtonElement>(answerHere && replying && item.anchorId !== null)
  const undoRef = useFocusBackOnClose<HTMLButtonElement>(!offerUndo)
  const resolveRef = useFocusBackOnClose<HTMLButtonElement>(offerUndo)
  const outcomeRef = useFocusBackOnClose<HTMLParagraphElement>(offerUndo)

  const settled = replying || markOutcome === 'resolved'
  const menuEntries: ActionMenuEntry[] = [
    ...(answerHere && !settled
      ? [{ type: 'item' as const, id: 'reply', label: t('inbox.mark.reply'), icon: MessageSquare, onSelect: () => { setMarkOutcome(null); setReplying(true) }, testId: 'inbox-mark-reply-menu' }]
      : []),
    ...(canResolveMark && !settled
      ? [{ type: 'item' as const, id: 'resolve', label: t('inbox.mark.resolve'), icon: CheckCircle2, onSelect: resolveMark, testId: 'inbox-mark-resolve-menu' }]
      : []),
    ...(answerInReview && linkHref
      ? [{ type: 'item' as const, id: 'review', label: t('inbox.mark.answerInReview'), icon: MessageSquare, href: linkHref, onSelect: () => onOpen?.(item) }]
      : []),
    ...(compareHref
      ? [{ type: 'item' as const, id: 'compare', label: t('inbox.compareRevisions'), icon: Layers, href: compareHref, onSelect: () => onOpen?.(item) }]
      : []),
    ...(answerHere || canResolveMark || answerInReview || compareHref ? [{ type: 'separator' as const }] : []),
    ...(!item.read && onMarkRead
      ? [{ type: 'item' as const, id: 'read', label: t('inbox.markRead'), icon: MailOpen, onSelect: () => onMarkRead(item.id), testId: 'inbox-mark-read' }]
      : []),
    ...(item.read && item.state !== 'inert' && !archived && onMarkUnread
      ? [{ type: 'item' as const, id: 'unread', label: t('inbox.markUnread'), icon: Mail, onSelect: () => onMarkUnread(item.id), testId: 'inbox-mark-unread' }]
      : []),
    ...(archived && onUnarchive
      ? [{ type: 'item' as const, id: 'unarchive', label: t('inbox.unarchive'), icon: ArchiveRestore, onSelect: () => onUnarchive(item.id), testId: 'inbox-unarchive' }]
      : []),
    ...(!archived && onArchive
      ? [{ type: 'item' as const, id: 'archive', label: t('inbox.archive'), icon: Archive, onSelect: () => onArchive(item.id), testId: 'inbox-archive-menu' }]
      : []),
  ]

  const canDecideReview =
    item.type === 'document.review_requested' &&
    item.actionable &&
    !resolved &&
    !inert &&
    item.resourceType === 'document' &&
    item.anchorId !== null &&
    item.subject !== null
  const canDecideNorm =
    item.type === 'office_shelf.norm_suggested' && item.actionable && !resolved && !inert && !redacted && item.anchorId !== null
  const showBody =
    body !== null && !answerHere && !answerInReview && !canDecideReview && (!item.excerpt || isWarning || redacted)
  const chatName = item.subject ?? t('inbox.untitledConversation')
  const place =
    item.resourceType === 'conversation' &&
    presentation.icon !== 'agent' &&
    !redacted &&
    !title.includes(chatName) &&
    !(showBody && body?.includes(chatName))
      ? chatName
      : null
  const openMarks = item.type === 'document.new_revision' && !inert && !showBody ? (item.openMarks ?? 0) : 0
  const dueChip = inboxDue(item, t, locale)
  const move = useMotionToken(motionQuick)
  const leave = useMotionToken(motionQuickExit)
  return (
    <Item
      asChild
      className={cn(
        'group/row relative items-start gap-3 py-3 pl-7 pr-4',
        'hover:bg-desk focus-visible:bg-desk focus-visible:ring-0',
        'rounded-control',
        inert && 'bg-muted/60',
        focused && 'bg-desk',
      )}
    >
      <motion.li
        ref={ref}
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, x: 12, transition: leave }}
        transition={move}
        data-testid="inbox-item"
        data-item-id={item.id}
        data-state={item.state}
        data-type={item.type}
        data-focused={focused || undefined}
        data-focus-inset=""
        tabIndex={-1}
      >
        {/* Unread: the attention dot in the row's own gutter, on the title's
            first line, rather than a bar down the edge (side stripes are
            discouraged, design-language.md). It no longer touches the avatar:
            the ring it wore merged the two into one smudge. */}
        <AttentionDot show={unread} className="absolute left-3 top-[1.1rem] size-2 ring-0" />
        {/* Who it is from, in one material: a person's face, the agent's glyph,
            or the type's glyph for a system row, all on the same neutral
            ground. The tinted wells and the glyph badges in the avatars'
            corners made a rainbow of small marks down the list; what a row
            asks and how urgent it is are said in words on its lines. */}
        <ItemMedia aria-hidden className={cn('mt-0.5 size-8', inert && 'opacity-60')}>
          <InboxItemFace item={item} />
        </ItemMedia>

        <ItemContent className={cn(inert && 'opacity-90')}>
          {/* What happened, and when at the line's end: where every mail
              client puts it, so the eye goes there without being told. The
              toolbar comes up over it on the row you are on. */}
          <div className="flex items-baseline gap-3">
          <ItemTitle
            className={cn(
              'min-w-0 flex-1 overflow-visible whitespace-normal',
              unread ? 'font-medium' : 'font-normal',
            )}
          >
            {item.href && !inert ? (
              <Link
                href={linkHref ?? item.href}
                onClick={(event) => {
                  if (isPlainClick(event)) onOpen?.(item)
                }}
                onAuxClick={(event) => event.stopPropagation()}
                data-testid="inbox-item-link"
                className={cn(
                  'line-clamp-2 min-w-0 rounded-sm leading-snug outline-none sm:line-clamp-1',
                  'after:absolute after:inset-0 after:content-[""]',
                  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
                  unread ? 'font-medium text-foreground' : 'text-foreground dark:text-muted-foreground',
                )}
              >
                {title}
              </Link>
            ) : (
              <span
                className={cn(
                  'line-clamp-2 min-w-0 leading-snug sm:line-clamp-1',
                  unread ? 'font-medium text-foreground' : 'text-foreground dark:text-muted-foreground',
                )}
              >
                {title}
              </span>
            )}
          </ItemTitle>
            {/* `updatedAt`, which is what the list is ORDERED by. A grouped row
                that just absorbed a new message sorts to the top, and showing its
                `createdAt` put "5 days ago" at the head of the list. The title
                carries the absolute moment for both. */}
            <time
              className={cn(
                'shrink-0 text-xs tabular-nums text-muted-foreground max-sm:hidden',
                'pointer-fine:group-hover/row:invisible pointer-fine:group-focus-within/row:invisible',
                focused && 'pointer-fine:invisible',
              )}
              dateTime={item.updatedAt}
              title={formatAbsoluteTime(item.updatedAt, locale)}
            >
              {formatRelativeTime(item.updatedAt, locale)}
            </time>
          </div>

          {/* Where and when, under the title and before anything else: the
              project first (an office runs several, and „Grundriss EG“ alone
              does not say whose), then the moment, then by when. One caption
              line, so the eye finds it at the same place on every row. */}
          <InboxItemCaption
            item={item}
            place={place}
            openMarks={openMarks}
            due={dueChip}
            answered={resolved && item.actionable}
          />

          {/* Two lines, not one: the body is where a row says what to do, and one
              truncated line cut that sentence off in its middle. */}
          {showBody && <ItemDescription className="mt-1 line-clamp-2 whitespace-normal">{body}</ItemDescription>}

          {/* Two lines when it is the row's only body (what a colleague
              asked, what changed): one cut the sentence in its middle. One
              line under a body, which already said what the row is. */}
          {item.excerpt && (
            <Quote
              as="p"
              className={cn(
                'mt-0.5 ps-0 text-sm not-italic leading-snug text-muted-foreground',
                showBody ? 'line-clamp-1' : 'line-clamp-2',
              )}
              data-testid="inbox-item-excerpt"
            >
              {/* The quote's mentions as the thread's chips (`MentionText`):
                  only the ones the server kept, so a name typed by hand stays
                  text. One paragraph, as in any clamp. */}
              <MentionText
                content={item.excerpt}
                mentions={item.mentions}
                currentUserId={viewerId}
                className="whitespace-normal"
              />
            </Quote>
          )}

          {/* A completed project upload's Eingangsbericht: what it brought the
              project. Keyed on the data, as `href` is: only such a row carries one. */}
          {item.uploadReport && !inert && <UploadReportLines report={item.uploadReport} />}

          {/* The excerpt above is the order once the submit request carries
              one; the open link below is the file behind the decision. A real
              diff needs the previous version, which the payload does not name
              — so triage opens the file, it does not pretend to compare. */}
          {canDecideReview && <InboxReviewDecision item={item} reviewClient={reviewClient} onOpen={onOpen} />}

          {canDecideNorm && item.anchorId && (
            <InboxNormSuggestionDecision proposalId={item.anchorId} client={normDecisionClient} />
          )}

          {answerHere && replying && item.anchorId && (
            <div className="relative z-10 mt-2 space-y-1.5" data-testid="inbox-mark-reply-form">
              <Composer
                autoFocus
                testId="inbox-mark-reply-box"
                placeholder={
                  item.related ? t('inbox.mark.replyLabel', { related: item.related }) : t('inbox.mark.replyLabelNoNumber')
                }
                submitLabel={t('inbox.mark.send')}
                documentId={item.resourceId}
                mentionAgent={item.pilotiWakes === true}
                describeFailure={() => t('inbox.mark.failed')}
                onSubmit={sendReply}
                onEscape={() => setReplying(false)}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                data-testid="inbox-mark-reply-cancel"
                onClick={() => setReplying(false)}
              >
                {t('inbox.mark.cancel')}
              </Button>
            </div>
          )}
          {markOutcome && (
            <p
              ref={outcomeRef}
              tabIndex={-1}
              role={markOutcome === 'failed' || markOutcome === 'conflict' ? 'alert' : 'status'}
              className={cn(
                'mt-1.5 text-xs',
                markOutcome === 'failed' || markOutcome === 'conflict' ? 'text-error' : 'text-muted-foreground',
              )}
              data-testid="inbox-mark-outcome"
            >
              {t(`inbox.mark.${markOutcome}`)}
              {offerUndo && (
                <>
                  {' '}
                  <Button
                    ref={undoRef}
                    type="button"
                    variant="inline"
                    className="relative z-10"
                    disabled={markBusy}
                    data-testid="inbox-mark-undo"
                    onClick={undoResolve}
                  >
                    {t('inbox.undo')}
                  </Button>
                </>
              )}
              {markOutcome !== 'failed' && markOutcome !== 'conflict' && untold.length > 0 && (
                <>
                  {' '}
                  {untold.length === 1
                    ? tFiles('review.mentions.untoldOne', { name: untold[0] })
                    : tFiles('review.mentions.untoldMany', { names: untold.join(', ') })}
                </>
              )}
            </p>
          )}
        </ItemContent>

        {/* Drawn whenever the row has anything to offer, not only an archive:
            a row rendered without the list's handlers still has its own moves. */}
        {(menuEntries.length > 0 || (onArchive && !archived) || compareHref !== null || answerInReview || (documentProjectId !== null && !inert && !markRow)) && (
          <ItemActions
            data-testid="inbox-item-toolbar"
            className={cn(
              'gap-1 transition-opacity duration-snap motion-reduce:transition-none',
              'pointer-fine:absolute pointer-fine:right-2 pointer-fine:top-1.5 pointer-fine:z-10 pointer-fine:gap-0.5',
              'pointer-fine:rounded-control pointer-fine:bg-muted pointer-fine:pl-2',
              !focused &&
                'pointer-fine:pointer-events-none pointer-fine:opacity-0 pointer-fine:group-hover/row:pointer-events-auto pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:pointer-events-auto pointer-fine:group-focus-within/row:opacity-100',
            )}
          >
            {/* z-10, like the archive control: the row's stretched link paints an
                overlay across the whole card, and anything meant to be clickable
                has to sit above it. Never on an inert row — its target is gone,
                which is the same reason the title is not a link there. */}
            {compareHref && (
              <Button asChild variant="ghost" size="icon" className="relative z-10 size-8 text-muted-foreground hover:text-foreground pointer-coarse:hidden">
                <Link
                  href={compareHref}
                  title={t('inbox.compareRevisions')}
                  aria-label={t('inbox.compareRevisionsLabel', { subject: item.subject ?? t(redacted ? 'inbox.inert' : 'inbox.untitledConversation') })}
                  onClick={(event) => {
                    if (isPlainClick(event)) onOpen?.(item)
                  }}
                  data-testid="inbox-compare-revisions"
                >
                  <Layers aria-hidden />
                  <span className="sr-only">{t('inbox.compareRevisions')}</span>
                </Link>
              </Button>
            )}
            {/* The row itself opens the mark (its stretched link), so a button
                saying „Zur Anmerkung“ was the row's own click drawn a second
                time, in ink, on every row about a mark. It stays where it IS
                the action: the agent's question answered in the Prüfansicht. */}
            {answerInReview && item.href && (
              <Button asChild variant="ghost" size="icon" className="relative z-10 size-8 text-muted-foreground hover:text-foreground pointer-coarse:hidden">
                <Link
                  href={linkHref ?? item.href}
                  title={t('inbox.mark.answerInReview')}
                  onClick={(event) => {
                    if (isPlainClick(event)) onOpen?.(item)
                  }}
                  data-testid="inbox-open-mark"
                >
                  <ArrowUpRight aria-hidden />
                  <span className="sr-only">{t('inbox.mark.answerInReview')}</span>
                </Link>
              </Button>
            )}
            {answerHere && !settled && (
              <Button
                ref={replyButtonRef}
                type="button"
                size="icon"
                variant="ghost"
                className="relative z-10 size-8 text-muted-foreground hover:text-foreground pointer-coarse:hidden"
                title={t('inbox.mark.reply')}
                disabled={markBusy}
                data-testid="inbox-mark-reply"
                onClick={() => {
                  setMarkOutcome(null)
                  setReplying(true)
                }}
              >
                <Reply aria-hidden />
                <span className="sr-only">{t('inbox.mark.reply')}</span>
              </Button>
            )}
            {canResolveMark && !settled && (
              <Button
                ref={resolveRef}
                type="button"
                size="icon"
                variant="ghost"
                className="relative z-10 size-8 text-muted-foreground hover:text-foreground pointer-coarse:hidden"
                title={t('inbox.mark.resolve')}
                disabled={markBusy}
                data-testid="inbox-mark-resolve"
                onClick={resolveMark}
              >
                <Check aria-hidden />
                <span className="sr-only">{t('inbox.mark.resolve')}</span>
              </Button>
            )}
            {documentProjectId && !inert && !markRow && (
              <DiscussDocumentButton
                projectId={documentProjectId}
                documentId={item.resourceId}
                variant="ghost"
                iconOnly
                onNavigate={() => onOpen?.(item)}
                className="relative z-10 text-muted-foreground hover:text-foreground"
              />
            )}
            {/* z-10 keeps these above the stretched link's overlay so they stay
                clickable; they are siblings of the anchor, never children. The
                archive icon is a desktop affordance: on a phone its column cost
                the title its width, and the menu carries archiving there. */}
            {onArchive && !archived && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative z-10 size-8 text-muted-foreground hover:text-foreground pointer-coarse:hidden"
                aria-label={t('inbox.archive')}
                title={t('inbox.archive')}
                onClick={() => onArchive(item.id)}
              >
                <Archive className="size-4" aria-hidden />
              </Button>
            )}
            <ActionMenu
              mode="dropdown"
              entries={menuEntries}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="relative z-10 size-8 text-muted-foreground touch-target"
                  aria-label={t('inbox.moreActions')}
                  data-testid="inbox-item-menu"
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              }
            />
          </ItemActions>
        )}
      </motion.li>
    </Item>
  )
})
