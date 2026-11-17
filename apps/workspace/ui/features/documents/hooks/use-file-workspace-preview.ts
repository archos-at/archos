'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import type { FileItem } from '../file-types'
import type { FileShelf } from '../lib/file-shelf'
import { useCompareParam } from './use-compare-param'
import { useModelStage } from './use-model-stage'
import { useDocParamSync, usePreviewChannel, type PreviewHandlers } from './use-preview-channel'
import type { FileWorkspaceListing } from './use-file-workspace-listing'

export function useFileWorkspacePreview({ shelf, state }: { shelf: FileShelf; state: FileWorkspaceListing }) {
  const { files, setFiles, reloadSummary, pagedView, linked, listing } = state
  const patchFile = useCallback(
    (fileId: string, patch: Partial<FileItem>) =>
      setFiles((prev) => (prev.some((f) => f.id === fileId) ? prev.map((f) => (f.id === fileId ? { ...f, ...patch } : f)) : prev)),
    [setFiles]
  )

  const filesRef = useRef(files)
  const openRef = useRef<(file: FileItem) => void>(() => undefined)
  const handlers = useMemo<PreviewHandlers>(
    () => ({
      onOpenDocument: (id) => {
        const file = filesRef.current.find((candidate) => candidate.id === id)
        if (file) openRef.current(file)
      },
      onRevisionChanged: (id, revision) => patchFile(id, { revision }),
      onReingested: (id, status) => patchFile(id, { status, errorMessage: null }),
      onTagsUpdated: (id, tags, topics) => patchFile(id, topics === undefined ? { tags } : { tags, topics }),
      onLifecycleChanged: (id, summary: { versionState: DocumentVersionState; versionCount: number }) =>
        patchFile(id, summary),
      onMarksChanged: (id, marks) => patchFile(id, { marks }),
      onDeleted: (id) => {
        setFiles((prev) => prev.filter((f) => f.id !== id))
        void reloadSummary()
      },
      onRenamed: (id, displayName) => patchFile(id, { displayName }),
    }),
    [patchFile, setFiles, reloadSummary]
  )

  const channel = usePreviewChannel(shelf, files, handlers)
  const compareElement = useCompareParam(files, linked.settled || (!pagedView && listing.complete))
  useEffect(() => {
    filesRef.current = files
    openRef.current = channel.open
  })
  const stage = useModelStage(shelf.showModels, files)

  const handleSelectFile = useCallback(
    (id: string | null) => {
      if (id === null) return channel.close()
      const file = files.find((candidate) => candidate.id === id)
      if (!file) return
      channel.open(file)
    },
    [files, channel]
  )
  const selectFileRef = useRef(handleSelectFile)
  useEffect(() => {
    selectFileRef.current = handleSelectFile
  }, [handleSelectFile])
  const selectFile = useCallback((id: string | null) => selectFileRef.current(id), [])
  useDocParamSync({
    openId: channel.openId,
    files,
    onUrlOpen: handleSelectFile,
    onUrlClose: channel.close,
  })
  return {
    handlers,
    channel,
    compareElement,
    stage,
    selectFile,
  }
}
