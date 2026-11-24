import { useCallback, useEffect, useRef } from 'react'
import type { useFileUpload } from '@/features/documents'
import type { ResolvedSubjectIdentity } from '@/features/documents/components/composer-subject-bar'
import { useChatStore } from '@/features/chat/store'

export function useComposerSubject(sessionFiles: ReturnType<typeof useFileUpload>['sessionFiles']) {
  const boundSessionUploadRef = useRef<string | null>(null)
  const setComposerSubject = useChatStore((state) => state.setComposerSubject)

  useEffect(() => {
    const ready = sessionFiles.filter(
      (file) => file.status === 'success' || file.status === 'ingesting'
    )
    if (ready.length === 0) {
      boundSessionUploadRef.current = null
      return
    }
    const latest = ready[ready.length - 1]
    const id = latest.serverFileId ?? latest.id
    if (boundSessionUploadRef.current === id) return
    const current = useChatStore.getState().composerSubject
    if (current && current.resourceId !== boundSessionUploadRef.current) return
    boundSessionUploadRef.current = id
    setComposerSubject({
      resourceType: 'document',
      resourceId: id,
      title: latest.fileName,
      filename: latest.fileName,
      shelf: 'session',
    })
  }, [sessionFiles, setComposerSubject])

  const handleSubjectResolved = useCallback(
    ({ title, filename, shelf, versionId, versionState }: ResolvedSubjectIdentity) => {
      const current = useChatStore.getState().composerSubject
      if (!current) return
      setComposerSubject({
        ...current,
        ...(title ? { title } : {}),
        ...(filename ? { filename } : {}),
        ...(shelf ? { shelf } : {}),
        ...(versionId !== undefined ? { versionId } : {}),
        ...(versionState !== undefined ? { versionState } : {}),
      })
    },
    [setComposerSubject]
  )

  return { boundSessionUploadRef, handleSubjectResolved }
}
