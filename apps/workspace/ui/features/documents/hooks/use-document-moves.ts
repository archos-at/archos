'use client'

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { documentDisplayName } from '@/lib/documents/display-name'
import type { FileItem, FolderItem } from '../file-types'
import { refusalOf, shelfRefusalOf, throwUnlessOk, type ShelfRefusal } from '../lib/move-refusal'
import type { NameConflict } from '@/lib/documents/name-conflict'
import { moveConflictRow, movePatchBody, nameConflictOfResponse, type SentConflictChoice } from '../lib/name-conflict'
import type { AskNameConflicts } from './use-name-conflict-prompt'

const patchFolder = (documentId: string, folderId: string | null, onConflict?: SentConflictChoice): Promise<Response> =>
  fetch(`/api/documents/${documentId}/folder`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: movePatchBody(folderId, onConflict),
  })

const storedFilename = async (response: Response, conflict: NameConflict): Promise<string> => {
  const body: unknown = await response.json().catch(() => null)
  const filename = body && typeof body === 'object' ? (body as { filename?: unknown }).filename : undefined
  return typeof filename === 'string' && filename ? filename : conflict.suggestedName
}

interface HeldName {
  file: FileItem
  conflict: NameConflict
}

export function useDocumentMoves(
  files: readonly FileItem[],
  setFiles: Dispatch<SetStateAction<FileItem[]>>,
  folders: readonly FolderItem[],
  askConflicts?: AskNameConflicts
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

  const settleResolved = useCallback(
    (file: FileItem, folderId: string | null, choice: SentConflictChoice, filename: string) => {
      seen.current.delete(file.id)
      setFiles((prev) =>
        choice === 'replace'
          ? prev.filter((f) => f.id !== file.id)
          : prev.map((f) => (f.id === file.id ? { ...f, folderId, filename } : f))
      )
    },
    [setFiles]
  )

  const askAbout = useCallback(
    async (held: readonly HeldName[], folderId: string | null): Promise<Map<string, SentConflictChoice>> => {
      const chosen = new Map<string, SentConflictChoice>()
      if (!askConflicts || held.length === 0) return chosen
      const answer = await askConflicts({
        operation: 'move',
        folderName: folderLabel(folderId),
        rows: held.map(({ file, conflict }) => moveConflictRow({ id: file.id, name: documentDisplayName(file) }, conflict)),
      })
      for (const { file } of held) {
        const choice = answer?.get(file.id)
        if (choice && choice !== 'skip') chosen.set(file.id, choice)
      }
      return chosen
    },
    [askConflicts, folderLabel]
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
        const response = await patchFolder(documentId, folderId)
        const conflict = askConflicts ? await nameConflictOfResponse(response) : null
        if (conflict) {
          moved(documentId, previousFolderId)
          seen.current.set(documentId, file)
          const choice = (await askAbout([{ file, conflict }], folderId)).get(documentId)
          if (!choice) return
          const resolved = await patchFolder(documentId, folderId, choice)
          await throwUnlessOk(resolved)
          const filename = await storedFilename(resolved, conflict)
          settleResolved(file, folderId, choice, filename)
          toast.success(
            choice === 'replace'
              ? t('nameConflicts.movedAsRevision', { name, existing: conflict.existingName })
              : t('actions.moved', { name: filename, folder: folderLabel(folderId) })
          )
          return
        }
        await throwUnlessOk(response)
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
    [files, moved, folderLabel, refusalMessage, askConflicts, askAbout, settleResolved, t]
  )
  undo.current = (documentId, folderId) => dropInFolder(documentId, folderId, { undoable: false })

  const moveMany = useCallback(
    async (documentIds: readonly string[], folderId: string | null, folderName: string): Promise<number> => {
      const targets = files.filter((file) => documentIds.includes(file.id) && (file.folderId ?? null) !== folderId)
      if (targets.length === 0) return 0
      const previous = new Map(targets.map((file) => [file.id, file.folderId ?? null]))
      for (const file of targets) moved(file.id, folderId)

      const outcome = { moved: 0, refused: 0, skipped: 0 }
      const held: HeldName[] = []
      const send = async (batch: readonly FileItem[], choices?: ReadonlyMap<string, SentConflictChoice>): Promise<void> => {
        const queue = [...batch]
        const worker = async (): Promise<void> => {
          for (let file = queue.shift(); file; file = queue.shift()) {
            const restore = (): void => moved(file.id, previous.get(file.id) ?? null)
            const choice = choices?.get(file.id)
            try {
              const response = await patchFolder(file.id, folderId, choice)
              if (response.ok) {
                outcome.moved += 1
                const resolved = choice ? held.find((entry) => entry.file.id === file.id) : undefined
                if (choice && resolved) settleResolved(file, folderId, choice, await storedFilename(response, resolved.conflict))
                continue
              }
              restore()
              const conflict = askConflicts && !choice ? await nameConflictOfResponse(response) : null
              if (conflict) held.push({ file, conflict })
              else if ((await shelfRefusalOf(response)) === 'ifcRestricted') outcome.refused += 1
            } catch {
              restore()
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(MOVE_CONCURRENCY, batch.length) }, worker))
      }
      inFlight.current += 1
      try {
        await send(targets)
        if (held.length > 0) {
          const chosen = await askAbout(held, folderId)
          outcome.skipped = held.length - chosen.size
          const resend = held.map((entry) => entry.file).filter((file) => chosen.has(file.id))
          for (const file of resend) moved(file.id, folderId)
          await send(resend, chosen)
        }
      } finally {
        inFlight.current -= 1
      }

      if (outcome.moved > 0) toast.success(t('selection.moved', { count: outcome.moved, folder: folderName }))
      const failed = targets.length - outcome.moved - outcome.skipped
      if (failed > 0) {
        toast.error(outcome.refused === failed ? t('folders.access.ifcRefused') : t('selection.moveFailed', { count: failed }))
      }
      return outcome.moved
    },
    [files, moved, askConflicts, askAbout, settleResolved, t]
  )

  return { moved, dropInFolder, moveMany, isMoving }
}

const MOVE_CONCURRENCY = 4
