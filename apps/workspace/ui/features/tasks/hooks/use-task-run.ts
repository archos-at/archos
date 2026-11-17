'use client'

import { useEffect, useState } from 'react'
import type { RunLedger } from '@/lib/runs/run-ledger-types'
import { fetchRunView } from '@/lib/runs/run-view-client'

export interface UseTaskRunInput {
  projectId: string
  runId: string | null
  revision?: string
}

export interface UseTaskRun {
  ledger: RunLedger | null
  loading: boolean
  failed: boolean
}

export function useTaskRun({ projectId, runId, revision }: UseTaskRunInput): UseTaskRun {
  const [ledger, setLedger] = useState<RunLedger | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!runId) {
      setLedger(null)
      setFailed(false)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setFailed(false)
    fetchRunView(projectId, runId)
      .then((view) => {
        if (!active) return
        setLedger(view.ledger)
      })
      .catch(() => {
        if (!active) return
        setLedger(null)
        setFailed(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [projectId, runId, revision])

  return { ledger, loading, failed }
}
