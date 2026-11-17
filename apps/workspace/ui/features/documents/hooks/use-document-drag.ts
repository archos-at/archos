'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { readDrop } from '../lib/dropped-entries'
import { useDragEnd } from './use-drag-end'

export const DOCUMENT_DRAG_TYPE = 'application/x-document-id'
export const FOLDER_DRAG_TYPE = 'application/x-grid-folder-id'

const dragTypes = (dataTransfer: DataTransfer | null): string[] =>
  dataTransfer ? Array.from(dataTransfer.types ?? []) : []

export function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
  return dragTypes(dataTransfer).includes('Files')
}

export function draggedFolderId(dataTransfer: DataTransfer | null): string | null {
  const prefix = `${FOLDER_DRAG_TYPE}:`
  const carrier = dragTypes(dataTransfer).find((type) => type.startsWith(prefix))
  return carrier ? carrier.slice(prefix.length) : null
}

export interface InternalDragSource {
  kind: 'document' | 'folder'
  id: string
  from: string | null
}

let internalDrag: InternalDragSource | null = null

const endInternalDrag = (): void => {
  internalDrag = null
  window.removeEventListener('drop', endAfterThisEvent, true)
  window.removeEventListener('dragend', endAfterThisEvent, true)
  window.removeEventListener('pointermove', endInternalDrag, true)
}

const endAfterThisEvent = (): void => {
  setTimeout(endInternalDrag, 0)
}

const beginInternalDrag = (source: InternalDragSource): void => {
  internalDrag = source
  window.addEventListener('drop', endAfterThisEvent, true)
  window.addEventListener('dragend', endAfterThisEvent, true)
  requestAnimationFrame(() => {
    if (internalDrag) window.addEventListener('pointermove', endInternalDrag, true)
  })
}

export function isInternalDragActive(): boolean {
  return internalDrag !== null
}

export function internalDragSource(): InternalDragSource | null {
  return internalDrag
}

export function documentDragProps(documentId: string, from: string | null = null) {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, documentId)
      event.dataTransfer.effectAllowed = 'move'
      beginInternalDrag({ kind: 'document', id: documentId, from })
    },
    onDragEnd: endInternalDrag,
  }
}

export function folderDragProps(folderId: string, parentId: string | null = null) {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(FOLDER_DRAG_TYPE, folderId)
      event.dataTransfer.setData(`${FOLDER_DRAG_TYPE}:${folderId}`, '')
      event.dataTransfer.effectAllowed = 'move'
      event.stopPropagation()
      beginInternalDrag({ kind: 'folder', id: folderId, from: parentId })
    },
    onDragEnd: endInternalDrag,
  }
}

export interface FileDropAim {
  folderId: string | null
  refusal: string | null
}

export const SPRING_OPEN_MS = 800

interface UseFolderDropTargetOptions {
  onDropDocument: (documentId: string, folderId: string | null) => void
  onDropFolder?: (draggedFolderId: string, parentId: string | null) => void
  canAcceptFolder?: (draggedFolderId: string, targetFolderId: string | null) => boolean
  folderId: string | null
  disabled?: boolean
  onDropFiles?: (files: File[], info: { truncated: boolean; unreadable: number }, folderId: string | null) => void
  refusal?: string | null
  onFileAim?: (aim: FileDropAim | null) => void
  onSpringOpen?: () => void
  onlyFromElsewhere?: boolean
}

type Incoming = 'files' | 'document' | 'folder'

export function useFolderDropTarget({
  onDropDocument,
  onDropFolder,
  canAcceptFolder,
  folderId,
  disabled = false,
  onDropFiles,
  refusal = null,
  onFileAim,
  onSpringOpen,
  onlyFromElsewhere = false,
}: UseFolderDropTargetOptions) {
  const [isOver, setIsOver] = useState(false)
  const latest = useRef({ onFileAim, onSpringOpen })
  latest.current = { onFileAim, onSpringOpen }
  const insideRef = useRef<Incoming | null>(null)
  const springTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarm = useCallback(() => {
    if (springTimer.current) clearTimeout(springTimer.current)
    springTimer.current = null
  }, [])
  const leave = useCallback(() => {
    disarm()
    if (insideRef.current === 'files') latest.current.onFileAim?.(null)
    insideRef.current = null
    setIsOver(false)
  }, [disarm])
  useDragEnd(isOver, leave)
  useEffect(
    () => () => {
      disarm()
      if (insideRef.current === 'files') latest.current.onFileAim?.(null)
    },
    [disarm]
  )

  const incoming = useCallback(
    (event: React.DragEvent): Incoming | null => {
      if (isExternalFileDrag(event.dataTransfer)) return onDropFiles ? 'files' : null
      if (disabled) return null
      const types = dragTypes(event.dataTransfer)
      const source = internalDragSource()
      if (onlyFromElsewhere && (!source || source.from === folderId)) return null
      if (types.includes(DOCUMENT_DRAG_TYPE)) return 'document'
      if (!onDropFolder || !types.includes(FOLDER_DRAG_TYPE)) return null
      const dragged = draggedFolderId(event.dataTransfer)
      if (!dragged) return null
      if (canAcceptFolder && !canAcceptFolder(dragged, folderId)) return null
      return 'folder'
    },
    [disabled, onDropFiles, onDropFolder, canAcceptFolder, folderId, onlyFromElsewhere]
  )

  const arm = useCallback(() => {
    if (!latest.current.onSpringOpen) return
    disarm()
    springTimer.current = setTimeout(() => {
      springTimer.current = null
      leave()
      latest.current.onSpringOpen?.()
    }, SPRING_OPEN_MS)
  }, [disarm, leave])

  return {
    isOver,
    refuses: isOver && Boolean(refusal),
    dropProps: {
      onDragOver: (event: React.DragEvent) => {
        const kind = incoming(event)
        if (!kind) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = refusal ? 'none' : kind === 'files' ? 'copy' : 'move'
        if (insideRef.current) return
        insideRef.current = kind
        if (kind === 'files') latest.current.onFileAim?.({ folderId, refusal })
        arm()
        setIsOver(true)
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!isExternalFileDrag(event.dataTransfer)) event.stopPropagation()
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        leave()
      },
      onDrop: (event: React.DragEvent) => {
        const kind = incoming(event)
        if (!kind) return
        event.preventDefault()
        event.stopPropagation()
        leave()
        if (refusal) return
        if (kind === 'files') {
          void readDrop(event.dataTransfer).then(({ files, truncated, unreadable }) => {
            if (files.length > 0 || truncated || unreadable > 0) onDropFiles?.(files, { truncated, unreadable }, folderId)
          })
          return
        }
        if (kind === 'document') {
          const documentId = event.dataTransfer.getData(DOCUMENT_DRAG_TYPE)
          if (documentId) onDropDocument(documentId, folderId)
          return
        }
        const dragged = event.dataTransfer.getData(FOLDER_DRAG_TYPE)
        if (dragged) onDropFolder?.(dragged, folderId)
      },
    },
  }
}
