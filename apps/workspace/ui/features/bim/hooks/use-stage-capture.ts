import { useCallback, useEffect, useRef, useState } from 'react'

import { screenshotFilename } from '../lib/viewer-performance'

export function useStageCapture(modelFilename: string | null) {
  const modelFilenameRef = useRef(modelFilename)
  modelFilenameRef.current = modelFilename

  const [captureFailed, setCaptureFailed] = useState(false)
  const handleCapture = useCallback(
    (dataUrl: string | null) => {
      if (!dataUrl) {
        setCaptureFailed(true)
        return
      }
      setCaptureFailed(false)
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = screenshotFilename(modelFilenameRef.current, new Date())
      link.click()
    },
    []
  )

  useEffect(() => {
    if (!captureFailed) return
    const timer = setTimeout(() => setCaptureFailed(false), 4000)
    return () => clearTimeout(timer)
  }, [captureFailed])

  return { captureFailed, setCaptureFailed, handleCapture, modelFilenameRef }
}
