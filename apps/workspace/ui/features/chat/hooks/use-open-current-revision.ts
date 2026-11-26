'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { toFileItem } from '@/features/documents/lib/file-item'
import { resolveDocumentsById } from '@/features/documents/documents-by-id'
import type { RevisionRef } from '@/lib/documents/revision-links'
import { useChatStore } from '../store'
import { useOpenStoredFile } from './use-open-stored-file'

export const useOpenCurrentRevision = (): ((current: RevisionRef) => Promise<void>) => {
  const t = useTranslations(chatCopy)
  const projectId = useChatStore((state) => state.projectId)
  const openFile = useOpenStoredFile()

  return useCallback(
    async (current: RevisionRef) => {
      const found = (await resolveDocumentsById(projectId, [current.id])).get(current.id)
      const projekt = found?.project ?? null
      const row = projekt ?? found?.officeShelf ?? null
      if (!row) {
        toast.error(t('citationPeek.currentRevisionUnavailable'))
        return
      }
      openFile({ file: toFileItem(row), corpus: projekt ? 'project' : 'office' })
    },
    [projectId, openFile, t]
  )
}
