'use client'

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { documentDisplayName } from '@/lib/documents/display-name'
import type { FileItem, FolderItem } from '../file-types'
import { refusalOf, shelfRefusalOf, throwUnlessOk, type ShelfRefusal } from '../lib/move-refusal'

export function useDocumentMoves(
  files: readonly FileItem[],
  setFiles: Dispatch<SetStateAction<FileItem[]>>,
  folders: readonly FolderItem[]
) {
  const t = useTranslations(filesCopy)
  const inFlight = useRef(0)
  const isMoving = useCallback(() => inFlight.current > 0, [])

  const seen = useRef(new Map<string, FileItem>())
  useEffect(() => {
    for (const file of files) seen.current.set(file.id, file)
  }, [files])

  const moved = useCallback(
    (fileId: string, folderId: string | null) =>
      setFiles((prev) => {
        if (prev.some((f) => f.id === fileId)) return prev.map((f) => (f.id === fileId ? { ...f, folderId } : f))
        const known = seen.current.get(fileId)
        return known ? [...prev, { ...known, folderId }] : prev
      }),
    [setFiles]
  )

  const folderLabel = useCallback(
    (folderId: string | null) =>
      folderId ? (folders.find((folder) => folder.id === folderId)?.name ?? '') : t('folders.allFiles'),
    [folders, t]
  )

  const refusalMessage = useCallback(
    (refusal: ShelfRefusal | null): string => {
      if (refusal === 'ifcRestricted') return t('folders.access.ifcRefused')
      if (refusal === 'readOnly') return t('folders.moveRefusedReadOnly')
      if (refusal === 'gone') return t('folders.moveRefusedGone')
      return t('actions.moveError')
    },
    [t]
  )

  const undo = useRef<(documentId: string, folderId: string | null) => Promise<void>>(async () => {})

  const dropInFolder = useCallback(
    async (documentId: string, folderId: string | null, { undoable = true }: { undoable?: boolean } = {}) => {
      const file = seen.current.get(documentId) ?? files.find((candidate) => candidate.id === documentId)
      if (!file || (file.folderId ?? null) === folderId) return
      const previousFolderId = file.folderId ?? null
      const name = documentDisplayName(file)

      moved(documentId, folderId)
      seen.current.set(documentId, { ...file, folderId })
      inFlight.current += 1
      try {
        await throwUnlessOk(
          await fetch(`/api/documents/${documentId}/folder`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderId }),
          })
        )
        if (!undoable) {
          toast.success(t('folders.movedBack', { name, folder: folderLabel(folderId) }))
          return
        }
        toast.success(t('actions.moved', { name, folder: folderLabel(folderId) }), {
          action: {
            label: t('folders.moveUndo'),
            onClick: () => void undo.current(documentId, previousFolderId),
          },
        })
      } catch (error) {
        moved(documentId, previousFolderId)
        seen.current.set(documentId, file)
        toast.error(refusalMessage(refusalOf(error)))
      } finally {
        inFlight.current -= 1
      }
    },
    [files, moved, folderLabel, refusalMessage, t]
  )
  undo.current = (documentId, folderId) => dropInFolder(documentId, folderId, { undoable: false })

  const moveMany = useCallback(
    async (documentIds: readonly string[], folderId: string | null, folderName: string): Promise<number> => {
      const targets = files.filter((file) => documentIds.includes(file.id) && (file.folderId ?? null) !== folderId)
      if (targets.length === 0) return 0
      const previous = new Map(targets.map((file) => [file.id, file.folderId ?? null]))
      for (const file of targets) moved(file.id, folderId)

      const outcome = { moved: 0, refused: 0 }
      const queue = [...targets]
      const worker = async (): Promise<void> => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          const restore = (): void => moved(file.id, previous.get(file.id) ?? null)
          try {
            const response = await fetch(`/api/documents/${file.id}/folder`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folderId }),
            })
            if (response.ok) outcome.moved += 1
            else {
              if ((await shelfRefusalOf(response)) === 'ifcRestricted') outcome.refused += 1
              restore()
            }
          } catch {
            restore()
          }
        }
      }
      inFlight.current += 1
      try {
        await Promise.all(Array.from({ length: Math.min(MOVE_CONCURRENCY, targets.length) }, worker))
      } finally {
        inFlight.current -= 1
      }

      if (outcome.moved > 0) toast.success(t('selection.moved', { count: outcome.moved, folder: folderName }))
      const failed = targets.length - outcome.moved
      if (failed > 0) {
        toast.error(outcome.refused === failed ? t('folders.access.ifcRefused') : t('selection.moveFailed', { count: failed }))
      }
      return outcome.moved
    },
    [files, moved, t]
  )

  return { moved, dropInFolder, moveMany, isMoving }
}

const MOVE_CONCURRENCY = 4
