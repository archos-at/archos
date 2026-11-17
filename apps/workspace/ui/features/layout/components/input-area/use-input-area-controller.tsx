import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { AtSign, Eye } from 'lucide-react'
import { toast } from 'sonner'

import {
  motionQuick,
  motionQuickExit,
  useIconSwapTransition,
  useMotionToken,
} from '@/components/motion'
import { useWebSocketChat, useIsCurrentSessionBusy } from '@/features/chat'
import { useChatStore } from '@/features/chat/store'
import { useRestrictingOtherProjects } from '@/features/chat/hooks/use-restricting-other-projects'
import { useChatScreening } from '@/features/chat/hooks/use-chat-screening'
import type { MaskedText } from '@/lib/upload-screening/content-screen'
import { composerCapabilities } from '@/features/collaboration/lib/composer-capabilities'
import { resolveAddressee, sendMessageOptions } from '@/features/collaboration/lib/composer-routing'
import { useLayoutStore } from '../../store'
import { computePresetSourceIds } from '../../lib/source-presets'
import {
  FIELD_SIZING_CONTENT,
  SEND_CONTROL_SWAP_GUARD_MS,
  TEXTAREA_MAX_HEIGHT_PX,
  mentionRefusalMessage,
  normalizeSendResult,
  releaseSoftKeyboard,
} from './composer-helpers'
import { useChatDropTarget } from '../chat-drop-zone'
import { composerDropRefusal } from '../../lib/composer-drop-refusal'
import { useAppConfig } from '@/shared/context'
import { useLocale, useTranslations } from '@/i18n'
import { captureCopy } from '@/i18n/namespaces/capture'
import { chatCopy } from '@/i18n/namespaces/chat'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { filesCopy } from '@/i18n/namespaces/files'
import { researchCopy } from '@/i18n/namespaces/research'
import { createDictationChannel, insertTranscript, type ComposerCaret } from '@/features/dictation'
import { photoIntake, prepareSitePhotos } from '@/features/documents/lib/site-photo'
import { type AttachSource } from '../ComposerAttach'
import { useFileUpload } from '@/features/documents'
import type { TrackedFile } from '@/features/documents/types'

import type { ResolvedSubjectIdentity } from '@/features/documents/components/composer-subject-bar'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import { useFilePeekBesideChat } from '@/features/documents/components/file-preview-host'

import {
  type MentionPickerAria,
  type MentionPickerHandle,
} from '@/features/collaboration/components/MentionPicker'
import { useAwaitingState, useMentionCandidates } from '@/features/collaboration/hooks/use-sharing'
import {
  bumpThreadRevision,
  useThreadRole,
  useThreadSharing,
  useTurnActorName,
} from '@/shared/collaboration/thread-sharing'
import { useTypingBroadcast } from '@/features/collaboration/hooks/use-typing-broadcast'
import {
  findMentionQuery,
  insertMention,
  type DraftMention,
  type MentionQuery,
} from '@/lib/mentions/mention-text'
import { type MentionCandidate } from '@/lib/mentions/types'
import { useSlashCommand } from '@/features/skills/hooks/use-slash-command'
import { useDocumentReference } from '@/features/search'
import type { DocumentHit } from '@/lib/search/search-wire'

export type ConnectionMode = 'sse' | 'websocket'

interface ScreeningHold {
  original: string
  masked: MaskedText
  heldText?: string
}

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
  const [composerNote, setComposerNote] = useState<{ text: string; tone: 'error' | 'info' } | null>(
    null
  )
  const rememberDictationCaret = useCallback((e: { currentTarget: HTMLTextAreaElement }) => {
    dictationCaretRef.current = {
      start: e.currentTarget.selectionStart,
      end: e.currentTarget.selectionEnd,
    }
  }, [])

  const [mentions, setMentions] = useState<DraftMention[]>([])
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const [mentionRequested, setMentionRequested] = useState(false)
  const [mentionAria, setMentionAria] = useState<MentionPickerAria>({
    listboxId: null,
    activeOptionId: null,
  })
  const mentionPickerRef = useRef<MentionPickerHandle>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const pendingCaretRef = useRef<number | null>(null)

  const [previewFile, setPreviewFile] = useState<TrackedFile | null>(null)
  const boundSessionUploadRef = useRef<string | null>(null)
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
  const ensureConversationExists = useChatStore((state) => state._ensureConversationExists)

  const composerPrefill = useChatStore((state) => state.composerPrefill)
  const consumeComposerPrefill = useChatStore((state) => state.consumeComposerPrefill)
  const composerSubject = useChatStore((state) => state.composerSubject)
  const setComposerSubject = useChatStore((state) => state.setComposerSubject)
  const previewFileId = useFilePreviewStore((state) => state.file?.id ?? null)
  const previewExpanded = useFilePreviewStore((state) => state.mode === 'expanded' && !state.hidden)
  const peekBesideChat = useFilePeekBesideChat()
  const fileDockVisible =
    (peekBesideChat || previewExpanded) &&
    previewFileId !== null &&
    previewFileId === composerSubject?.resourceId

  const getComposerDraft = useChatStore((state) => state.getComposerDraft)
  const setComposerDraft = useChatStore((state) => state.setComposerDraft)
  const clearComposerDraft = useChatStore((state) => state.clearComposerDraft)

  const currentSessionId = currentConversationId
  const loadedDraftSessionRef = useRef<string | undefined>(undefined)

  const chatProjectId = useChatStore((state) => state.projectId)
  const otherProjects = useRestrictingOtherProjects(currentConversationId)
  const {
    uploadFiles,
    sessionFiles,
    deleteFile,
    retryFile,
    isUploading,
    error: uploadError,
    clearError,
  } = useFileUpload({
    collectionName: currentConversationId,
    conversationProjectId: chatProjectId,
  })

  const pendingCount = sessionFiles.filter(
    (f) => f.status === 'uploading' || f.status === 'ingesting'
  ).length

  const [heldForUpload, setHeldForUpload] = useState<string | null>(null)
  const [screeningHold, setScreeningHold] = useState<ScreeningHold | null>(null)
  const screenChat = useChatScreening()

  useEffect(() => {
    const ready = sessionFiles.filter(
      (file) => file.status === 'success' || file.status === 'ingesting'
    )
    if (ready.length === 0) {
      boundSessionUploadRef.current = null
      return
    }
    const latest = ready[ready.length - 1]
    const id = latest.serverFileId ?? latest.id
    if (boundSessionUploadRef.current === id) return
    const current = useChatStore.getState().composerSubject
    if (current && current.resourceId !== boundSessionUploadRef.current) return
    boundSessionUploadRef.current = id
    setComposerSubject({
      resourceType: 'document',
      resourceId: id,
      title: latest.fileName,
      filename: latest.fileName,
      shelf: 'session',
    })
  }, [sessionFiles, setComposerSubject])

  const handleSubjectResolved = useCallback(
    ({ title, filename, shelf, versionId, versionState }: ResolvedSubjectIdentity) => {
      const current = useChatStore.getState().composerSubject
      if (!current) return
      setComposerSubject({
        ...current,
        ...(title ? { title } : {}),
        ...(filename ? { filename } : {}),
        ...(shelf ? { shelf } : {}),
        ...(versionId !== undefined ? { versionId } : {}),
        ...(versionState !== undefined ? { versionState } : {}),
      })
    },
    [setComposerSubject]
  )

  const {
    sendMessage,
    isLoading,
    respondToInteraction,
    pendingInteraction,
    noteSendIntent,
    steer,
    canSteer,
  } = wsChat

  const setRespondToInteractionFn = useChatStore((state) => state.setRespondToInteractionFn)
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
  const stopStreaming = useChatStore((s) => s.stopStreaming)

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

  const {
    data: mentionData,
    loading: mentionsLoading,
    restart: restartMentionCandidates,
  } = useMentionCandidates(currentSessionId ?? null, canCollaborate && mentionRequested)

  const mentionRetryRef = useRef<(() => void) | null>(null)
  mentionRetryRef.current =
    mentionData === null && !mentionsLoading ? restartMentionCandidates : null
  const ensureConversationRef = useRef<() => void>(() => {})
  ensureConversationRef.current = () => {
    ensureSession()
    void ensureConversationExists()
  }
  const mentionFragmentOpenRef = useRef(false)

  const syncMentionQuery = useCallback((value: string, caret: number | null) => {
    const range = caret === null ? null : findMentionQuery(value, caret)
    setMentionQuery(range)
    if (range) {
      if (!mentionFragmentOpenRef.current) {
        ensureConversationRef.current()
        mentionRetryRef.current?.()
      }
      mentionFragmentOpenRef.current = true
      setMentionRequested(true)
      return
    }
    mentionFragmentOpenRef.current = false
    setMentionDismissed(false)
  }, [])

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

  const mentionPickerOpen =
    canCollaborate &&
    mentionQuery !== null &&
    !mentionDismissed &&
    !draftLocked &&
    (mentionsLoading || mentionData !== null)

  const handleSubmit = useCallback(
    async (heldText?: string, maskedText?: string) => {
      const source = maskedText ?? heldText ?? message
      if (!source.trim() || (disabled && !steering)) return
      noteSendIntent()
      const currentMessage = source.trim()

      if (maskedText === undefined) {
        const screened = screenChat(currentMessage)
        if (screened.findings.length > 0) {
          setScreeningHold({ original: currentMessage, masked: screened, heldText })
          return
        }
      }
      const submittingSessionId = currentConversationId

      if (disabled && steering) {
        if (!steer({ text: currentMessage })) return
        setMessage('')
        setMentionQuery(null)
        onStoppedTyping()
        if (submittingSessionId) clearComposerDraft(submittingSessionId)
        return
      }

      if (isResponseMode && respondToInteraction) {
        setMessage('')
        releaseSoftKeyboard(textareaRef.current)
        onStoppedTyping()
        if (submittingSessionId) clearComposerDraft(submittingSessionId)
        respondToInteraction(currentMessage)
        return
      }

      const sent = resolveAddressee({
        text: currentMessage,
        mentions,
        awaitingHuman: threadAwaitsHuman,
        canCollaborate,
      })
      const sentHumans = sent.humans

      if (heldText === undefined && pendingCount > 0) {
        setHeldForUpload(currentMessage)
        setMessage('')
        setMentionQuery(null)
        onStoppedTyping()
        return
      }

      setMessage('')
      setMentionQuery(null)
      releaseSoftKeyboard(textareaRef.current)
      onStoppedTyping()
      try {
        const { ok, outcome } = normalizeSendResult(
          await (() => {
            const options = sendMessageOptions(sent.routing)
            return options ? sendMessage(currentMessage, options) : sendMessage(currentMessage)
          })()
        )
        if (!ok) {
          setMessage(currentMessage)
          const refusal = mentionRefusalMessage(outcome, sentHumans, tCollab)
          toast.error(refusal ?? t('inputArea.messageNotSent'), {
            description: refusal ? undefined : t('inputArea.messageNotSentDesc'),
          })
          return
        }
        if (submittingSessionId) clearComposerDraft(submittingSessionId)
        setMentions([])
        if (sent.mentions.length > 0 && submittingSessionId) {
          bumpThreadRevision(submittingSessionId)
        }
      } catch (error) {
        console.error('Failed to send message:', error)
        setMessage(currentMessage)
        toast.error(t('inputArea.messageNotSent'), {
          description: t('inputArea.messageNotSentDesc'),
        })
      }
    },
    [
      message,
      mentions,
      disabled,
      steering,
      steer,
      pendingCount,
      isResponseMode,
      respondToInteraction,
      sendMessage,
      noteSendIntent,
      screenChat,
      threadAwaitsHuman,
      canCollaborate,
      currentConversationId,
      clearComposerDraft,
      onStoppedTyping,
      t,
      tCollab,
    ]
  )

  useEffect(() => {
    if (heldForUpload === null || pendingCount > 0) return
    const text = heldForUpload
    setHeldForUpload(null)
    void handleSubmit(text)
  }, [heldForUpload, pendingCount, handleSubmit])

  const sendScreenedMasked = useCallback(() => {
    if (screeningHold === null) return
    setScreeningHold(null)
    void handleSubmit(screeningHold.heldText, screeningHold.masked.text)
  }, [screeningHold, handleSubmit])

  const editScreened = useCallback(() => {
    if (screeningHold === null) return
    setScreeningHold(null)
    if (screeningHold.heldText !== undefined && !message.trim()) setMessage(screeningHold.original)
    textareaRef.current?.focus()
  }, [screeningHold, message])

  const sendHeldNow = useCallback(() => {
    if (heldForUpload === null) return
    const text = heldForUpload
    setHeldForUpload(null)
    void handleSubmit(text)
  }, [heldForUpload, handleSubmit])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return

      if (slash.handleKeyDown(e, handleSubmit)) return
      if (reference.handleKeyDown(e, handleSubmit)) return

      if (mentionPickerOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          mentionPickerRef.current?.move(1)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          mentionPickerRef.current?.move(-1)
          return
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault()
          if (mentionPickerRef.current?.selectActive()) return
          setMentionDismissed(true)
          if (e.key === 'Enter') handleSubmit()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setMentionDismissed(true)
          textareaRef.current?.focus()
          return
        }
      }

      if (e.key !== 'Enter') return
      if (e.shiftKey) return
      if (e.repeat) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      handleSubmit()
    },
    [handleSubmit, mentionPickerOpen, slash, reference]
  )

  const composerHadFocusRef = useRef(false)
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      composerHadFocusRef.current =
        e.target instanceof Node && (composerRootRef.current?.contains(e.target) ?? false)
    }
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && composerRootRef.current?.contains(e.target)) return
      composerHadFocusRef.current = false
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  useEffect(() => {
    if (!showStop || cannotContribute) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      const target = e.target
      const fromComposer =
        (target === document.body && composerHadFocusRef.current) ||
        (target instanceof Node && (composerRootRef.current?.contains(target) ?? false))
      if (!fromComposer) return
      e.preventDefault()
      stopStreaming?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showStop, cannotContribute, stopStreaming])

  const handleSendControlClick = useCallback(() => {
    if (performance.now() - sendControlSwappedAtRef.current < SEND_CONTROL_SWAP_GUARD_MS) return
    if (showStop) {
      stopStreaming?.()
      return
    }
    void handleSubmit()
  }, [showStop, stopStreaming, handleSubmit])

  const handleSendControlKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.repeat && e.key === 'Enter') e.preventDefault()
  }, [])

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

  const photos = photoIntake(fileUploadConfig)
  const tCapture = useTranslations(captureCopy)

  const handleFilesSelected = useCallback(
    async (selected: File[], source: AttachSource = 'picker') => {
      if (selected.length === 0 || cannotContribute || isUploading || isBusy) return

      const { files, unconvertibleHeic } = await prepareSitePhotos(selected, {
        source,
        prefix: tCapture('photos.fileNamePrefix'),
        taken: sessionFiles.map((file) => file.fileName),
        imagesAccepted: photos.available,
      })
      if (unconvertibleHeic.length > 0) {
        setComposerNote({
          text: tCapture('photos.heicUnconvertible', { name: unconvertibleHeic.join(', ') }),
          tone: 'error',
        })
      }
      if (files.length === 0) return

      const sessionId = ensureSession()
      if (!sessionId) {
        console.error('Failed to create session for upload')
        return
      }

      await ensureConversationExists()
      await uploadFiles(files, { collectionOverride: sessionId })
    },
    [
      ensureSession,
      ensureConversationExists,
      uploadFiles,
      cannotContribute,
      isUploading,
      isBusy,
      sessionFiles,
      photos.available,
      tCapture,
    ]
  )

  const attachDropped = useCallback(
    (files: File[]) => void handleFilesSelected(files),
    [handleFilesSelected]
  )
  const dropRefusal = composerDropRefusal({
    canContribute: !cannotContribute,
    isStreaming,
    awaitsAnswer: isResponseMode,
    isUploading,
    knowledgeLayerAvailable,
  })
  useChatDropTarget(
    isAuthenticated
      ? { attach: attachDropped, refusal: dropRefusal ? t(`inputArea.${dropRefusal}`) : null }
      : null
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      void handleFilesSelected(files)
    },
    [handleFilesSelected]
  )

  const attachedFilesCount = sessionFiles.filter(
    (f) =>
      f.status === 'uploading' ||
      f.status === 'ingesting' ||
      f.status === 'success' ||
      f.status === 'held' ||
      f.status === 'stored'
  ).length

  let composerHint: ReactNode = null
  if (canCollaborate && isViewerInSharedThread) {
    composerHint = (
      <p
        data-testid="composer-viewer-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <Eye className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span>{tCollab('thread.viewerNotice')}</span>
      </p>
    )
  } else if (cannotChatInProject) {
    composerHint = (
      <p
        data-testid="composer-project-chat-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <Eye className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span>{tChat('composer.noProjectChatPermission')}</span>
      </p>
    )
  } else if (canCollaborate && otherPersonsTurnName) {
    composerHint = (
      <p
        data-testid="composer-busy-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <span>{tCollab('thread.composerBusy', { name: otherPersonsTurnName })}</span>
      </p>
    )
  } else if (taggedHumans.length > 0 && !agentTagged) {
    composerHint = (
      <p
        data-testid="composer-mention-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <AtSign className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span>
          {/* German inflects the verb, so joining names into the singular
              string produced "Anna Berger, Tobias Kern WIRD gefragt" — wrong
              grammar in the primary product language. This i18n layer has no
              plural rules, hence two keys. */}
          {taggedHumans.length === 1
            ? tCollab('mentions.composerHint', { name: taggedHumans[0]!.display })
            : tCollab('mentions.composerHintMany', {
                names: taggedHumans.map((mention) => mention.display).join(', '),
              })}
        </span>
      </p>
    )
  } else if (canCollaborate && threadAwaitsHuman && activeMentions.length === 0) {
    composerHint = (
      <p
        data-testid="composer-agent-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <span>{tCollab('mentions.addressee.agentHint')}</span>
      </p>
    )
  }

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
    previewFile,
    setPreviewFile,
    boundSessionUploadRef,
    manageFilesOpen,
    setManageFilesOpen,
    textareaRef,
    composerRootRef,
    fileUploadConfig,
    isBusy,
    currentConversationId,
    composerSubject,
    setComposerSubject,
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
    handleSubjectResolved,
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
    photos,
    tCapture,
    handleFilesSelected,
    handlePaste,
    attachedFilesCount,
    composerHint,
  }
}

export type InputAreaController = ReturnType<typeof useInputAreaController>
