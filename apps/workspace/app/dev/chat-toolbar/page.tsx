'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { ChatToolbar } from '@/features/layout/components/ChatToolbar'
import { useChatStore } from '@/features/chat/store'
import { emptyRunLedger, setRunStatus } from '@/lib/runs/run-ledger'
import type { ResourceAccessEntry, ResourceSharingState } from '@/lib/sharing/types'

const config: AppConfig = {
  authRequired: false,
  fileUpload: getFileUploadConfigFromEnv(),
}

const ME = 'default-user'
const CONV_ID = 'conv-toolbar-preview'

const person = (userId: string, name: string) => ({
  userId,
  name,
  email: `${name.split(' ')[0]?.toLowerCase()}@buero.at`,
  profilePictureUrl: null,
})

const entry = (
  userId: string,
  name: string,
  role: ResourceAccessEntry['role'],
  reason: ResourceAccessEntry['reason'],
): ResourceAccessEntry => ({ person: person(userId, name), role, reason, grantedBy: null })

const ME_ENTRY = entry(ME, 'Matthias Bigl', 'owner', 'creator')

const sharingState = (
  resourceId: string,
  visibility: ResourceSharingState['visibility'],
  entries: ResourceAccessEntry[],
): ResourceSharingState =>
  ({
    resourceType: 'conversation',
    resourceId,
    visibility,
    allowedVisibilities: ['private', 'project'],
    myRole: 'owner',
    canManage: true,
    canEscalate: false,
    shared: entries.length > 1,
    entries,
  }) as ResourceSharingState

const ROWS = [
  {
    id: 'conv-empty',
    caption: 'Frischer, leerer Chat — nur die Tür zum Verlauf, ohne Pillen-Rahmen',
    sessionTitle: '',
    started: false,
    state: sharingState('conv-empty', 'private', [ME_ENTRY]),
  },
  {
    id: 'conv-solo',
    caption: 'Privater Einzel-Chat — keine Kollaborations-Möblierung',
    sessionTitle: 'Fluchtweglängen OG2',
    started: true,
    state: sharingState('conv-solo', 'private', [ME_ENTRY]),
  },
  {
    id: 'conv-shared',
    caption: 'Geteilt, lange Namen — der gemeldete Gedrängefall',
    sessionTitle: 'Wiener Garagengesetz — Stellplatzverpflichtung',
    started: true,
    state: sharingState('conv-shared', 'private', [
      ME_ENTRY,
      entry('u-anna', 'Anna Berger', 'collaborator', 'grant'),
      entry('u-tobias', 'Tobias Kern', 'collaborator', 'grant'),
    ]),
  },
  {
    id: 'conv-project',
    caption: 'Projektweit — die Regel ersetzt die Gesichter',
    sessionTitle: 'Brandschutz Stiegenhaus',
    started: true,
    state: sharingState('conv-project', 'project', [
      ME_ENTRY,
      entry('u-anna', 'Anna Berger', 'collaborator', 'visibility-project'),
    ]),
  },
] as const

const STATES_BY_ID = new Map<string, ResourceSharingState>(
  ROWS.map((row) => [row.id, row.state]),
)

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __chatToolbarShim?: boolean }
  if (!w.__chatToolbarShim) {
    w.__chatToolbarShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const match = /^\/api\/sharing\/conversation\/([^/?]+)$/.exec(url)
      const state = match ? STATES_BY_ID.get(decodeURIComponent(match[1])) : undefined
      if (state) return Response.json(state)
      if (url === '/api/health') {
        const offline = new URLSearchParams(window.location.search).get('variant') === 'offline'
        return Response.json({ ok: !offline }, { status: offline ? 503 : 200 })
      }
      return real(input, init)
    }

    class PreviewEventSource {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    ;(window as unknown as { EventSource: unknown }).EventSource = PreviewEventSource
  }
}

export default function ChatToolbarPreviewPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const [ready, setReady] = useState(false)
  useEffect(() => {
    const isRunning =
      new URLSearchParams(window.location.search).get('variant') === 'running'
    useChatStore.setState({
      currentUserId: ME,
      hasHydrated: true,
      ...(isRunning
        ? {
            currentConversation: {
              id: CONV_ID,
              userId: ME,
              title: 'Rettungswege Bürogebäude GK4 Wien',
              createdAt: new Date('2024-01-15T10:00:00Z'),
              updatedAt: new Date('2024-01-15T10:00:00Z'),
              messages: [
                {
                  id: 'run-1',
                  role: 'assistant' as const,
                  content: '',
                  messageType: 'agent_response' as const,
                  timestamp: new Date('2024-01-15T10:00:00Z'),
                  runLedger: setRunStatus(
                    emptyRunLedger('run-1', new Date('2024-01-15T10:00:00Z')),
                    'running',
                    new Date('2024-01-15T10:00:00Z')
                  ),
                },
              ],
            },
          }
        : {}),
    })
    setReady(true)
  }, [])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <AppConfigProvider config={config}>
        <main
          className="bg-background flex min-h-dvh flex-col gap-8 p-6"
          data-testid="chat-toolbar-preview"
        >
          {ready &&
            ROWS.map((row) => (
              <section key={row.id} className="flex flex-col gap-2">
                <p className="text-muted-foreground mx-auto w-full max-w-3xl text-xs">
                  {row.caption}
                </p>
                {/* The toolbar positions itself against this block, exactly as it
                    does against the chat plane in MainLayout. On the phone shell the
                    toolbar is its pills, and a line more while the connection
                    line speaks. */}
                <div className="relative h-20 rounded-lg border border-dashed border-base max-md:h-36">
                  <ChatToolbar
                    sessionTitle={row.sessionTitle}
                    conversationId={row.id}
                    currentUserId={ME}
                    isCollaborationEnabled
                    isChatStarted={row.started}
                  />
                </div>
              </section>
            ))}
        </main>
      </AppConfigProvider>
    </I18nProvider>
  )
}
