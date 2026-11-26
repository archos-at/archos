'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FolderItem } from '../file-types'
import { takeDroppedFiles } from '../lib/dropped-file-handover'
import { droppedPath, filesToUpload, samePlanOutcome, type FolderUploadPlan } from '../lib/folder-upload-plan'
import type { NameConflict, SentConflictChoice } from '../lib/name-conflict'
import { isZipArchive } from '../lib/zip-types'
import { splitMailArchives } from '../lib/mail-archive'
import type { FileShelf, ShelfEndpoints, ShelfUploadApi } from '../lib/file-shelf'
import { useUploadDecision, type SettledPlan } from './use-upload-decision'
import { useNameConflictPrompt } from './use-name-conflict-prompt'
import type { UploadFilesOptions } from './file-upload-types'
import { UploadScreeningPolicyUnavailableError } from '@/adapters/api/upload-screening-policy'

export interface ShelfUploadOptions {
  shelf: Pick<FileShelf, 'probeNames' | 'probeRevisions' | 'handoverKey' | 'takeMailArchives'> & {
    endpoints: Pick<ShelfEndpoints, 'folders'>
    projectId?: string | null
  }
  upload: Pick<ShelfUploadApi, 'uploadFiles'>
  folders: readonly FolderItem[]
  foldersReady: boolean
  foldersSettled?: boolean
  selectedFolderId: string | null
  loadFolders: () => Promise<unknown>
  loadFiles: (quiet?: boolean) => Promise<unknown>
  uploading?: boolean
}

export interface UploadTarget {
  folderId?: string | null
  info?: { truncated: boolean; unreadable: number }
}

interface QueuedDrop {
  files: File[]
  folderId: string | null
}

export function useShelfUpload({
  shelf,
  upload,
  folders,
  foldersReady,
  foldersSettled = foldersReady,
  selectedFolderId,
  loadFolders,
  loadFiles,
  uploading = false,
}: ShelfUploadOptions) {
  const t = useTranslations(filesCopy)
  const decision = useUploadDecision({ projectId: shelf.projectId ?? null })
  const { propose, setReleased, settle, changeRevision, changeConflict, plan, setOpen, setPending } = decision
  const { uploadFiles } = upload
  const conflictPrompt = useNameConflictPrompt()
  const { ask } = conflictPrompt
  const { probeNames, probeRevisions, handoverKey, takeMailArchives } = shelf
  const ensureUrl = `${shelf.endpoints.folders}/ensure`

  const pathOf = useCallback(
    (folderId: string | null) => (folderId ? (folders.find((folder) => folder.id === folderId)?.path ?? null) : null),
    [folders]
  )

  const base = useRef<{ folderId: string | null; path: string | null }>({ folderId: null, path: null })

  const send = useCallback(
    (files: File[], options: UploadFilesOptions): Promise<number> => {
      const go = (batch: File[], sent: UploadFilesOptions): Promise<number> =>
        uploadFiles(batch, { ...sent, onNameConflicts: (conflicts) => void answer(conflicts, sent) })
      async function answer(conflicts: ReadonlyArray<{ file: File; conflict: NameConflict }>, sent: UploadFilesOptions) {
        const choices = await ask({
          operation: 'upload',
          folderName: '',
          rows: conflicts.map(({ file, conflict }, index) => ({
            key: String(index),
            path: droppedPath(file),
            name: file.name,
            existingName: conflict.existingName,
            within: 'folder',
            choice: 'replace',
            keepBothAs: conflict.suggestedName,
          })),
        })
        const chosen = new Map<File, SentConflictChoice>()
        conflicts.forEach(({ file }, index) => {
          const choice = choices?.get(String(index))
          if (choice && choice !== 'skip') chosen.set(file, choice)
        })
        if (chosen.size === 0) return
        await go([...chosen.keys()], { ...sent, onConflict: (file) => chosen.get(file) ?? null })
        await loadFiles(true)
      }
      return go(files, options)
    },
    [ask, uploadFiles, loadFiles]
  )

  const unpackArchives = useCallback(
    async (incoming: File[]): Promise<File[]> => {
      if (!incoming.some(isZipArchive)) return incoming
      const reading = toast.loading(t('zip.reading'))
      try {
        const { expandZips } = await import('../lib/expand-zip')
        const { files, notes } = await expandZips(incoming)
        for (const note of notes) toast.error(t(`zip.${note.reason}`, { name: note.zip, limit: note.limit }))
        return files
      } finally {
        toast.dismiss(reading)
      }
    },
    [t]
  )

  const proposeDrop = useCallback(
    (drop: QueuedDrop): Promise<void> => {
      const target = { folderId: drop.folderId, path: pathOf(drop.folderId) }
      base.current = target
      return unpackArchives(drop.files)
        .then((files) => {
          if (files.length === 0) return undefined
          return propose(
            {
              files,
              documents: probeNames,
              revisionOffers: probeRevisions,
              folders,
              currentFolderId: target.folderId,
              screeningBasePath: target.path,
            },
            (direct) => void send(direct, { folderIdFor: () => target.folderId, folderPathFor: () => target.path })
          )
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof UploadScreeningPolicyUnavailableError
              ? t('errors.screeningPolicyUnavailable')
              : t('folderUpload.compareError')
          )
        })
    },
    [unpackArchives, propose, probeNames, probeRevisions, send, folders, pathOf, t]
  )

  const queue = useRef<QueuedDrop[]>([])
  const [queued, setQueued] = useState(0)
  const [proposing, setProposing] = useState(false)
  const busy = proposing || decision.open || decision.pending || uploading || !foldersSettled

  const handleUpload = useCallback(
    (incoming: File[], target: UploadTarget = {}) => {
      const { info } = target
      if (info?.truncated) toast.warning(t('workspace.dropTruncated', { count: incoming.length }))
      if (info && info.unreadable > 0) toast.warning(t('workspace.dropUnreadable', { count: info.unreadable }))
      const { archives, rest } = takeMailArchives ? splitMailArchives(incoming) : { archives: [], rest: incoming }
      if (takeMailArchives && archives.length > 0) takeMailArchives(archives)
      if (rest.length === 0) return
      const drop: QueuedDrop = { files: rest, folderId: target.folderId === undefined ? selectedFolderId : target.folderId }
      if (busy || queue.current.length > 0) {
        queue.current.push(drop)
        setQueued(queue.current.length)
        if (foldersSettled) toast.info(t('workspace.dropQueued'))
        return
      }
      setProposing(true)
      void proposeDrop(drop).finally(() => setProposing(false))
    },
    [busy, foldersSettled, selectedFolderId, proposeDrop, takeMailArchives, t]
  )

  useEffect(() => {
    if (busy || queued === 0) return
    const next = queue.current.shift()
    setQueued(queue.current.length)
    if (!next) return
    setProposing(true)
    void proposeDrop(next).finally(() => setProposing(false))
  }, [busy, queued, proposeDrop])

  const onReleaseChange = useCallback(
    (file: File, released: boolean) => {
      setReleased(file, released).catch(() => toast.error(t('folderUpload.compareError')))
    },
    [setReleased, t]
  )

  useEffect(() => {
    if (!handoverKey || !foldersReady) return
    const handedOver = takeDroppedFiles(handoverKey)
    if (handedOver.length > 0) handleUpload(handedOver)
  }, [handoverKey, handleUpload, foldersReady])

  const ensureFolders = useCallback(
    async (paths: string[]): Promise<Record<string, string> | null> => {
      if (paths.length === 0) return {}
      try {
        const res = await fetch(ensureUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentId: base.current.folderId, paths }),
        })
        if (!res.ok) throw new Error(`Folders failed (${res.status})`)
        const data = (await res.json()) as { folderIdByPath?: Record<string, string> }
        return data.folderIdByPath ?? {}
      } catch {
        setPending(false)
        toast.error(t('folderUpload.foldersError'))
        return null
      }
    },
    [ensureUrl, setPending, t]
  )

  const settlePlan = useCallback(
    async (shown: FolderUploadPlan): Promise<SettledPlan | null> => {
      try {
        const settled = await settle()
        if (!settled) return null
        if (samePlanOutcome(shown, settled.plan)) return settled
        toast.error(t('folderUpload.planChanged'))
      } catch (error) {
        toast.error(
          error instanceof UploadScreeningPolicyUnavailableError
            ? t('errors.screeningPolicyUnavailable')
            : t('folderUpload.compareError')
        )
      }
      return null
    },
    [settle, t]
  )

  const applyFolderPlan = useCallback(async () => {
    if (!plan) return
    if (filesToUpload(plan).length === 0) return
    setPending(true)

    const settled = await settlePlan(plan)
    if (!settled) {
      setPending(false)
      return
    }
    const { policy } = settled
    const selected = filesToUpload(settled.plan)

    const byPath = await ensureFolders(settled.plan.folders.map((folder) => folder.path))
    if (byPath === null) return

    try {
      const { folderId: baseFolderId, path: basePath } = base.current
      const folderIdByFile = new Map<File, string | null>()
      for (const planned of selected) {
        folderIdByFile.set(planned.file, planned.targetPath ? (byPath[planned.targetPath] ?? baseFolderId) : baseFolderId)
      }
      const plannedByFile = new Map(selected.map((planned) => [planned.file, planned]))
      setOpen(false)
      const uploaded = await send(
        selected.map((planned) => planned.file),
        {
          folderIdFor: (file) => folderIdByFile.get(file) ?? null,
          folderPathFor: (file) => {
            const target = plannedByFile.get(file)?.targetPath ?? ''
            return [basePath, target].filter(Boolean).join('/') || null
          },
          screeningReleased: (file) => plannedByFile.get(file)?.screeningReleased === true,
          revisionOf: (file) => {
            const offer = plannedByFile.get(file)?.revisionOf
            return offer?.chosen ? offer.of.id : null
          },
          onConflict: (file) => plannedByFile.get(file)?.onConflict ?? null,
          screeningPolicy: policy,
          excludedByScreening: settled.plan.files
            .filter((planned) => planned.action === 'excluded')
            .map((planned) => planned.screening ?? []),
        }
      )
      await loadFolders()
      await loadFiles(true)
      if (uploaded === 0) return
      toast.success(
        t('folderUpload.done', { uploaded: String(uploaded), skipped: String(settled.plan.counts.unchanged) })
      )
    } catch {
      toast.error(t('folderUpload.applyError'))
    } finally {
      setPending(false)
    }
  }, [plan, send, loadFolders, loadFiles, ensureFolders, settlePlan, t, setOpen, setPending])

  return {
    handleUpload,
    applyFolderPlan,
    onReleaseChange,
    onRevisionChange: changeRevision,
    onConflictChange: changeConflict,
    conflictPrompt,
    decision,
  }
}
