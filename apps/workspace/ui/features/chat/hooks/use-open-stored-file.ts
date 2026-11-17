'use client'

import { useCallback } from 'react'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { openFilePeek } from '@/features/documents/lib/open-file-peek'
import { isCitable } from '@/features/documents/components/document-status'
import type { StoredFile } from '@/features/documents/hooks/use-surfaced-documents'
import { useChatStore } from '../store'

export const useOpenStoredFile = (): ((stored: StoredFile) => void) => {
  const projectId = useChatStore((state) => state.projectId)
  const isMobile = useIsMobile()

  return useCallback(
    (stored: StoredFile) => {
      openFilePeek({
        file: stored.file,
        source: stored.corpus === 'office' ? 'office' : stored.corpus === 'session' ? 'session' : 'project',
        projectId,
        presentation: isMobile ? 'modal' : 'peek',
        bindComposerSubject: isCitable(stored.file),
      })
    },
    [projectId, isMobile]
  )
}
