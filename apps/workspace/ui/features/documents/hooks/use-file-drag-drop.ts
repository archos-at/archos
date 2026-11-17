import { useCallback, useRef, useState } from 'react'
import { useAppConfig } from '@/shared/context'
import { checkDraggedFilesSupported } from '../validation'
import { isExternalFileDrag } from './use-document-drag'
import { useDragEnd } from './use-drag-end'
import { readDrop } from '../lib/dropped-entries'

export function outsideTheZone(e: Pick<React.DragEvent, 'currentTarget' | 'target'>): boolean {
  const zone = e.currentTarget
  const target = e.target
  if (!(zone instanceof Node) || !(target instanceof Node)) return false
  return !zone.contains(target)
}

export interface DropInfo {
  truncated: boolean
  unreadable: number
}

interface UseFileDragDropOptions {
  onDrop: (files: File[], info: DropInfo) => void
  disabled?: boolean
  refusal?: string | null
  acceptZip?: boolean
}

interface UseFileDragDropReturn {
  isDragging: boolean
  isUnsupportedDrag: boolean
  refusal: string | null
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

export function useFileDragDrop({
  onDrop,
  disabled = false,
  refusal = null,
  acceptZip = false,
}: UseFileDragDropOptions): UseFileDragDropReturn {
  const [isDragging, setIsDragging] = useState(false)
  const [isUnsupportedDrag, setIsUnsupportedDrag] = useState(false)
  const dragCounterRef = useRef(0)
  const { fileUpload: fileUploadConfig } = useAppConfig()

  const reset = useCallback(() => {
    dragCounterRef.current = 0
    setIsDragging(false)
    setIsUnsupportedDrag(false)
  }, [])
  useDragEnd(isDragging, reset)

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !isExternalFileDrag(e.dataTransfer) || outsideTheZone(e)) return
      e.preventDefault()
      e.stopPropagation()

      dragCounterRef.current++
      setIsDragging(true)
      const allSupported = checkDraggedFilesSupported(e.dataTransfer, fileUploadConfig, {
        allowZip: acceptZip,
      })
      setIsUnsupportedDrag(!allSupported)
    },
    [disabled, fileUploadConfig, acceptZip]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !isExternalFileDrag(e.dataTransfer) || outsideTheZone(e)) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      if (dragCounterRef.current === 0) {
        setIsDragging(false)
        setIsUnsupportedDrag(false)
      }
    },
    [disabled]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !isExternalFileDrag(e.dataTransfer) || outsideTheZone(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = refusal ? 'none' : 'copy'
    },
    [disabled, refusal]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !isExternalFileDrag(e.dataTransfer) || outsideTheZone(e)) return

      e.preventDefault()
      e.stopPropagation()
      reset()
      if (refusal) return

      void readDrop(e.dataTransfer).then(({ files, truncated, unreadable }) => {
        if (files.length === 0 && !truncated && unreadable === 0) return
        onDrop(files, { truncated, unreadable })
      })
    },
    [disabled, refusal, onDrop, reset]
  )

  return {
    isDragging,
    isUnsupportedDrag,
    refusal: isDragging ? refusal : null,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
  }
}
