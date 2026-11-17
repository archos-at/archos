'use client'

import { useCallback, useEffect } from 'react'

import { useFilePreviewStore } from '../stores/file-preview-store'
import type { PeekView } from './file-preview-peek'

export function usePeekState(
  peeking: boolean,
  fileId: string,
  fullScreen: (() => void) | null,
): { peekView: PeekView; setPeekView: (view: PeekView) => void } {
  const peekDetails = useFilePreviewStore((state) => state.peekDetails)
  const setPeekDetails = useFilePreviewStore((state) => state.setPeekDetails)
  const setPeekFullScreen = useFilePreviewStore((state) => state.setPeekFullScreen)
  useEffect(() => {
    if (peeking) setPeekDetails(false)
  }, [peeking, fileId, setPeekDetails])
  useEffect(() => {
    if (!peeking || !fullScreen) return
    setPeekFullScreen(fullScreen)
    return () => setPeekFullScreen(null)
  }, [peeking, fullScreen, setPeekFullScreen])
  const setPeekView = useCallback(
    (view: PeekView) => {
      if (peeking) setPeekDetails(view === 'details')
    },
    [peeking, setPeekDetails],
  )
  return { peekView: peeking && peekDetails ? 'details' : 'document', setPeekView }
}
