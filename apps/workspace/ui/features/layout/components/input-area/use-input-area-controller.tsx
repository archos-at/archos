import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
} from 'react'
import {
  motionQuick,
  motionQuickExit,
  useIconSwapTransition,
  useMotionToken,
} from '@/components/motion'
import { useWebSocketChat, useIsCurrentSessionBusy } from '@/features/chat'
import { useChatStore } from '@/features/chat/store'
import { excerptFor } from '@/features/chat/answer-excerpt'
import { useRestrictingOtherProjects } from '@/features/chat/hooks/use-restricting-other-projects'
import { useChatScreening } from '@/features/chat/hooks/use-chat-screening'
import { composerCapabilities } from '@/features/collaboration/lib/composer-capabilities'
import { resolveAddressee } from '@/features/collaboration/lib/composer-routing'
import { useAwaitingState } from '@/features/collaboration/hooks/use-sharing'
import { useTypingBroadcast } from '@/features/collaboration/hooks/use-typing-broadcast'
import {
  useThreadRole,
  useThreadSharing,
  useTurnActorName,
} from '@/shared/collaboration/thread-sharing'
import { insertMention } from '@/lib/mentions/mention-text'
import { type MentionCandidate } from '@/lib/mentions/types'
import { useSlashCommand } from '@/features/skills/hooks/use-slash-command'
import { useDocumentReference } from '@/features/search'
import type { DocumentHit } from '@/lib/search/search-wire'
import { useLayoutStore } from '../../store'
import { computePresetSourceIds } from '../../lib/source-presets'
import { FIELD_SIZING_CONTENT, TEXTAREA_MAX_HEIGHT_PX } from './composer-helpers'
import type { ComposerNote, ScreeningHold } from './composer-types'
import { renderComposerHint } from './composer-hint'
import { useComposerSubject } from '../../hooks/use-composer-subject'
import { useComposerMentions } from '../../hooks/use-composer-mentions'
import { useComposerSubmit } from '../../hooks/use-composer-submit'
import { useComposerKeyboard } from '../../hooks/use-composer-keyboard'
import { useComposerAttachments } from '../../hooks/use-composer-attachments'
import { useAppConfig } from '@/shared/context'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { filesCopy } from '@/i18n/namespaces/files'
import { researchCopy } from '@/i18n/namespaces/research'
import { createDictationChannel, insertTranscript, type ComposerCaret } from '@/features/dictation'
import { useFileUpload } from '@/features/documents'
import type { TrackedFile } from '@/features/documents/types'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import { useFilePeekBesideChat } from '@/features/documents/components/file-preview-host'

export type ConnectionMode = 'sse' | 'websocket'

export interface InputAreaProps {
  placeholder?: string
  isAuthenticated?: boolean
  connectionMode?: ConnectionMode
  canCollaborate?: boolean
  canChatInProject?: boolean
}

export function useInputAreaController({
  placeholder,
  isAuthenticated = false,
  connectionMode = 'websocket',
  canCollaborate = false,
  canChatInProject = true,
}: InputAreaProps) {
  const t = useTranslations(researchCopy)
  const tChat = useTranslations(chatCopy)
  const tCollab = useTranslations(collaborationCopy)
  const tFiles = useTranslations(filesCopy)
  const { locale } = useLocale()
  const [message, setMessage] = useState('')
  const dictationCaretRef = useRef<ComposerCaret | null>(null)
  const [composerNote, setComposerNote] = useState<ComposerNote | null>(null)
  const rememberDictationCaret = useCallback((e: { currentTarget: HTMLTextAreaElement }) => {
    dictationCaretRef.current = {
      start: e.currentTarget.selectionStart,
      end: e.currentTarget.selectionEnd,
    }
  }, [])

  const composerRef = useRef<HTMLDivElement>(null)
  const pendingCaretRef = useRef<number | null>(null)

  const [previewFile, setPreviewFile] = useState<TrackedFile | null>(null)
  const [manageFilesOpen, setManageFilesOpen] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRootRef = useRef<HTMLDivElement>(null)

  const { fileUpload: fileUploadConfig } = useAppConfig()

  const isBusy = useIsCurrentSessionBusy()

  const wsChat = useWebSocketChat({
    autoConnect: connectionMode === 'websocket',
    canCollaborate,
  })

  const currentConversationId = useChatStore((state) => state.currentConversation?.id)
  const ensureSession = useChatStore((state) => state.ensureSession)

  const composerPrefill = useChatStore((state) => state.composerPrefill)
  const consumeComposerPrefill = useChatStore((state) => state.consumeComposerPrefill)
  const composerSubject = useChatStore((state) => state.composerSubject)
  const setComposerSubject = useChatStore((state) => state.setComposerSubject)
  const composerExcerpt = useChatStore((state) => excerptFor(state.composerExcerpt, state.currentConversation?.id))
  const setComposerExcerpt = useChatStore((state) => state.setComposerExcerpt)
  const clearComposerExcerpt = useCallback(() => setComposerExcerpt(null), [setComposerExcerpt])
  useEffect(() => {
    if (composerExcerpt) textareaRef.current?.focus()
  }, [composerExcerpt])
  const previewFileId = useFilePreviewStore((state) => state.file?.id ?? null)
  const previewExpanded = useFilePreviewStore((state) => state.mode === 'expanded' && !state.hidden)
  const peekBesideChat = useFilePeekBesideChat()
  const fileDockVisible =
    (peekBesideChat || previewExpanded) &&
    previewFileId !== null &&
    previewFileId === composerSubject?.resourceId

  const getComposerDraft = useChatStore((state) => state.getComposerDraft)
  const setComposerDraft = useChatStore((state) => state.setComposerDraft)

  const currentSessionId = currentConversationId
  const loadedDraftSessionRef = useRef<string | undefined>(undefined)

  const chatProjectId = useChatStore((state) => state.projectId)
  const otherProjects = useRestrictingOtherProjects(currentConversationId)
  const upload = useFileUpload({
    collectionName: currentConversationId,
    conversationProjectId: chatProjectId,
  })
  const { sessionFiles, deleteFile, retryFile, isUploading, error: uploadError, clearError } = upload

  const pendingCount = sessionFiles.filter(
    (f) => f.status === 'uploading' || f.status === 'ingesting'
  ).length

  const [heldForUpload, setHeldForUpload] = useState<string | null>(null)
  const [screeningHold, setScreeningHold] = useState<ScreeningHold | null>(null)
  const screenChat = useChatScreening()

  const subject = useComposerSubject(sessionFiles)

  const setRespondToInteractionFn = useChatStore((state) => state.setRespondToInteractionFn)
  const { sendMessage, isLoading, respondToInteraction, pendingInteraction, noteSendIntent, canSteer } =
    wsChat
  useEffect(() => {
    setRespondToInteractionFn(respondToInteraction)
    return () => setRespondToInteractionFn(null)
  }, [respondToInteraction, setRespondToInteractionFn])

  const setChatSendFn = useChatStore((state) => state.setChatSendFn)
  useEffect(() => {
    setChatSendFn(sendMessage)
    return () => setChatSendFn(null)
  }, [sendMessage, setChatSendFn])

  const knowledgeLayerAvailable = useLayoutStore((s) => s.knowledgeLayerAvailable)
  const applySourcePreset = useLayoutStore((s) => s.applySourcePreset)
  const projectId = useChatStore((s) => s.projectId)

  useEffect(() => {
    if (!composerSubject) return
    if (composerSubject.shelf && composerSubject.shelf !== 'project') return
    const sources = useLayoutStore.getState().availableDataSources ?? []
    applySourcePreset('project', computePresetSourceIds('project', sources))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerSubject?.resourceId, composerSubject?.shelf, applySourcePreset])

  const isStreaming = useChatStore((s) => s.isStreaming)

  const isResponseMode = !!pendingInteraction

  const showStop = isStreaming && !isResponseMode
  const sendGlyph: 'stop' | 'sending' | 'send' = showStop ? 'stop' : isLoading ? 'sending' : 'send'
  const sendControlJobRef = useRef(showStop)
  const sendControlSwappedAtRef = useRef(Number.NEGATIVE_INFINITY)
  useLayoutEffect(() => {
    if (sendControlJobRef.current === showStop) return
    sendControlJobRef.current = showStop
    sendControlSwappedAtRef.current = performance.now()
  }, [showStop])
  const { enter: glyphEnter, exit: glyphExit } = useIconSwapTransition()
  const holdEnter = useMotionToken(motionQuick)
  const holdExit = useMotionToken(motionQuickExit)

  const otherPersonsTurnName = useTurnActorName(canCollaborate ? currentSessionId : null)

  const myThreadRole = useThreadRole(canCollaborate ? currentSessionId : null)
  const threadSharing = useThreadSharing(canCollaborate ? currentSessionId : null)

  const capabilities = composerCapabilities({
    isAuthenticated,
    canCollaborate,
    sharing: threadSharing,
    myRole: myThreadRole,
    mayChatInProject: canChatInProject,
    isBusy,
    isResponseMode,
    otherPersonsTurn: Boolean(otherPersonsTurnName),
    ownTurnStreaming: showStop,
  })

  const { onTyping, onStoppedTyping } = useTypingBroadcast({
    conversationId: currentSessionId ?? null,
    enabled: capabilities.canBroadcastTyping,
  })

  const isDisabledByAuth = !isAuthenticated
  const isViewerInSharedThread = capabilities.deniedBy === 'read-only-role'
  const cannotChatInProject = capabilities.deniedBy === 'no-project-chat-permission'
  const cannotContribute = !capabilities.canContribute
  const disabled = !capabilities.canCompose
  const draftLocked = !capabilities.canDraft
  const typingAhead = disabled && !draftLocked
  const steering = typingAhead && showStop && Boolean(canSteer)
  const typeAheadHintId = useId()

  const {
    mentions,
    setMentions,
    mentionQuery,
    setMentionQuery,
    setMentionDismissed,
    mentionAria,
    setMentionAria,
    mentionPickerRef,
    mentionData,
    mentionsLoading,
    syncMentionQuery,
    mentionPickerOpen,
  } = useComposerMentions({ currentSessionId, canCollaborate, draftLocked })

  useLayoutEffect(() => {
    if (FIELD_SIZING_CONTENT) return
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [message])

  useEffect(() => {
    if (loadedDraftSessionRef.current === currentSessionId) return
    loadedDraftSessionRef.current = currentSessionId
    setMessage(currentSessionId ? getComposerDraft(currentSessionId) : '')
  }, [currentSessionId, getComposerDraft])

  useEffect(() => {
    if (composerPrefill === null || isDisabledByAuth) return
    const existingDraft = currentSessionId ? getComposerDraft(currentSessionId) : ''
    const composerHasText = message.trim().length > 0 || existingDraft.trim().length > 0
    if (composerHasText) {
      consumeComposerPrefill()
      return
    }
    const prefill = consumeComposerPrefill()
    if (prefill === null) return
    setMessage(prefill.text)
    if (prefill.mentions && prefill.mentions.length > 0) setMentions(prefill.mentions)
    if (currentSessionId) setComposerDraft(currentSessionId, prefill.text)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
  }, [
    composerPrefill,
    consumeComposerPrefill,
    isDisabledByAuth,
    currentSessionId,
    getComposerDraft,
    setComposerDraft,
    message,
  ])

  const getPlaceholder = (): string => {
    if (!isAuthenticated) return t('inputArea.signInToStart')
    if (isResponseMode) return t('inputArea.typeResponse')
    if (steering) return t('inputArea.steer')
    if (typingAhead) return t('inputArea.typeAhead')
    if (isBusy) return t('inputArea.pleaseWait')
    if (composerSubject) {
      return tFiles('assignment.askingAbout', {
        name: composerSubject.title?.trim() || tFiles('assignment.thisFile'),
      })
    }
    return placeholder ?? tChat('composer.placeholder')
  }

  const handleValueChange = useCallback(
    (value: string, caret: number | null = value.length) => {
      if (isDisabledByAuth) return // Don't allow typing when not authenticated

      let sessionId = currentConversationId
      if (!sessionId && value.trim().length > 0) {
        sessionId = ensureSession()
        if (sessionId) loadedDraftSessionRef.current = sessionId
      }

      setMessage(value)
      setScreeningHold(null)
      if (sessionId) setComposerDraft(sessionId, value)
      syncMentionQuery(value, caret)
      syncSlashQueryRef.current?.(value, caret ?? value.length)
      syncReferenceQueryRef.current?.(value, caret ?? value.length)
      if (value.trim()) onTyping()
      else onStoppedTyping()
    },
    [
      isDisabledByAuth,
      currentConversationId,
      ensureSession,
      setComposerDraft,
      syncMentionQuery,
      onTyping,
      onStoppedTyping,
    ]
  )

  const handleMentionSomeone = useCallback(() => {
    if (cannotContribute) return
    const el = textareaRef.current
    const base = message.length > 0 && !message.endsWith(' ') ? `${message} ` : message
    const next = `${base}@`
    handleValueChange(next, next.length)
    setMentionDismissed(false)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.length, next.length)
    })
  }, [message, handleValueChange, cannotContribute])

  const syncMentionQueryFromElement = useCallback(
    (element: HTMLTextAreaElement) => {
      syncMentionQuery(element.value, element.selectionStart)
      syncSlashQueryRef.current?.(element.value, element.selectionStart)
      syncReferenceQueryRef.current?.(element.value, element.selectionStart)
    },
    [syncMentionQuery]
  )

  const syncSlashQueryRef = useRef<((text: string, caret: number) => void) | null>(null)
  const replaceComposerText = useCallback(
    (text: string, caret: number) => {
      pendingCaretRef.current = caret
      handleValueChange(text, caret)
    },
    [handleValueChange]
  )
  const slash = useSlashCommand({
    text: message,
    enabled: !cannotContribute && !isResponseMode,
    onReplaceText: replaceComposerText,
  })
  syncSlashQueryRef.current = slash.syncQuery

  const syncReferenceQueryRef = useRef<((text: string, caret: number) => void) | null>(null)
  const referenceScope = useMemo(
    () => (projectId ? { scope: 'project' as const, projectId } : {}),
    [projectId]
  )
  const pickReference = useCallback(
    (hit: DocumentHit) =>
      setComposerSubject({
        resourceType: 'document',
        resourceId: hit.id,
        title: hit.title ?? hit.name,
        filename: hit.filename,
        shelf: hit.shelf,
      }),
    [setComposerSubject]
  )
  const reference = useDocumentReference({
    text: message,
    enabled: !cannotContribute,
    scope: referenceScope,
    onReplaceText: replaceComposerText,
    onPick: pickReference,
  })
  syncReferenceQueryRef.current = reference.syncQuery

  const handleTranscript = useCallback(
    (transcript: string) => {
      const inserted = insertTranscript(message, transcript, dictationCaretRef.current)
      if (!inserted) return
      setComposerNote(null)
      dictationCaretRef.current = { start: inserted.caret, end: inserted.caret }
      replaceComposerText(inserted.value, inserted.caret)
    },
    [message, replaceComposerText]
  )

  const dictationChannel = useMemo(() => createDictationChannel(), [])
  const reportDictationError = useCallback(
    (text: string) => setComposerNote({ text, tone: 'error' }),
    []
  )
  const explainDictation = useCallback(
    (reason: string) => setComposerNote({ text: reason, tone: 'info' }),
    []
  )

  useEffect(() => {
    const caret = pendingCaretRef.current
    if (caret === null) return
    pendingCaretRef.current = null
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(caret, caret)
  }, [message])

  const { awaiting } = useAwaitingState(
    canCollaborate && threadSharing === 'shared' ? (currentSessionId ?? null) : null,
    canCollaborate && threadSharing === 'shared'
  )
  const threadAwaitsHuman = (awaiting?.pending.length ?? 0) > 0

  const addressee = useMemo(
    () =>
      resolveAddressee({
        text: message,
        mentions,
        awaitingHuman: threadAwaitsHuman,
        canCollaborate,
      }),
    [message, mentions, threadAwaitsHuman, canCollaborate]
  )
  const activeMentions = addressee.mentions
  const taggedHumans = addressee.humans
  const agentTagged = addressee.agentTagged

  const {
    handleSubmit,
    sendScreenedMasked,
    editScreened,
    sendHeldNow,
    handleSendControlClick,
    handleSendControlKeyDown,
  } = useComposerSubmit({
    wsChat,
    message,
    setMessage,
    mentions,
    setMentions,
    setMentionQuery,
    canCollaborate,
    threadAwaitsHuman,
    currentConversationId,
    disabled,
    steering,
    isResponseMode,
    showStop,
    pendingCount,
    heldForUpload,
    setHeldForUpload,
    screeningHold,
    setScreeningHold,
    screenChat,
    onStoppedTyping,
    textareaRef,
    sendControlSwappedAtRef,
  })

  const { handleKeyDown } = useComposerKeyboard({
    slash,
    reference,
    handleSubmit,
    mentionPickerOpen,
    mentionPickerRef,
    setMentionDismissed,
    textareaRef,
    composerRootRef,
    showStop,
    cannotContribute,
  })

  const handleMentionSelect = useCallback(
    (candidate: MentionCandidate) => {
      const range = mentionQuery
      if (!range) return
      const display = candidate.isAgent
        ? tCollab('mentions.picker.agentName')
        : candidate.person.name
      const { text, caret } = insertMention(message, range, display)

      pendingCaretRef.current = caret
      handleValueChange(text, caret)
      setMentions((current) => [...current, { targetId: candidate.targetId, display }])
      setMentionQuery(null)
      setMentionDismissed(false)
    },
    [handleValueChange, message, mentionQuery, tCollab]
  )

  const attachments = useComposerAttachments({
    isAuthenticated,
    cannotContribute,
    isBusy,
    isResponseMode,
    upload,
    setComposerNote,
  })

  const composerHint = renderComposerHint({
    canCollaborate,
    isViewerInSharedThread,
    cannotChatInProject,
    otherPersonsTurnName,
    taggedHumans,
    agentTagged,
    threadAwaitsHuman,
    activeMentionCount: activeMentions.length,
    tCollab,
    tChat,
  })

  return {
    canCollaborate,
    t,
    tChat,
    locale,
    message,
    composerNote,
    setComposerNote,
    rememberDictationCaret,
    mentionQuery,
    setMentionDismissed,
    mentionAria,
    setMentionAria,
    mentionPickerRef,
    composerRef,
    ...subject,
    previewFile,
    setPreviewFile,
    manageFilesOpen,
    setManageFilesOpen,
    textareaRef,
    composerRootRef,
    fileUploadConfig,
    isBusy,
    currentConversationId,
    composerSubject,
    setComposerSubject,
    composerExcerpt,
    clearComposerExcerpt,
    fileDockVisible,
    otherProjects,
    sessionFiles,
    deleteFile,
    retryFile,
    isUploading,
    uploadError,
    clearError,
    pendingCount,
    heldForUpload,
    screeningHold,
    isLoading,
    noteSendIntent,
    knowledgeLayerAvailable,
    projectId,
    isResponseMode,
    showStop,
    sendGlyph,
    glyphEnter,
    glyphExit,
    holdEnter,
    holdExit,
    isDisabledByAuth,
    cannotContribute,
    disabled,
    draftLocked,
    typingAhead,
    steering,
    typeAheadHintId,
    getPlaceholder,
    mentionData,
    mentionsLoading,
    handleValueChange,
    handleMentionSomeone,
    syncMentionQueryFromElement,
    slash,
    reference,
    handleTranscript,
    dictationChannel,
    reportDictationError,
    explainDictation,
    threadAwaitsHuman,
    activeMentions,
    mentionPickerOpen,
    sendScreenedMasked,
    editScreened,
    sendHeldNow,
    handleKeyDown,
    handleSendControlClick,
    handleSendControlKeyDown,
    handleMentionSelect,
    ...attachments,
    composerHint,
  }
}

export type InputAreaController = ReturnType<typeof useInputAreaController>
