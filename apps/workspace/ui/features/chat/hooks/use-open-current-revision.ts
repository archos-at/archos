'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { toFileItem } from '@/features/documents/lib/file-item'
import { documentNameLookupKey, resolveDocumentsByName } from '@/features/documents/lib/documents-by-name'
import type { RevisionRef } from '@/lib/documents/revision-links'
import { useChatStore } from '../store'
import { useOpenStoredFile } from './use-open-stored-file'

export const useOpenCurrentRevision = (): ((current: RevisionRef) => Promise<void>) => {
  const t = useTranslations(chatCopy)
  const projectId = useChatStore((state) => state.projectId)
  const openFile = useOpenStoredFile()

  return useCallback(
    async (current: RevisionRef) => {
      const named = (await resolveDocumentsByName(projectId, [current.filename])).get(
        documentNameLookupKey(current.filename)
      )
      const projekt = named?.project.find((row) => row.id === current.id)
      const officeShelf = named?.officeShelf.find((row) => row.id === current.id)
      const row = projekt ?? officeShelf
      if (!row) {
        toast.error(t('citationPeek.currentRevisionUnavailable'))
        return
      }
      openFile({ file: toFileItem(row), corpus: projekt ? 'project' : 'office' })
    },
    [projectId, openFile, t]
  )
}
