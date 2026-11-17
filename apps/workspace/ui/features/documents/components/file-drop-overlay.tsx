'use client'

import { useEffect, type ReactNode } from 'react'
import { Ban, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion, motionQuick, motionSnap, useMotionToken } from '@/components/motion'
import { isExternalFileDrag } from '../hooks/use-document-drag'

export function useWindowDragGuard(): void {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!isExternalFileDrag(e.dataTransfer)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    }
    const drop = (e: DragEvent) => {
      if (isExternalFileDrag(e.dataTransfer)) e.preventDefault()
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
}

interface FileDropOverlayProps {
  show: boolean
  isUnsupported: boolean
  uploadLabel: string
  unsupportedLabel: string
  refusal?: string | null
  hint?: ReactNode
  testId: string
}

export function FileDropOverlay({
  show,
  isUnsupported,
  uploadLabel,
  unsupportedLabel,
  refusal,
  hint,
  testId,
}: FileDropOverlayProps) {
  const enter = useMotionToken(motionQuick)
  const exit = useMotionToken(motionSnap)
  const refused = Boolean(refusal)
  const negative = refused || isUnsupported
  const Icon = refused ? Ban : Upload
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="file-drop-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: enter }}
          exit={{ opacity: 0, transition: exit }}
          className={cn(
            'pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed text-center',
            negative ? 'border-destructive bg-destructive/5' : 'border-ring bg-primary/5 backdrop-blur-sm'
          )}
          data-testid={testId}
          data-refused={refused ? '' : undefined}
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-2 px-4">
            <Icon className={cn('size-6', negative ? 'text-destructive' : 'text-primary')} aria-hidden />
            <p className={cn('text-sm font-medium', negative ? 'text-destructive' : 'text-primary')}>
              {refusal ?? (isUnsupported ? unsupportedLabel : uploadLabel)}
            </p>
            {!refused && hint}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
