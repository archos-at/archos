'use client'

import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { ChatArea, InputArea } from '@/features/layout/components'
import { ChatToolbar } from '@/features/layout/components/ChatToolbar'
import { PhoneTabBar } from '@/components/shell/phone-tab-bar'
import { useComposerMetrics } from '@/features/layout/hooks/use-composer-metrics'
import { ComposerScrim } from '@/features/layout/components/ComposerScrim'
import { selectThreadPhase } from '@/features/layout/lib/thread-phase'
import { motion } from '@/components/motion'
import { useChatStore } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'

const config: AppConfig = {
  authRequired: false,
  fileUpload: getFileUploadConfigFromEnv(),
}

const populatedMessages: ChatMessage[] = [
  {
    id: 'dev-populated-q',
    role: 'user',
    messageType: 'user',
    content: 'Wie viele Rettungswege brauche ich für ein Bürogebäude der Gebäudeklasse 4 in Wien?',
    timestamp: new Date('2024-01-15T14:30:00'),
  },
  {
    id: 'dev-populated-a',
    role: 'assistant',
    messageType: 'agent_response',
    timestamp: new Date('2024-01-15T14:30:05'),
    content: `Für ein Bürogebäude der **Gebäudeklasse 4** sind in der Regel **zwei voneinander unabhängige Fluchtwege** erforderlich.

- **Erster Fluchtweg** — ein baulicher Rettungsweg über ein Sicherheitstreppenhaus.
- **Zweiter Fluchtweg** — ein zweiter baulicher Weg oder eine über die Feuerwehr anleiterbare Stelle.

Die maximale Fluchtweglänge bis zum sicheren Bereich beträgt **40 m** [1]; § 108 BO Wien verlangt zusätzlich den zweiten Weg [2].`,
    citations: [
      {
        id: 'src-1',
        content: 'OIB-Richtlinie 2 · Brandschutz',
        timestamp: new Date('2024-01-15'),
        origin: 'kb',
        isCited: true,
        number: 1,
      },
      {
        id: 'src-2',
        content: 'Bauordnung für Wien § 108',
        timestamp: new Date('2024-01-15'),
        origin: 'ris',
        isCited: true,
        number: 2,
      },
    ],
    answerConfidence: 'high',
    skillsActivated: ['piloti-voice', 'fluchtweg-bemessung'],
    stages: {
      followUps: {
        items: [
          { question: 'Welche Gebäudeklasse ergibt sich für mein Projekt?' },
          { question: 'Was ändert sich beim Sprung von GK 4 auf GK 5?' },
        ],
      },
    },
  },
]

export default function ChatWelcomePreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const [variant, setVariant] = useState<string | null | undefined>(undefined)
  const [chrome, setChrome] = useState(false)
  useEffect(() => setChrome(new URLSearchParams(window.location.search).get('chrome') === '1'), [])
  useEffect(() => {
    setVariant(new URLSearchParams(window.location.search).get('variant'))
  }, [])
  const isPopulated = variant === 'populated'

  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (variant === undefined) return
    const seededConversation = {
      id: 'dev-welcome-conv',
      userId: 'default-user',
      projectId: 'dev',
      title: 'Dev',
      messages: isPopulated ? populatedMessages : [],
      createdAt: new Date('2024-01-15'),
      updatedAt: new Date('2024-01-15'),
    }
    useChatStore.setState({
      conversations: [seededConversation],
      currentConversation: seededConversation,
      hasHydrated: true,
    })
    setReady(true)
  }, [variant, isPopulated])

  const isThreadEmpty = useChatStore((s) => selectThreadPhase(s) === 'empty')
  const { composerRef, columnVars, composerStyle, composerMotion } =
    useComposerMetrics(isThreadEmpty)

  if (variant === undefined) return null

  return (
    <AppConfigProvider config={config}>
      <main className="bg-background flex h-dvh flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col" style={columnVars}>
          {chrome && <ChatToolbar isChatStarted={!isThreadEmpty} sessionTitle={isThreadEmpty ? '' : 'Stellplatznachweis Tiefgarage'} />}
          {ready && <ChatArea isAuthenticated />}
          <ComposerScrim />
          <motion.div
            ref={composerRef}
            className="absolute inset-x-0 z-10 flex flex-col"
            style={composerStyle}
            {...composerMotion}
          >
            {/* `canCollaborate` is on so the addressee line renders at all: its
                default state is now silent, and an empty row is exactly the
                evidence this capture is for. */}
            {ready && (
              <InputArea isAuthenticated connectionMode="sse" canCollaborate />
            )}
          </motion.div>
        </div>
        {chrome && <PhoneTabBar projectId="dev" canAccessOfficeShelf canAccessInbox pathname="/app/projects/dev/chat" />}
      </main>
    </AppConfigProvider>
  )
}
