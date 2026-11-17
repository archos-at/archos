'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { ChatArea } from '@/features/layout/components'
import { installSharedThreadShim, seedSharedThread } from '../_fixtures/shared-thread'

const config: AppConfig = {
  authRequired: false,
  fileUpload: getFileUploadConfigFromEnv(),
}

installSharedThreadShim()

export default function SharedThreadPreviewPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const [ready, setReady] = useState(false)
  useEffect(() => {
    seedSharedThread()
    setReady(true)
  }, [])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <AppConfigProvider config={config}>
        <main className="bg-background flex h-dvh flex-col" data-testid="shared-thread-preview">
          {ready && <ChatArea isAuthenticated canCollaborate />}
        </main>
      </AppConfigProvider>
    </I18nProvider>
  )
}
