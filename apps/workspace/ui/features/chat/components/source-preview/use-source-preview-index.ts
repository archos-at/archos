'use client'

import { useEffect, useState } from 'react'
import { useDocumentsGeneration } from '@/lib/documents/document-changes'
import { useChatStore } from '../../store'
import { loadSourcePreviewIndex, type SourcePreviewIndex } from './source-preview-index'

export const useSourcePreviewIndex = (
  projectId: string | null,
  conversationId: string | null,
  enabled: boolean,
  fileName: string | null
): SourcePreviewIndex | null => {
  const [index, setIndex] = useState<SourcePreviewIndex | null>(null)
  const generation = useDocumentsGeneration()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    loadSourcePreviewIndex(projectId, conversationId, fileName)
      .then((loaded) => {
        if (!cancelled) setIndex(loaded)
      })
      .catch(() => {
        if (!cancelled) setIndex({ storedDocuments: [], baseCorpusFiles: [] })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, conversationId, enabled, fileName, generation])

  return enabled ? index : null
}

export const useConversationId = (): string | null =>
  useChatStore((s) => s.currentConversation?.id ?? null)
