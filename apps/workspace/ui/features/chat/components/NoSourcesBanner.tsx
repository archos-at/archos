'use client'

import { type FC, useState, useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AnimatePresence } from '@/components/motion'
import { HeightArrival } from '@/components/motion/height-arrival'
import { THREAD_COLUMN, THREAD_GUTTER } from '@/components/ui/thread-column'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useLayoutStore } from '@/features/layout/store'
import { useDocumentsStore } from '@/features/documents/store'
import { useChatStore } from '../store'

interface NoSourcesBannerProps {
  isAuthenticated?: boolean
}

export const NoSourcesBanner: FC<NoSourcesBannerProps> = ({ isAuthenticated = false }) => {
  const t = useTranslations(chatCopy)
  const [isDismissedByUser, setIsDismissedByUser] = useState(false)

  const enabledDataSourceIds = useLayoutStore((state) => state.enabledDataSourceIds)
  const knowledgeLayerAvailable = useLayoutStore((state) => state.knowledgeLayerAvailable)
  const sessionId = useChatStore((state) => state.currentConversation?.id)

  const hasAvailableFiles = useDocumentsStore((state) =>
    state.trackedFiles.some(
      (f) => f.collectionName === sessionId && f.status === 'success'
    )
  )

  const hasAnySources = enabledDataSourceIds.length > 0 || knowledgeLayerAvailable
  const shouldShow = !hasAnySources && !hasAvailableFiles

  const prevShouldShowRef = useRef(shouldShow)

  useEffect(() => {
    const prev = prevShouldShowRef.current
    if (prev && !shouldShow) {
      setIsDismissedByUser(false)
    }
    prevShouldShowRef.current = shouldShow
  }, [shouldShow])

  const handleDismiss = () => {
    setIsDismissedByUser(true)
  }

  const visible = isAuthenticated && shouldShow && !isDismissedByUser

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <HeightArrival key="no-sources" className={cn(THREAD_COLUMN, THREAD_GUTTER)}>
          <Alert variant="warning" className="relative">
            <AlertTriangle />
            <AlertDescription className="pr-6">{t('noSources.warning')}</AlertDescription>
            <button data-attr="chat-dismiss"
              type="button"
              onClick={handleDismiss}
              aria-label={t('actions.dismiss')}
              className="text-muted-foreground hover:text-foreground duration-quick absolute right-3 top-3 rounded-control transition-colors ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </Alert>
        </HeightArrival>
      )}
    </AnimatePresence>
  )
}
