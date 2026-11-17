'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isProjectClosedBody } from '@/lib/projects/project-status'
import { formatCalendarDate } from '@/lib/format'
import type { FileItem, FolderItem } from '../file-types'
import type { FolderAccessLevel } from '../lib/file-shelf'
import { refusalOf, shelfRefusalOf, throwUnlessOk } from '../lib/move-refusal'

export interface FolderTreeOptions {
  foldersUrl: string
  initialFolders?: readonly FolderItem[]
  initialRootAccess?: FolderAccessLevel
  files: readonly FileItem[]
  documentCountIn?: (folderId: string) => number
  selectedFolderId: string | null
  onSelectFolder: (id: string | null) => void
  reloadFiles: (quiet?: boolean) => Promise<unknown>
  binHref?: string
}

export function useFolderTree({
  foldersUrl,
  initialFolders,
  initialRootAccess = 'write',
  files,
  documentCountIn,
  selectedFolderId,
  onSelectFolder,
  reloadFiles,
  binHref,
}: FolderTreeOptions) {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const router = useRouter()
  const [folders, setFolders] = useState<FolderItem[]>(() => [...(initialFolders ?? [])])
  const [isLoading, setIsLoading] = useState(initialFolders === undefined)
  const [hasAnswer, setHasAnswer] = useState(initialFolders !== undefined)
  const [error, setError] = useState(false)
  const [rootAccess, setRootAccess] = useState<FolderAccessLevel>(initialRootAccess)

  const generation = useRef(0)
  const answered = useRef(initialFolders !== undefined)
  const load = useCallback(() => {
    const stamp = ++generation.current
    setIsLoading(true)
    setError(false)
    return fetch(foldersUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load folders (${response.status})`)
        return response.json()
      })
      .then((data: { folders?: FolderItem[]; rootAccess?: FolderAccessLevel }) => {
        if (stamp !== generation.current) return
        setFolders(data.folders ?? [])
        setRootAccess(data.rootAccess === 'read' ? 'read' : 'write')
        answered.current = true
      })
      .catch(() => {
        if (stamp !== generation.current || answered.current) return
        setFolders([])
        setError(true)
      })
      .finally(() => {
        if (stamp !== generation.current) return
        setIsLoading(false)
        setHasAnswer(true)
      })
  }, [foldersUrl])

  const seeded = useRef(initialFolders !== undefined)
  useEffect(() => {
    if (seeded.current) {
      seeded.current = false
      return
    }
    void load()
  }, [load])

  const parentName = useCallback(
    (parentId: string | null) =>
      parentId ? (folders.find((f) => f.id === parentId)?.name ?? '') : t('folders.allFiles'),
    [folders, t]
  )

  const create = useCallback(
    async (name: string, parentId?: string) => {
      const response = await fetch(foldersUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
      })
      if (!response.ok) {
        toast.error(
          (await shelfRefusalOf(response)) === 'nameTaken'
            ? t('folders.nameTaken', { name, parent: parentName(parentId ?? null) })
            : t('workspace.createFolderError')
        )
        return false
      }
      const data = await response.json()
      setFolders((prev) => [...prev, data.folder])
      return true
    },
    [foldersUrl, parentName, t]
  )

  const rename = useCallback(
    async (folderId: string, name: string) => {
      const response = await fetch(`${foldersUrl}/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        const parentId = folders.find((folder) => folder.id === folderId)?.parentId ?? null
        toast.error(
          (await shelfRefusalOf(response)) === 'nameTaken'
            ? t('folders.nameTaken', { name, parent: parentName(parentId) })
            : t('workspace.renameFolderError')
        )
        return false
      }
      const data = await response.json()
      await load()
      setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, ...data.folder } : f)))
      return true
    },
    [foldersUrl, folders, parentName, t, load]
  )

  const describe = useCallback(
    async (folderId: string, description: string | null) => {
      const response = await fetch(`${foldersUrl}/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      })
      if (!response.ok) {
        toast.error(t('folders.description.saveError'))
        return false
      }
      const data = (await response.json()) as { folder?: Partial<FolderItem> }
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, description: data.folder?.description ?? description } : f))
      )
      return true
    },
    [foldersUrl, t]
  )

  const inFlight = useRef(0)
  const isMoving = useCallback(() => inFlight.current > 0, [])
  const undo = useRef<(folderId: string, parentId: string | null) => Promise<void>>(async () => {})

  const move = useCallback(
    async (draggedFolderId: string, parentId: string | null, { undoable = true }: { undoable?: boolean } = {}) => {
      const folder = folders.find((candidate) => candidate.id === draggedFolderId)
      if (!folder || (folder.parentId ?? null) === parentId) return
      const previousParentId = folder.parentId ?? null
      const setParent = (next: string | null) =>
        setFolders((prev) => prev.map((f) => (f.id === draggedFolderId ? { ...f, parentId: next } : f)))

      setParent(parentId)
      inFlight.current += 1
      try {
        await throwUnlessOk(
          await fetch(`${foldersUrl}/${draggedFolderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentId }),
          })
        )
        await load()
        const done = { name: folder.name, parent: parentName(parentId) }
        if (!undoable) {
          toast.success(t('folders.movedBack', { name: folder.name, folder: parentName(parentId) }))
          return
        }
        toast.success(t('folders.movedFolder', done), {
          action: { label: t('folders.moveUndo'), onClick: () => void undo.current(draggedFolderId, previousParentId) },
        })
      } catch (error) {
        setParent(previousParentId)
        const refusal = refusalOf(error)
        toast.error(
          refusal === 'nameTaken'
            ? t('folders.nameTaken', { name: folder.name, parent: parentName(parentId) })
            : refusal === 'ifcRestricted'
              ? t('folders.access.ifcRefused')
              : refusal === 'readOnly'
                ? t('folders.moveRefusedReadOnly')
                : refusal === 'gone'
                  ? t('folders.moveRefusedGone')
                  : t('folders.moveFolderError')
        )
        if (refusal === 'gone' || refusal === 'nameTaken') void load()
      } finally {
        inFlight.current -= 1
      }
    },
    [folders, foldersUrl, load, parentName, t]
  )
  undo.current = (folderId, parentId) => move(folderId, parentId, { undoable: false })

  const remove = useCallback(
    async (folderId: string) => {
      const folder = folders.find((f) => f.id === folderId)
      if (!folder) return false
      const inside = documentCountIn ? documentCountIn(folderId) : files.filter((f) => f.folderId === folderId).length
      const nested = folders.filter((f) => f.parentId === folderId).length
      const parent = folder.parentId
        ? (folders.find((f) => f.id === folder.parentId)?.name ?? t('folders.allFiles'))
        : t('folders.allFiles')
      const question = binHref
        ? t('workspace.binFolderConfirm', { name: folder.name })
        : inside > 0 || nested > 0
          ? t('workspace.deleteFolderConfirmWithContents', {
              name: folder.name,
              documents: String(inside),
              folders: String(nested),
              parent,
            })
          : t('workspace.deleteFolderConfirm', { name: folder.name })
      if (!window.confirm(question)) return false

      const response = await fetch(`${foldersUrl}/${folderId}`, { method: 'DELETE' })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { details?: { reason?: unknown } } | null
        const reason = typeof body?.details?.reason === 'string' ? body.details.reason : null
        toast.error(
          isProjectClosedBody(body)
            ? t('errors.projectClosed')
            : reason === 'folder-contents-protected'
              ? t('workspace.deleteFolderProtected')
              : response.status === 502
                ? t('workspace.deleteFolderIndexDown')
                : t('workspace.deleteFolderError')
        )
        return false
      }
      const answer = (await response.json().catch(() => ({}))) as { documentsMoved?: number; purgeAfter?: string }
      if (selectedFolderId === folderId) onSelectFolder(folder.parentId ?? null)
      await Promise.all([load(), reloadFiles(true)])
      if (binHref) {
        toast.success(
          t('workspace.binFolderDone', {
            name: folder.name,
            date: answer.purgeAfter ? formatCalendarDate(answer.purgeAfter, locale) : '—',
          }),
          { action: { label: t('workspace.openBin'), onClick: () => router.push(binHref) } }
        )
        return true
      }
      toast.success(
        answer.documentsMoved
          ? t('workspace.deleteFolderMoved', { count: String(answer.documentsMoved), parent })
          : t('workspace.deleteFolderDone', { name: folder.name })
      )
      return true
    },
    [foldersUrl, binHref, t, locale, router, folders, files, documentCountIn, selectedFolderId, onSelectFolder, load, reloadFiles]
  )

  const isFirstLoad = isLoading && !hasAnswer

  return { folders, rootAccess, isLoading, isFirstLoad, error, load, create, rename, describe, move, remove, isMoving }
}
