import { useCallback, useEffect, useRef, useState } from 'react'
import { listResearchRuns, type ResearchRun } from '@/adapters/api/research-runs-client'

export const useDeepResearchRuns = ({
  isSessionsPanelOpen,
  projectId,
}: {
  isSessionsPanelOpen: boolean
  projectId?: string
}) => {
  const [deepResearchRuns, setDeepResearchRuns] = useState<ResearchRun[] | null>(null)
  const [deepResearchError, setDeepResearchError] = useState(false)
  const deepResearchFetchInFlightRef = useRef(false)
  const deepResearchProjectRef = useRef<string | null>(null)

  const fetchDeepResearchRuns = useCallback(() => {
    if (!projectId) return
    if (deepResearchFetchInFlightRef.current) return
    deepResearchFetchInFlightRef.current = true
    const requestedProject = projectId
    deepResearchProjectRef.current = requestedProject
    setDeepResearchError(false)
    listResearchRuns({ projectId: requestedProject, limit: 50 })
      .then((response) => {
        if (deepResearchProjectRef.current !== requestedProject) return
        const sorted = [...response.jobs].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        setDeepResearchRuns(sorted)
      })
      .catch(() => {
        if (deepResearchProjectRef.current === requestedProject) setDeepResearchError(true)
      })
      .finally(() => {
        deepResearchFetchInFlightRef.current = false
      })
  }, [projectId])

  useEffect(() => {
    if (!isSessionsPanelOpen || !projectId) return
    fetchDeepResearchRuns()
  }, [isSessionsPanelOpen, projectId, fetchDeepResearchRuns])

  return { deepResearchRuns, deepResearchError, fetchDeepResearchRuns }
}
