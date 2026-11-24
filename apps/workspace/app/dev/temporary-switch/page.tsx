'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { MainLayout } from '@/features/layout/components/MainLayout'
import { useChatStore } from '@/features/chat/store'
import { useLayoutStore } from '@/features/layout/store'
import { markConversationOnServer } from '@/features/chat/lib/conversation-on-server'
import type { ChatMessage, Conversation } from '@/features/chat/types'

// The whole chat surface (rail, thread or welcome, composer, privacy line) around
// the temporary switch, so `e2e/temporary-switch-no-shift.spec.ts` can press it
// and see every box that moves. `?case=personal|project|existing`.

const config: AppConfig = { authRequired: false, fileUpload: getFileUploadConfigFromEnv() }
const VIEWER = 'default-user'

const messages: ChatMessage[] = [
  {
    id: 'dev-temp-q',
    role: 'user',
    messageType: 'user',
    content: 'Wie breit muss ein Fluchtweg in einem Bürogebäude der Gebäudeklasse 4 sein?',
    timestamp: new Date('2026-11-20T09:00:00Z'),
  },
  {
    id: 'dev-temp-a',
    role: 'assistant',
    messageType: 'agent_response',
    content: 'Ein Fluchtweg muss mindestens **1,20 m** breit sein; bei mehr als 120 Personen je weitere 60 Personen um 0,60 m mehr.',
    timestamp: new Date('2026-11-20T09:00:05Z'),
  },
]

const older: Conversation = {
  id: 's_dev_temp_older',
  userId: VIEWER,
  projectId: null,
  title: 'Stellplatznachweis Tiefgarage',
  messages: [],
  createdAt: new Date('2026-11-18T09:00:00Z'),
  updatedAt: new Date('2026-11-18T09:00:00Z'),
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const realFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const id = /\/api\/conversations\/([^/?]+)$/.exec(url)?.[1]
    if (id && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body ?? '{}')) as { temporary?: boolean }
      return Promise.resolve(Response.json({ id: decodeURIComponent(id), temporary: body.temporary === true }))
    }
    if (url.includes('/api/')) return Promise.resolve(Response.json({}, { status: 404 }))
    return realFetch(input as RequestInfo, init)
  }) as typeof window.fetch
}

export default function TemporarySwitchPreview(): JSX.Element | null {
  if (process.env.NODE_ENV !== 'development') notFound()
  const [ready, setReady] = useState(false)
  const hasHydrated = useChatStore((state) => state.hasHydrated)

  useEffect(() => {
    if (!hasHydrated) return
    const kind = new URLSearchParams(window.location.search).get('case') ?? 'personal'
    const projectId = kind === 'project' ? 'dev' : null
    const existing: Conversation | null =
      kind === 'existing'
        ? { ...older, id: 's_dev_temp_existing', title: 'Fluchtwegbreite GK 4', messages, projectId }
        : null
    if (existing) markConversationOnServer(existing.id)
    useChatStore.setState({
      currentUserId: VIEWER,
      projectId,
      conversations: existing ? [existing, { ...older, projectId }] : [{ ...older, projectId }],
      currentConversation: existing,
      composerTemporary: false,
      hasHydrated: true,
    })
    useLayoutStore.setState({ knowledgeLayerAvailable: true })
    setReady(true)
  }, [hasHydrated])

  if (!ready) return null
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <AppConfigProvider config={config}>
        <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden md:flex-row">
          <main
            className="bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto outline-none"
            data-testid="temporary-switch-preview"
          >
            <MainLayout isAuthenticated canCollaborate />
          </main>
        </div>
      </AppConfigProvider>
    </I18nProvider>
  )
}
