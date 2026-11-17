'use client'

import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { InputArea } from '@/features/layout/components'
import { useChatStore } from '@/features/chat/store'
import { useLayoutStore } from '@/features/layout/store'
import { publishThreadRole } from '@/shared/collaboration/thread-sharing'

const config: AppConfig = {
  authRequired: false,
  fileUpload: getFileUploadConfigFromEnv(),
}

const photoConfig: AppConfig = {
  authRequired: false,
  fileUpload: getFileUploadConfigFromEnv(process.env, {
    imageUploadEnabled: true,
    vlmAvailable: true,
  }),
}

const CONVERSATION_ID = 'dev-composer-conv'
const VIEWER_ID = 'default-user'

export default function ComposerPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const hasHydrated = useChatStore((state) => state.hasHydrated)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!hasHydrated) return
    useChatStore.setState({
      currentUserId: VIEWER_ID,
      currentConversation: {
        id: CONVERSATION_ID,
        userId: VIEWER_ID,
        projectId: 'dev',
        title: 'Brandschutz Stiegenhaus Nord',
        messages: [],
        createdAt: new Date('2026-07-29T09:00:00Z'),
        updatedAt: new Date('2026-07-29T09:11:00Z'),
      },
      hasHydrated: true,
    })
    publishThreadRole(CONVERSATION_ID, 'viewer')
    useLayoutStore.setState({ knowledgeLayerAvailable: true })
    setReady(true)
  }, [hasHydrated])

  return (
    <AppConfigProvider config={config}>
      <main className="min-h-dvh bg-muted/30 px-4 py-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
          <h1 className="font-mono text-xs text-muted-foreground" data-testid="composer-preview">
            /dev/composer — chat composer (empty-thread state, desktop + mobile)
          </h1>

          <AppConfigProvider config={photoConfig}>
            <div>
              <div className="text-muted-foreground mb-2 font-mono text-xs">
                ↓ photos accepted (image-upload flag + vision model)
              </div>
              <InputArea isAuthenticated connectionMode="sse" />
            </div>
          </AppConfigProvider>

          <div>
            <div className="mb-2 font-mono text-xs text-muted-foreground">↓ desktop</div>
            <InputArea isAuthenticated connectionMode="sse" />
          </div>

          <div>
            <div className="mb-2 font-mono text-xs text-muted-foreground">↓ mobile width (390px)</div>
            <div className="w-[390px] max-w-full">
              <InputArea isAuthenticated connectionMode="sse" />
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-xs text-muted-foreground">
              ↓ viewer in a shared thread — read-only
            </div>
            {ready && (
              <InputArea isAuthenticated connectionMode="sse" canCollaborate />
            )}
          </div>
        </div>
      </main>
    </AppConfigProvider>
  )
}
