'use client'

import { type CSSProperties, type FC, useCallback, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { ChatToolbar } from './ChatToolbar'
import { SessionsPanel } from './SessionsPanel'
import { ChatArea } from './ChatArea'
import { ComposerScrim } from './ComposerScrim'
import { InputArea } from './InputArea'
import { ChatDropZone } from './chat-drop-zone'
import { RightsLostPanel } from './RightsLostPanel'
import { WithheldFromHere } from './WithheldFromHere'
import { useChatStore } from '@/features/chat/store'
import { NoSourcesBanner, ChatUsageNotice } from '@/features/chat'
import { ConversationPrivacyLine } from '@/features/chat/conversation-privacy'
import { NewChatMailLine } from './new-chat-mail-line'
import { useSessionUrl } from '@/hooks/use-session-url'
import { documentDisplayName } from '@/lib/documents/display-name'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import { ViewerActionHost } from '@/features/documents/components/viewer-action-host'
import { useComposerMetrics } from '../hooks/use-composer-metrics'
import { useKeyboardUp } from '@/components/shell/use-keyboard-up'
import { useChatStarted, useLinkedChatPending } from '../hooks/use-chat-started'
import { useSessionRows } from '../hooks/use-session-rows'
import { useChatDeleteFeedback } from '../hooks/use-chat-delete-feedback'
import { chatSideOf } from '@/components/shell/rail-mode'
import { motion } from '@/components/motion'
import { useArrivalPredicted, useThreadPhase } from '../hooks/use-thread-phase'
import { TOOLBAR_CLEAR_VAR, toolbarClearance } from '../lib/toolbar-clearance'

interface MainLayoutProps {
  isAuthenticated?: boolean
  onSignIn?: () => void
  canCollaborate?: boolean
  canChatInProject?: boolean
}

export const MainLayout: FC<MainLayoutProps> = ({
  isAuthenticated = false,
  onSignIn,
  canCollaborate = false,
  canChatInProject = true,
}) => {
  const {
    currentConversationId,
    currentConversationTitle,
    currentConversationLocked,
    currentConversationPartlyReadable,
    currentUserId,
    projectId,
  } = useChatStore(
    useShallow((s) => ({
      currentConversationId: s.currentConversation?.id,
      currentConversationTitle: s.currentConversation?.title,
      currentConversationLocked: s.currentConversation?.contentLocked === true,
      currentConversationPartlyReadable: s.currentConversation?.withheldFrom !== undefined,
      currentUserId: s.currentUserId,
      projectId: s.projectId,
    }))
  )
  const linkedChatPending = useLinkedChatPending()
  const isThreadEmpty = useThreadPhase() === 'empty' && !linkedChatPending
  const chatStarted = useChatStarted()
  const routeSide = chatSideOf(usePathname() ?? '')
  const sessions = useSessionRows(routeSide)
  const chatSide = routeSide === undefined ? (projectId ?? null) : routeSide
  const deleteFeedback = useChatDeleteFeedback()

  const selectConversation = useChatStore((s) => s.selectConversation)
  const startNewSessionDraft = useChatStore((s) => s.startNewSessionDraft)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const deleteAllConversations = useChatStore((s) => s.deleteAllConversations)
  const updateConversationTitle = useChatStore((s) => s.updateConversationTitle)

  const isMobile = useIsMobile()
  const peekedFile = useFilePreviewStore((s) => s.file)
  const previewHidden = useFilePreviewStore((s) => s.hidden)
  const previewMode = useFilePreviewStore((s) => s.mode)
  const expandFile = useFilePreviewStore((s) => s.expand)
  const tFiles = useTranslations(filesCopy)

  const keyboardUp = useKeyboardUp()
  const { composerRef, columnVars, composerStyle, composerMotion } =
    useComposerMetrics(isThreadEmpty, keyboardUp, { predicted: useArrivalPredicted() })

  const [toolbarHeight, setToolbarHeight] = useState<number | null>(null)
  const toolbarVars = useMemo<CSSProperties>(
    () =>
      toolbarHeight == null
        ? {}
        : { [TOOLBAR_CLEAR_VAR as string]: toolbarClearance(toolbarHeight) },
    [toolbarHeight]
  )

  const { updateSessionUrl, clearSessionUrl } = useSessionUrl({ isAuthenticated })

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      selectConversation(sessionId)
      updateSessionUrl(sessionId)
    },
    [selectConversation, updateSessionUrl]
  )

  const handleNewSession = useCallback(() => {
    startNewSessionDraft()
    useFilePreviewStore.getState().close()
    clearSessionUrl()
  }, [startNewSessionDraft, clearSessionUrl])

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const wasCurrentSession = currentConversationId === sessionId
      try {
        await deleteConversation(sessionId)
      } catch (error) {
        deleteFeedback.failed(error, 'one')
        throw error
      }
      if (wasCurrentSession) clearSessionUrl()
    },
    [deleteConversation, currentConversationId, clearSessionUrl, deleteFeedback]
  )

  const handleDeleteAllSessions = useCallback(async () => {
    const openBefore = useChatStore.getState().currentConversation?.id ?? null
    try {
      const result = await deleteAllConversations({ projectId: chatSide })
      deleteFeedback.deletedAll(result)
      if (openBefore && result.deleted.includes(openBefore)) clearSessionUrl()
    } catch (error) {
      deleteFeedback.failed(error, 'all')
      throw error
    }
  }, [deleteAllConversations, chatSide, clearSessionUrl, deleteFeedback])

  const content = (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* Main Content Area - using explicit widths instead of flex for smoother animation */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Center Content: Chat + Input - Responsive to research panel. The
            whole column is the drop target for attachments, toolbar and
            transcript included, not only the composer card (`ChatDropZone`). */}
        <ChatDropZone
          className="flex min-w-0 flex-col overflow-hidden [container-type:size]"
          style={{
            width: '100%',
            ...columnVars,
            ...toolbarVars,
          }}
        >
          {/* Top fade scrim: the soft lower edge of the thread header. The header
              is opaque now (ticket #38, R1), so this is solid to the header's
              bottom (`--chat-toolbar-clear` is its height plus an 8px breath) and
              fades over the next 1rem, so text scrolling up dissolves into the
              band instead of meeting a hard line. Its solid stop used to be the
              clearance less 4rem, which on a phone's two-row header left the
              whole pill row over the fade, with the thread readable behind it. */}
          <div
            aria-hidden="true"
            className="from-background pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(var(--chat-toolbar-clear,3.5rem)+0.5rem)] bg-gradient-to-b from-[length:calc(var(--chat-toolbar-clear,3.5rem)-0.5rem)] to-transparent"
          />

          {/* The thread header: an opaque band in the page's tone over the top of
              the chat plane. Sits inside the center column so it spans only the
              chat, not the research panel (which has its own header). */}
          <ChatToolbar
            sessionTitle={currentConversationTitle}
            onNewSession={handleNewSession}
            isChatStarted={chatStarted}
            onDeleteSession={handleDeleteSession}
            conversationId={currentConversationId ?? null}
            isCollaborationEnabled={canCollaborate}
            currentUserId={currentUserId}
            onHeightChange={setToolbarHeight}
          />

          {isMobile && peekedFile && previewMode !== 'modal' && previewMode !== 'expanded' && (
            <button data-attr="chat-expand-file"
              type="button"
              onClick={expandFile}
              className="bg-card/70 supports-[backdrop-filter]:bg-card/60 absolute left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] top-[var(--chat-toolbar-clear,calc(max(0.5rem,var(--chat-inset-top,env(safe-area-inset-top)))+3.5rem))] z-20 flex min-h-11 items-center gap-2 rounded-surface px-3 py-1.5 text-left backdrop-blur shadow-xs"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {documentDisplayName(peekedFile)}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {previewHidden ? tFiles('assignment.showFile') : tFiles('assignment.expandFile')}
              </span>
            </button>
          )}

          {/* A chat the reader may no longer read whole (ADR-0088) has no
              composer. They see what comes before its first answer resting on
              a source they may not open (ADR-0194), or nothing of it. */}
          {currentConversationLocked && currentConversationPartlyReadable ? (
            <>
              <ChatArea isAuthenticated={isAuthenticated} onSignIn={onSignIn} canCollaborate={false} />
              <WithheldFromHere />
            </>
          ) : currentConversationLocked ? (
            <RightsLostPanel />
          ) : (
            <>
              {/* Chat Area - Scrollable, extends behind the floating composer AND
              the floating toolbar */}
              <ChatArea
                isAuthenticated={isAuthenticated}
                onSignIn={onSignIn}
                canCollaborate={canCollaborate}
              />

              {/* The scrims under and above the floating composer (`ComposerScrim`). */}
              <ComposerScrim />

              {/* What the agent's viewer actions move, for this page only (ADR-0144). */}
              <ViewerActionHost />

              {/* Floating composer stack: overlays the bottom of the chat scroll
              area instead of docking below it, so messages scroll behind the
              translucent input. ChatArea pads its bottom to keep the last
              message readable above it. The SAME column as the answer above it
              (`thread-column.ts`): it used to be narrower, to read as a separate
              object, and its edges then stood inside the answer's (ticket #38);
              its glass surface is what sets it apart. */}
              <motion.div
                ref={composerRef}
                className="absolute inset-x-0 z-10 flex flex-col"
                style={composerStyle}
                {...composerMotion}
              >
                {/* No sources warning - shown when no data sources or files available */}
                <NoSourcesBanner isAuthenticated={isAuthenticated} />

                {/* The budget, before it stops this person (lib/budgets/usage-notice.ts) */}
                <ChatUsageNotice isAuthenticated={isAuthenticated} />

                {/* Input Area - Using WebSocket mode for full HITL (human-in-the-loop) support */}
                <InputArea
                  isAuthenticated={isAuthenticated}
                  connectionMode="websocket"
                  canCollaborate={canCollaborate}
                  canChatInProject={canChatInProject}
                />

                {/* Who reads this chat and what is kept from it (ADR-0180). */}
                <ConversationPrivacyLine
                  conversationId={currentConversationId ?? null}
                  canCollaborate={canCollaborate}
                  statesTemporary={chatStarted}
                />
                {!chatStarted && <NewChatMailLine projectId={projectId ?? null} />}
              </motion.div>
            </>
          )}
        </ChatDropZone>
      </div>

      {/* Overlay Panels - These slide over the content */}

      {/* Sessions Panel (Left) - Only functional when authenticated */}
      <SessionsPanel
        sessions={sessions}
        selectedSessionId={currentConversationId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onDeleteAllSessions={handleDeleteAllSessions}
        onRenameSession={updateConversationTitle}
        projectId={projectId ?? undefined}
        side={chatSide ? 'project' : 'personal'}
      />
    </div>
  )

  return content
}
