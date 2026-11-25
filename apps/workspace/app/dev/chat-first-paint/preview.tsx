'use client'

import type { ReactNode } from 'react'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { getFileUploadConfigFromEnv } from '@/shared/config/file-upload'
import { ChatArea, InputArea } from '@/features/layout/components'
import { ComposerScrim } from '@/features/layout/components/ComposerScrim'
import { useComposerMetrics } from '@/features/layout/hooks/use-composer-metrics'
import { ChatArrivalProvider, useArrivalPredicted, useThreadPhase, type ChatArrival } from '@/features/layout/hooks/use-thread-phase'
import { motion } from '@/components/motion'

const config: AppConfig = {
  authRequired: false,
  fileUpload: getFileUploadConfigFromEnv(),
}

const Column = (): ReactNode => {
  const isThreadEmpty = useThreadPhase() === 'empty'
  const { composerRef, columnVars, composerStyle, composerMotion } = useComposerMetrics(isThreadEmpty, false, { predicted: useArrivalPredicted() })
  return (
    <div className="relative flex min-h-0 flex-1 flex-col [container-type:size]" style={columnVars} data-testid="chat-column">
      <ChatArea isAuthenticated />
      <ComposerScrim />
      <motion.div ref={composerRef} className="absolute inset-x-0 z-10 flex flex-col" style={composerStyle} {...composerMotion}>
        <InputArea isAuthenticated connectionMode="sse" />
      </motion.div>
    </div>
  )
}

export function ChatFirstPaintPreview({ arrival }: { arrival: ChatArrival }): ReactNode {
  return (
    <AppConfigProvider config={config}>
      <ChatArrivalProvider value={arrival}>
        <main className="bg-background flex h-dvh flex-col">
          <Column />
        </main>
      </ChatArrivalProvider>
    </AppConfigProvider>
  )
}
