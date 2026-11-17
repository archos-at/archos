'use client'

import { type ReactNode, Suspense, useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/adapters/auth'
import { MainLayout } from '@/features/layout'
import { useChatStore } from '@/features/chat/store'
import { conversationMatchesProject } from '@/features/chat/lib/project-scope'
import { newChatDropsFilePreview } from '@/features/documents/lib/ask-arrival'
import { fileItemFromStatus } from '@/features/documents/lib/document-question'
import { isUuid } from '@/lib/ids'
import { useCitationPeek } from '@/features/documents/hooks/use-citation-peek'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import { REVIEW_PARAM, showDocumentBeside } from '@/features/documents/lib/open-review'

export interface ProjectChatClientProps {
  projectId: string
  canCollaborate?: boolean
  canChatInProject?: boolean
  projectName: string | null
}

const ProjectChatContent = ({
  projectId,
  projectName,
  canCollaborate = false,
  canChatInProject = true,
}: ProjectChatClientProps): ReactNode => {
  const { isAuthenticated, signIn } = useAuth()
  const setProjectId = useChatStore((s) => s.setProjectId)
  const loadServerConversations = useChatStore((s) => s.loadServerConversations)
  const setComposerPrefill = useChatStore((s) => s.setComposerPrefill)
  const startNewSessionDraft = useChatStore((s) => s.startNewSessionDraft)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const sessionConversationCount = useChatStore((s) => s.conversations.length)
  const sessionServerLoaded = useChatStore((s) => s.serverConversationsLoaded)
  const sessionUserId = useChatStore((s) => s.currentUserId)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()


  const askPrefill = searchParams?.get('ask') ?? null
  const docPrefill = searchParams?.get('doc') ?? null
  const filePrefill = searchParams?.get('file') ?? null
  const consumedAskRef = useRef<string | null>(null)

  const newParam = searchParams?.get('new') ?? null
  const consumedNewRef = useRef(false)

  useEffect(() => {
    if (!newParam || !isAuthenticated || consumedNewRef.current) return
    consumedNewRef.current = true
    startNewSessionDraft()
    if (newChatDropsFilePreview(searchParams?.get('doc'))) {
      useFilePreviewStore.getState().close()
    }

    if (pathname) {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.delete('new')
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    }
  }, [newParam, isAuthenticated, searchParams, pathname, router, startNewSessionDraft])

  useEffect(() => {
    setProjectId(projectId)
    void loadServerConversations(projectId)
    return () => setProjectId(null)
  }, [projectId, setProjectId, loadServerConversations])

  const sessionParam = searchParams?.get('session') ?? null
  const sessionHydratedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated || !sessionParam || newParam) return
    if (sessionHydratedRef.current === sessionParam) return
    const state = useChatStore.getState()
    if (state.currentConversation?.id === sessionParam) {
      sessionHydratedRef.current = sessionParam
      return
    }
    state.setPendingMessagesFor(sessionParam)
    const giveUp = () => {
      sessionHydratedRef.current = sessionParam
      if (useChatStore.getState().pendingMessagesFor === sessionParam) state.setPendingMessagesFor(null)
    }
    if (!sessionUserId) return
    const target = state.conversations.find((c) => c.id === sessionParam)
    if (!target) {
      if (!sessionServerLoaded) return
      giveUp()
      return
    }
    if (!conversationMatchesProject(target, projectId) || target.userId !== sessionUserId) {
      giveUp()
      return
    }
    selectConversation(sessionParam)
    sessionHydratedRef.current = sessionParam
  }, [
    isAuthenticated,
    sessionParam,
    newParam,
    projectId,
    sessionConversationCount,
    sessionServerLoaded,
    sessionUserId,
    selectConversation,
  ])

  useEffect(
    () => () => {
      const state = useChatStore.getState()
      if (sessionParam && state.pendingMessagesFor === sessionParam && state.currentConversation?.id !== sessionParam) {
        state.setPendingMessagesFor(null)
      }
    },
    [sessionParam]
  )

  const runParam = searchParams?.get('run') ?? null
  const resolvedRunRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated || !runParam || sessionParam || !pathname) return
    if (resolvedRunRef.current === runParam) return
    resolvedRunRef.current = runParam

    let cancelled = false
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runParam)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { conversationId?: string | null } | null) => {
        if (cancelled || !body?.conversationId) return
        const params = new URLSearchParams(searchParams?.toString() ?? '')
        params.delete('run')
        params.set('session', body.conversationId)
        router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, runParam, sessionParam, projectId, pathname, router, searchParams])

  const reviewDoc =
    searchParams?.get(REVIEW_PARAM) && docPrefill && isUuid(docPrefill) ? docPrefill : null
  const reviewDocRef = useRef<string | null>(null)

  useEffect(() => {
    if (reviewDoc) {
      reviewDocRef.current = reviewDoc
      void showDocumentBeside(reviewDoc, { projectId, projectName, canCollaborate })
      return
    }
    const held = reviewDocRef.current
    if (!held) return
    if (docPrefill !== held || !pathname) {
      reviewDocRef.current = null
      return
    }
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('doc')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [reviewDoc, docPrefill, projectId, projectName, canCollaborate, pathname, router, searchParams])

  useEffect(() => {
    if (reviewDoc || (docPrefill !== null && docPrefill === reviewDocRef.current)) return
    const token = `${askPrefill ?? ''}|${docPrefill ?? ''}|${filePrefill ?? ''}`
    if ((!askPrefill && !docPrefill) || consumedAskRef.current === token) return
    consumedAskRef.current = token
    setComposerPrefill(
      askPrefill ?? '',
      undefined,
      docPrefill && isUuid(docPrefill)
        ? {
            resourceType: 'document',
            resourceId: docPrefill,
            filename: filePrefill,
            title: filePrefill,
            shelf: 'project',
          }
        : undefined
    )

    if (pathname) {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.delete('ask')
      params.delete('doc')
      params.delete('file')
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    }
  }, [askPrefill, docPrefill, filePrefill, reviewDoc, searchParams, pathname, router, setComposerPrefill])

  const composerSubject = useChatStore((s) => s.composerSubject)
  const subjectId = composerSubject?.resourceId ?? docPrefill

  useCitationPeek({ projectId, projectName, canCollaborate })

  useEffect(() => {
    if (!subjectId || !isUuid(subjectId)) return
    const preview = useFilePreviewStore.getState()
    if (preview.file?.id === subjectId) {
      preview.peek()
      return
    }
    let cancelled = false
    void fetch(`/api/documents/${encodeURIComponent(subjectId)}/status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.id) return
        const item = fileItemFromStatus(body)
        useFilePreviewStore.getState().open(item, 'peek', {
          projectId,
          projectName: projectName ?? undefined,
          scope: 'files',
          canCollaborate,
        })
        const subject = useChatStore.getState().composerSubject
        if (subject?.resourceId === item.id && !subject.filename) {
          useChatStore.getState().setComposerSubject({
            ...subject,
            title: subject.title || item.filename,
            filename: item.filename,
            shelf: subject.shelf ?? 'project',
          })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [subjectId, projectId, projectName, canCollaborate])

  return (
    <MainLayout
      isAuthenticated={isAuthenticated}
      onSignIn={signIn}
      canCollaborate={canCollaborate}
      canChatInProject={canChatInProject}
    />
  )
}

export const ProjectChatClient = (props: ProjectChatClientProps): ReactNode => {
  return (
    <Suspense fallback={null}>
      <ProjectChatContent {...props} />
    </Suspense>
  )
}

export default ProjectChatClient
