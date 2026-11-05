'use client'

import { useCallback, useEffect } from 'react'

import { useFilePreviewStore } from '../stores/file-preview-store'
import type { PeekView } from './file-preview-peek'

/**
 * The peek's toolbar is the host's (`file-preview-host.tsx`), and two of its
 * buttons act on what only the pane knows: ⓘ turns the peek from the document
 * to its details, and full screen opens the Prüfansicht when this document can
 * carry Anmerkungen. The store carries both between them, as it carries a
 * viewer target: the pane publishes what full screen does while it is the peek,
 * and reads which face is up.
 *
 * Off the peek the pane keeps its document face and publishes nothing.
 */
export function usePeekState(
  peeking: boolean,
  fileId: string,
  fullScreen: (() => void) | null,
): { peekView: PeekView; setPeekView: (view: PeekView) => void } {
  const peekDetails = useFilePreviewStore((state) => state.peekDetails)
  const setPeekDetails = useFilePreviewStore((state) => state.setPeekDetails)
  const setPeekFullScreen = useFilePreviewStore((state) => state.setPeekFullScreen)
  // Back to the document whenever a different file arrives, or the pane becomes
  // the peek: a citation opening the next file should show that file, not its metadata.
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
