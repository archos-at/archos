'use client'

import {
  type FC,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  MessageSquareText,
  MoreHorizontal,
  PencilLine,
  Share2,
  SquarePen,
} from 'lucide-react'
import { AnimatePresence, motion, motionQuick } from '@/components/motion'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/adapters/auth'
import { useChatStore } from '@/features/chat/store'
import { useConversationOnServer } from '@/features/chat/lib/conversation-on-server'
import { hasLiveRun } from '@/features/chat/lib/session-activity'
import { AccessChip } from '@/features/collaboration/components/AccessChip'
import { ParticipantStrip } from '@/features/collaboration/components/ParticipantStrip'
import { ShareDialog } from '@/features/collaboration/components/ShareDialog'
import { useSharing } from '@/features/collaboration/hooks/use-sharing'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { researchCopy } from '@/i18n/namespaces/research'
import type { ResourceSharingState } from '@/lib/sharing/types'
import { useHeaderHeight } from '../hooks/use-header-height'
import { useLayoutStore } from '../store'
import { ChatConnectionLine } from './ChatConnectionLine'
import { THREAD_COLUMN_INNER, THREAD_GUTTER } from '@/components/ui/thread-column'
import { ChatTitleText } from './chat-title-text'

const MENU_FOCUS_GUARD_MS = 250

interface ChatToolbarProps {
  sessionTitle?: string
  onNewSession?: () => void
  isNewSessionDisabled?: boolean
  isChatStarted?: boolean
  conversationId?: string | null
  isCollaborationEnabled?: boolean
  currentUserId?: string | null
  onHeightChange?: (heightPx: number) => void
}

export const ChatToolbar: FC<ChatToolbarProps> = memo(function ChatToolbar({
  sessionTitle = '',
  onNewSession,
  isNewSessionDisabled = false,
  isChatStarted = true,
  conversationId = null,
  isCollaborationEnabled = false,
  currentUserId = null,
  onHeightChange,
}) {
  const { isAuthenticated } = useAuth()
  const headerRef = useHeaderHeight(onHeightChange)
  const t = useTranslations(researchCopy)
  const tChat = useTranslations(chatCopy)
  const tCollab = useTranslations(collaborationCopy)
  const toggleSessionsPanel = useLayoutStore((s) => s.toggleSessionsPanel)
  const isDeepResearchStreaming = useChatStore((s) =>
    hasLiveRun(s.currentConversation?.messages ?? [])
  )
  const currentSessionId = useChatStore((s) => s.currentConversation?.id)
  const updateConversationTitle = useChatStore((s) => s.updateConversationTitle)

  const isConversationOnServer = useConversationOnServer(conversationId)
  const isSharingReachable = Boolean(
    isCollaborationEnabled &&
      isAuthenticated &&
      isChatStarted &&
      conversationId &&
      isConversationOnServer,
  )
  const sharing = useSharing('conversation', conversationId ?? null, isSharingReachable)
  const [isShareOpen, setIsShareOpen] = useState(false)
  const sharingState = isSharingReachable ? sharing.state : null
  const canShare = Boolean(sharingState || (isSharingReachable && sharing.loadError))
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState(sessionTitle)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editResolvedRef = useRef(false)

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [isEditingTitle])

  const canRename = isAuthenticated && !!currentSessionId && !!updateConversationTitle

  const showFaces = sharingState?.visibility === 'private'
  const showAccessChip = Boolean(sharingState && sharingState.visibility !== 'private')

  const hasPeople = Boolean(
    showAccessChip || (showFaces && (sharingState?.entries.length ?? 0) > 1),
  )
  const hasStatus = Boolean(isDeepResearchStreaming || hasPeople)

  const startEditingTitle = useCallback(() => {
    if (!canRename) return
    setEditedTitle(sessionTitle)
    editResolvedRef.current = false
    setIsEditingTitle(true)
  }, [canRename, sessionTitle])

  const focusGuardUntilRef = useRef(0)

  const startEditingTitleFromMenu = useCallback(() => {
    focusGuardUntilRef.current = Date.now() + MENU_FOCUS_GUARD_MS
    startEditingTitle()
  }, [startEditingTitle])

  const commitTitle = useCallback(() => {
    if (editResolvedRef.current) return
    editResolvedRef.current = true
    setIsEditingTitle(false)
    const trimmed = editedTitle.trim()
    if (trimmed && trimmed !== sessionTitle && currentSessionId && updateConversationTitle) {
      updateConversationTitle(currentSessionId, trimmed)
    }
  }, [editedTitle, sessionTitle, currentSessionId, updateConversationTitle])

  const handleTitleBlur = useCallback(() => {
    if (Date.now() < focusGuardUntilRef.current) {
      setTimeout(() => titleInputRef.current?.focus(), 0)
      return
    }
    commitTitle()
  }, [commitTitle])

  const cancelTitleEdit = useCallback(() => {
    editResolvedRef.current = true
    setIsEditingTitle(false)
    setEditedTitle(sessionTitle)
  }, [sessionTitle])

  const handleTitleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitTitle()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelTitleEdit()
      }
    },
    [commitTitle, cancelTitleEdit]
  )

  const handleMenuClick = useCallback(() => {
    if (isAuthenticated) toggleSessionsPanel()
  }, [toggleSessionsPanel, isAuthenticated])

  const handleNewSessionClick = useCallback(() => {
    if (!isAuthenticated || isNewSessionDisabled) return
    onNewSession?.()
  }, [isAuthenticated, isNewSessionDisabled, onNewSession])

  return (
    <header ref={headerRef} className={cn(THREAD_GUTTER, 'bg-background absolute inset-x-0 top-0 z-20 min-h-12 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] max-md:landscape:flex max-md:landscape:items-start max-md:landscape:gap-2')}>
      {/* Phone shell: the connection's line, which takes room only while the link is not fine. */}
      <ChatConnectionLine className={cn(THREAD_COLUMN_INNER, 'max-md:landscape:mx-0 max-md:landscape:w-auto max-md:landscape:shrink-0')} />
      {/* The thread's one column (`thread-column.ts`), less the gutter the header
          already carries, so the pills stand on the answer's and composer's edges. */}
      <div className={cn(THREAD_COLUMN_INNER, 'flex items-start justify-between gap-3 max-sm:items-stretch max-md:landscape:mx-0 max-md:landscape:min-w-0 max-md:landscape:flex-1')}>
      {/* LEFT pill: orientation only — the single history door + the current
          session title/rename, always visible (mobile included). On a phone it
          takes whatever width the right pill leaves, and the title may run to
          two lines inside it rather than being cut to a stub.
          min-h-12 (44px controls) on touch, min-h-8 (28px controls) on a
          pointer device, so the pill never collapses when the breadcrumb is
          hidden on an empty chat. */}
      {/* The alpha pair is load-bearing: this toolbar FLOATS over the scrolling
          transcript, and `backdrop-blur` needs something to blur. The
          `supports-` step drops to a more opaque fill where there is no blur. */}
      {/* Quiet register (the Claude bar, not a toolbar): 32px controls on a
          pointer device, no shadow, a fainter fill — the pill is legibility
          over the scrolling transcript, not furniture of its own. Touch keeps
          the 44px targets. */}
      {/* …and the pill itself is dropped on a chat that has not started. The
          fill, the hairline and the blur are there to keep these controls
          legible over a MOVING transcript; an empty canvas has none, so on the
          start screen they are chrome with no job — and a lone pill on the left
          with nothing opposite it does not read as "quiet", it reads as a
          toolbar with its right half missing. Nothing is added on the right to
          balance it, because nothing there is true yet: no thread to share or
          rename, and New chat on an empty chat is a door back into the room you
          are standing in. The controls stay exactly where they are and lose
          their frame; the row goes quiet on both sides. */}
      <div
        className={cn(
          'pointer-events-auto flex min-h-12 min-w-0 items-center gap-0.5 rounded-surface p-0.5 max-sm:flex-1 sm:min-h-8',
          isChatStarted &&
            'border border-base bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/50'
        )}
      >
        {/* The door to the project's past chats, with its word at every width: as a lone glyph beside the
            title it read as the title's icon, and none of the pilot offices found it (2026-11-10). The rail
            lists the last chats under „Letzte Chats“ and leads here too („Alle Chats“). `ChatToolbar.spec.tsx` („the
            history door is never a glyph alone“) holds it. */}
        <Button
          variant="ghost"
          className={cn(
            'h-11 shrink-0 gap-1.5 rounded-control px-3 text-sm font-medium sm:h-7 sm:px-2 sm:text-xs',
            isChatStarted && 'max-sm:w-12 max-sm:flex-col max-sm:gap-0 max-sm:px-0 max-sm:text-meta'
          )}
          onClick={handleMenuClick}
          disabled={!isAuthenticated}
          title={!isAuthenticated ? t('chatToolbar.signInToView') : t('chatToolbar.toggleSessions')}
          data-testid="chat-history-door"
        >
          <MessageSquareText className="size-4" aria-hidden="true" />
          <span data-slot="history-door-label">{t('chatToolbar.historyDoor')}</span>
        </Button>
        {isChatStarted && (sessionTitle || hasStatus) && <div aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />}

        {/* The session title (click-to-rename) — shown once a chat has started
            so the current thread is identifiable. On a fresh, empty chat there
            is no thread to name yet, so it stays hidden to keep the start
            screen calm. The PROJECT name is deliberately absent: the rail and the
            URL name it already, so here it would be one more copy paying rent
            in the row's scarcest space. */}
        {isChatStarted && (sessionTitle || hasStatus) && (
          <nav
            className="flex min-w-0 flex-1 flex-col justify-center pl-1 pr-1.5 text-sm sm:flex-initial sm:flex-row sm:items-center sm:gap-1.5"
            aria-label={tChat('breadcrumb.ariaLabel')}
          >
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:contents">
              {sessionTitle ? (
                isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={editedTitle}
                    onChange={(e) => {
                      focusGuardUntilRef.current = 0
                      setEditedTitle(e.target.value)
                    }}
                    onKeyDown={handleTitleKeyDown}
                    onBlur={handleTitleBlur}
                    aria-label={tChat('breadcrumb.renameInputAria')}
                    enterKeyHint="done"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-11 w-56 max-w-full rounded-control border bg-card px-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:text-base sm:h-7 sm:pointer-fine:text-xs"
                  />
                ) : (
                  <button data-attr="chat-start-editing-title"
                    type="button"
                    onClick={startEditingTitle}
                    disabled={!canRename}
                    aria-label={tChat('breadcrumb.renameAria')}
                    title={canRename ? tChat('breadcrumb.renameAria') : sessionTitle}
                    className="flex min-h-9 min-w-0 max-w-[420px] flex-1 items-center rounded-control px-1 py-0.5 text-left text-sm font-medium leading-snug text-foreground sm:text-xs sm:leading-4 transition-colors duration-quick ease-out motion-reduce:transition-none enabled:cursor-text enabled:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:min-h-11 sm:flex-initial"
                  >
                    {/* Two lines on a phone, one from `sm`, at New chat's `text-xs`. From `sm`
                        the title YIELDS (`flex-initial`, not `flex-none`): it ran under New chat. */}
                    {/* The title, and the temporary mark beside it (ADR-0180). */}
                    <ChatTitleText title={sessionTitle} conversationId={currentSessionId} />
                  </button>
                )
              ) : null}
              {/* Phone only: what is true of the thread, at the end of the title's
                  own row: who can read it (a small stack of faces, or the rule as
                  a chip) and a spinner while a run is going. The title keeps the
                  width and the pill stays one line of orientation; below `sm`
                  there is no room beside the actions for it. */}
              {hasStatus && (
                <ThreadStatus
                  surface="phone"
                  sharingState={sharingState}
                  currentUserId={currentUserId}
                  isResearching={isDeepResearchStreaming}
                  researchingLabel={t('chatToolbar.researching')}
                  className="flex shrink-0 items-center gap-1.5 pr-0.5 sm:hidden"
                />
              )}
              </div>
          </nav>
        )}

      </div>

      {/* RIGHT pill: what is TRUE about this thread, then what you can DO to it,
          with a hairline between the two. Hidden until a chat has started — on the
          empty start screen New chat is redundant and there is no thread to share
          or rename.

          The separation is the point. This row used to mix the two kinds freely,
          and worse, it mixed them in a way that made each LIE about itself: the
          avatar stack looks like status and was a button, while the access chip
          looks like every other chip in the app and is `role="img"`. A reader
          could not tell what would respond to a click without trying. So:

            · everything before the hairline is INFORMATION. Not clickable, ever.
            · everything after it is a CONTROL, and looks like one.

          The second rule is that only the most frequent control stays in the open.
          New chat earns that. Share, rename and the research report are occasional
          and go in the one menu — progressive disclosure rather than three more
          permanent buttons in a 768px row that also has to carry a thread title.

          Arrivals fade (opacity only). Width is reserved by the controls that
          stay mounted — layout/width animation was a spring that bounced the
          New-chat button sideways. Reduced motion is handled globally by
          <MotionConfig reducedMotion="user">. */}
      {isChatStarted && (
      <div className="pointer-events-auto flex min-h-12 shrink-0 items-center gap-0.5 rounded-surface border border-base bg-card/60 p-0.5 backdrop-blur supports-[backdrop-filter]:bg-card/50 sm:min-h-8">
        {/* ── STATUS ────────────────────────────────────────────────────────────
            Who can reach this thread, stated ONCE, in whichever of the two forms is
            true of the audience (see `showFaces` / `showAccessChip` above), and
            never clickable. A solo private thread gets neither — the same doctrine
            ParticipantStrip already applies to itself: no collaboration furniture
            where nothing is being collaborated on.

            Desktop-only HERE: a phone's width belongs to the thread's name, so
            below `sm` the same status is the line under the name (the left pill).

            The group renders only when it has something to SAY — a hairline with
            nothing in front of it is the same empty claim as the button that
            pointed at an empty report.

            It arrives late by nature (the roster is a fetch), so it fades and
            settles in rather than blinking into place. `initial={false}` on the
            presence keeps that for CHANGES only: a thread you open with the roster
            already known must not replay the animation. */}
        <AnimatePresence initial={false}>
        {hasStatus && (
          <motion.div
            key="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionQuick}
            className="hidden items-center gap-1 pl-1 pr-1.5 sm:flex"
          >
            <ThreadStatus
              surface="desktop"
              sharingState={sharingState}
              currentUserId={currentUserId}
              isResearching={isDeepResearchStreaming}
              researchingLabel={t('chatToolbar.researching')}
              className="contents"
            />
            <div aria-hidden="true" className="ml-1 h-4 w-px bg-border" />
          </motion.div>
        )}
        </AnimatePresence>

        {/* ── CONTROLS ─────────────────────────────────────────────────────────
            New chat: the one action frequent enough to stay in the open. */}
        <Button
          variant="ghost"
          size="sm"
          className="size-11 gap-1.5 rounded-control px-0 max-sm:hidden sm:h-7 sm:w-auto sm:px-2"
          onClick={handleNewSessionClick}
          disabled={!isAuthenticated || isNewSessionDisabled}
          aria-label={t('chatToolbar.createNewSession')}
          title={
            !isAuthenticated
              ? t('chatToolbar.signInToCreate')
              : isNewSessionDisabled
                ? t('chatToolbar.cannotCreateActive')
                : t('chatToolbar.createNewSession')
          }
        >
          <SquarePen className="size-4" aria-hidden="true" />
          <span className="hidden text-xs font-medium sm:inline">{t('chatToolbar.newChat')}</span>
        </Button>

        {/* Everything else this thread can do. Each item is here because it is
            occasional, and each still appears only when it is real.

            Its own hairline: the same mark that separates what is TRUE from what
            you can DO now also separates the one action kept in the open from the
            drawer holding the rest, so the pill reads as three plain groups
            instead of a run of controls. Drawn only with the menu it precedes —
            a divider with nothing after it is a promise of something missing. */}
        {(canRename || canShare || isAuthenticated) && (
          <>
          <div aria-hidden="true" className="mx-1 h-4 w-px bg-border max-sm:hidden" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'size-11 rounded-control px-0 sm:size-7',
                  !(canRename || canShare) && 'sm:hidden'
                )}
                aria-label={t('chatToolbar.moreActions')}
                title={t('chatToolbar.moreActions')}
                data-testid="thread-menu"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {/* New chat, on a phone only: a desktop keeps it in the open. */}
              <DropdownMenuItem
                onSelect={handleNewSessionClick}
                disabled={!isAuthenticated || isNewSessionDisabled}
                className="sm:hidden"
                data-testid="new-chat-menu-item"
              >
                <SquarePen className="size-4" aria-hidden="true" />
                {t('chatToolbar.newChat')}
              </DropdownMenuItem>

              {/* Rename — the discoverable path to the same inline editor the
                  title's own click opens. The click stays as the shortcut; this is
                  how anyone finds out it exists. */}
              {canRename && (
                <DropdownMenuItem
                  onSelect={startEditingTitleFromMenu}
                  data-testid="rename-session"
                >
                  <PencilLine className="size-4" aria-hidden="true" />
                  {t('chatToolbar.renameSession')}
                </DropdownMenuItem>
              )}

              {/* Share — the ONE door to the sharing surface (SH-17). Present for
                  every participant, not only owners: a viewer is entitled to see who
                  else is in the room, and it is where they leave from. Also present
                  after a failed load: the dialog renders the retry alert, a vanished
                  menu item gives the reader nothing. */}
              {canShare && (
                <DropdownMenuItem onSelect={() => setIsShareOpen(true)} data-testid="share-button">
                  <Share2 className="size-4" aria-hidden="true" />
                  {tCollab('sharing.action')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          </>
        )}
      </div>
      )}
      </div>

      {/* The sharing surface itself. Mounted only once the thread is reachable and
          the reader has asked for it, so it costs nothing on every other render.
          It portals out of this header. The dialog owns the loading skeleton and the
          load-error retry alert, so it mounts whenever the door is open — not only
          when a state has already landed. */}
      {isSharingReachable && isShareOpen && conversationId && (
        <ShareDialog
          open={isShareOpen}
          onOpenChange={setIsShareOpen}
          resourceId={conversationId}
          sharing={sharing}
          currentUserId={currentUserId}
        />
      )}
    </header>
  )
})

interface ThreadStatusProps {
  surface: 'phone' | 'desktop'
  sharingState: ResourceSharingState | null
  currentUserId: string | null
  isResearching: boolean
  researchingLabel: string
  className?: string
}

const ThreadStatus: FC<ThreadStatusProps> = ({
  surface,
  sharingState,
  currentUserId,
  isResearching,
  researchingLabel,
  className,
}) => {
  const showFaces = sharingState?.visibility === 'private'
  const showAccessChip = Boolean(sharingState && sharingState.visibility !== 'private')
  return (
    <div className={className} data-status-surface={surface}>
      {/* No `onOpen`: the strip is deliberately inert here. Sharing has ONE door
          in this header and it is the menu item, so the faces can be read as
          what they are. */}
      {showFaces && sharingState && (
        <ParticipantStrip
          entries={sharingState.entries}
          currentUserId={currentUserId}
          maxVisible={surface === 'phone' ? 2 : undefined}
        />
      )}
      {/* On a phone, while a run is going the spinner is the news and the rule
          steps aside, so the title keeps the width (the sharing surface still
          states it). */}
      {showAccessChip && sharingState && !(surface === 'phone' && isResearching) && (
        <AccessChip visibility={sharingState.visibility} />
      )}
      {/* Live research is status too, and the one piece of it worth carrying in
          the header: the thread's own banner scrolls away, and this is then the
          only persistent "still working" signal. It states, it does not act
          (a run is read in the thread it was commissioned from, ADR-0062).
          Independent of sharing: a solo thread researches just as often. */}
      <AnimatePresence initial={false}>
        {isResearching && (
          <motion.span
            key="running"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionQuick}
            className="inline-flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-sm text-muted-foreground"
            data-testid="research-running"
          >
            <Spinner size="sm" label={researchingLabel} />
            <span className={surface === 'phone' ? 'sr-only' : 'hidden lg:inline'}>
              {researchingLabel}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
