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
import { Lock, MessageSquareText, MoreHorizontal, PencilLine, Share2, SquarePen, Trash2 } from 'lucide-react'
import { AnimatePresence, motion, motionQuick } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { FIELD_FOCUS_RING } from '@/components/ui/focus-ring'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { researchCopy } from '@/i18n/namespaces/research'
import type { ResourceSharingState } from '@/lib/sharing/types'
import { useHeaderHeight } from '../hooks/use-header-height'
import { useLayoutStore } from '../store'
import { ChatConnectionLine } from './ChatConnectionLine'
import { THREAD_COLUMN_INNER, THREAD_GUTTER } from '@/components/ui/thread-column'
import { ChatTitleText } from './chat-title-text'
import { DeleteSessionConfirmationModal } from './DeleteSessionConfirmationModal'
import { formatCalendarDate } from '@/lib/format'

const MENU_FOCUS_GUARD_MS = 250

interface ChatToolbarProps {
  sessionTitle?: string
  onNewSession?: () => void
  onDeleteSession?: (sessionId: string) => void | Promise<void>
  isChatStarted?: boolean
  conversationId?: string | null
  isCollaborationEnabled?: boolean
  currentUserId?: string | null
  onHeightChange?: (heightPx: number) => void
}

export const ChatToolbar: FC<ChatToolbarProps> = memo(function ChatToolbar({
  sessionTitle = '',
  onNewSession,
  onDeleteSession,
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
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const { locale } = useLocale()
  const updatedAt = useChatStore((s) => s.currentConversation?.updatedAt)
  const changedOn = updatedAt ? formatCalendarDate(new Date(updatedAt).toISOString(), locale) : null
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

  const showFaces = (sharingState?.entries.length ?? 0) > 1
  const showAccessChip = Boolean(sharingState && sharingState.visibility !== 'private' && !showFaces)

  const hasPeople = Boolean(
    showAccessChip || (showFaces && (sharingState?.entries.length ?? 0) > 1),
  )
  const hasStatus = Boolean(isDeepResearchStreaming || hasPeople)
  const canDelete = isAuthenticated && !!currentSessionId && !!onDeleteSession
  const onlyReader = !hasPeople && (sharingState ? sharingState.visibility === 'private' : !isCollaborationEnabled)

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
    if (!isAuthenticated) return
    onNewSession?.()
  }, [isAuthenticated, onNewSession])

  return (
    <header ref={headerRef} className={cn(THREAD_GUTTER, 'bg-background absolute inset-x-0 top-0 z-20 min-h-12 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] max-md:landscape:flex max-md:landscape:items-start max-md:landscape:gap-2')}>
      <ChatConnectionLine className={cn(THREAD_COLUMN_INNER, 'max-md:landscape:mx-0 max-md:landscape:w-auto max-md:landscape:shrink-0')} />
      <div className={cn(THREAD_COLUMN_INNER, 'flex items-start justify-between gap-3 max-sm:items-stretch sm:items-center max-md:landscape:mx-0 max-md:landscape:min-w-0 max-md:landscape:flex-1')}>
      <div
        className={cn(
          'pointer-events-auto flex min-h-12 min-w-0 items-center gap-0.5 rounded-surface p-0.5 max-sm:flex-1 sm:min-h-8',
          isChatStarted && 'border border-base bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/50',
          !isChatStarted && 'sm:hidden'
        )}
      >
        {/* A phone has no rail, so the door to the chat list stays here; from `sm` up the rail lists the chats. */}
        <Button
          variant="ghost"
          className={cn(
            'h-11 shrink-0 gap-1.5 rounded-[6px] px-3 text-sm font-medium sm:hidden',
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
        {isChatStarted && (sessionTitle || hasStatus) && <div aria-hidden="true" className="h-4 w-px shrink-0 bg-border sm:hidden" />}

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
                    className={cn('h-11 w-56 max-w-full rounded-control border bg-card px-2 text-sm font-medium text-foreground pointer-coarse:text-base sm:h-7 sm:pointer-fine:text-xs', FIELD_FOCUS_RING)}
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
                    <ChatTitleText title={sessionTitle} conversationId={currentSessionId} />
                  </button>
                )
              ) : null}
              {hasStatus && (
                <ThreadStatus
                  surface="phone"
                  sharingState={sharingState}
                  currentUserId={currentUserId}
                  isResearching={isDeepResearchStreaming}
                  researchingLabel={t('chatToolbar.researching')}
              onOpenPeople={canShare ? () => setIsShareOpen(true) : undefined}
                  className="flex shrink-0 items-center gap-1.5 pr-0.5 sm:hidden"
                />
              )}
              </div>
          </nav>
        )}

        {isChatStarted && (canRename || canShare || canDelete || isAuthenticated) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn('size-11 shrink-0 rounded-[6px] px-0 sm:size-7', !(canRename || canDelete) && 'sm:hidden')}
                aria-label={t('chatToolbar.moreActions')}
                title={t('chatToolbar.moreActions')}
                data-testid="thread-menu"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem
                onSelect={handleNewSessionClick}
                disabled={!isAuthenticated}
                className="sm:hidden"
                data-testid="new-chat-menu-item"
              >
                <SquarePen className="size-4" aria-hidden="true" />
                {t('chatToolbar.newChat')}
              </DropdownMenuItem>
              {canRename && (
                <DropdownMenuItem disabled={isDeepResearchStreaming} onSelect={startEditingTitleFromMenu} data-testid="rename-session">
                  <PencilLine className="size-4" aria-hidden="true" />
                  {t('chatToolbar.rename')}
                </DropdownMenuItem>
              )}
              {canShare && (
                <DropdownMenuItem onSelect={() => setIsShareOpen(true)} className="sm:hidden" data-testid="share-button">
                  <Share2 className="size-4" aria-hidden="true" />
                  {tCollab('sharing.action')}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem variant="destructive" disabled={isDeepResearchStreaming} onSelect={() => setIsDeleteOpen(true)} data-testid="delete-session">
                  <Trash2 className="size-4" aria-hidden="true" />
                  {t('chatToolbar.delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {isChatStarted && changedOn && (
          <span className="text-muted-foreground text-meta hidden shrink-0 whitespace-nowrap pl-1 pr-2 md:inline" data-testid="chat-changed-on">
            {t('chatToolbar.changedOn', { date: changedOn })}
          </span>
        )}
      </div>

      {isChatStarted && (hasStatus || onlyReader || canShare) && (
      <div className="pointer-events-auto flex min-h-12 shrink-0 items-center gap-0.5 rounded-surface border border-base bg-card/60 p-0.5 backdrop-blur supports-[backdrop-filter]:bg-card/50 max-sm:hidden sm:min-h-8">
        <AnimatePresence initial={false}>
        {(hasStatus || onlyReader) && (
          <motion.div
            key="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionQuick}
            className="flex items-center gap-1 pl-1 pr-1.5"
          >
            {onlyReader && <OnlyYou label={tChat('privacy.onlyYouShort')} statement={tChat('privacy.onlyYou')} />}
            <ThreadStatus
              surface="desktop"
              sharingState={sharingState}
              currentUserId={currentUserId}
              isResearching={isDeepResearchStreaming}
              researchingLabel={t('chatToolbar.researching')}
              onOpenPeople={canShare ? () => setIsShareOpen(true) : undefined}
              className="contents"
            />
          </motion.div>
        )}
        </AnimatePresence>
        {canShare && (
          <>
            {(hasStatus || onlyReader) && <div aria-hidden="true" className="mr-1 h-4 w-px bg-border" />}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 rounded-[5px] px-2 text-xs font-medium"
              onClick={() => setIsShareOpen(true)}
              data-testid="share-open"
            >
              <Share2 className="size-4" aria-hidden="true" />
              {tCollab('sharing.action')}
            </Button>
          </>
        )}
      </div>
      )}
      </div>

      {isSharingReachable && isShareOpen && conversationId && (
        <ShareDialog
          open={isShareOpen}
          onOpenChange={setIsShareOpen}
          resourceId={conversationId}
          sharing={sharing}
          currentUserId={currentUserId}
        />
      )}
      <DeleteSessionConfirmationModal
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        sessionTitle={sessionTitle}
        onConfirm={async () => {
          if (currentSessionId) await onDeleteSession?.(currentSessionId)
        }}
      />
    </header>
  )
})

function OnlyYou({ label, statement }: { label: string; statement: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground h-7 gap-1.5 rounded-control px-2 text-xs font-medium" data-testid="chat-only-you">
          <Lock className="size-3.5" aria-hidden="true" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-sm" data-testid="chat-only-you-statement">
        {statement}
      </PopoverContent>
    </Popover>
  )
}

interface ThreadStatusProps {
  surface: 'phone' | 'desktop'
  sharingState: ResourceSharingState | null
  currentUserId: string | null
  isResearching: boolean
  researchingLabel: string
  onOpenPeople?: () => void
  className?: string
}

const ThreadStatus: FC<ThreadStatusProps> = ({
  surface,
  sharingState,
  currentUserId,
  isResearching,
  researchingLabel,
  onOpenPeople,
  className,
}) => {
  const showFaces = (sharingState?.entries.length ?? 0) > 1
  const showAccessChip = Boolean(sharingState && sharingState.visibility !== 'private' && !showFaces)
  return (
    <div className={className} data-status-surface={surface}>
      {showFaces && sharingState && (
        <ParticipantStrip
          entries={sharingState.entries}
          currentUserId={currentUserId}
          maxVisible={surface === 'phone' ? 1 : 3}
          onOpen={onOpenPeople}
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
