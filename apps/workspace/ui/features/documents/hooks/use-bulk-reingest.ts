'use client'

import { useCallback, useRef, useState } from 'react'
import { notifyDocumentsChanged } from '@/lib/documents/document-changes'
import { requestReingest } from '../lib/reingest-request'

const POOL = 4

export interface BulkReingestProgress {
  total: number
  done: number
  failed: number
  unchanged?: number
}

export function useBulkReingest(onReingested: (id: string, status: string) => void) {
  const [progress, setProgress] = useState<BulkReingestProgress | null>(null)
  const running = useRef(false)

  const run = useCallback(
    async (documentIds: readonly string[]): Promise<BulkReingestProgress> => {
      const total = documentIds.length
      const result: BulkReingestProgress = { total, done: 0, failed: 0, unchanged: 0 }
      if (running.current || total === 0) return result
      running.current = true
      setProgress({ ...result })
      const queue = [...documentIds]
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          const outcome = await requestReingest(id)
          result.done += 1
          if (outcome.kind === 'failed') result.failed += 1
          else if (outcome.kind === 'unchanged') result.unchanged = (result.unchanged ?? 0) + 1
          else if (outcome.status) onReingested(id, outcome.status)
          setProgress({ ...result })
        }
      }
      try {
        await Promise.all(Array.from({ length: Math.min(POOL, total) }, worker))
      } finally {
        running.current = false
        notifyDocumentsChanged()
        setProgress(null)
      }
      return result
    },
    [onReingested]
  )

  return { run, progress }
}
