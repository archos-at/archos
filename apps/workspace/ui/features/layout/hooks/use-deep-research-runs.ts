import { useCallback, useEffect, useRef, useState } from 'react'
import { JobApiError, listProjectRuns, type JobRun } from '@/adapters/api/jobs-client'

const RUN_PAGE = 50

export type DeepResearchRunsState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'failed' }
  | { kind: 'loaded'; runs: JobRun[] }

const isFeatureOff = (error: unknown): boolean =>
  error instanceof JobApiError && error.status === 403 && error.code === 'feature_disabled'

export const useDeepResearchRuns = ({
  isSessionsPanelOpen,
  projectId,
}: {
  isSessionsPanelOpen: boolean
  projectId?: string
}) => {
  const [state, setState] = useState<DeepResearchRunsState>({ kind: 'loading' })
  const inFlightRef = useRef(false)
  const requestedProjectRef = useRef<string | null>(null)

  const fetchDeepResearchRuns = useCallback(() => {
    if (!projectId) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    const requestedProject = projectId
    requestedProjectRef.current = requestedProject
    setState((current) => (current.kind === 'loaded' ? current : { kind: 'loading' }))
    listProjectRuns(requestedProject, { limit: RUN_PAGE, kind: 'deep-research' })
      .then((runs) => {
        if (requestedProjectRef.current !== requestedProject) return
        setState({ kind: 'loaded', runs })
      })
      .catch((error: unknown) => {
        if (requestedProjectRef.current !== requestedProject) return
        setState(isFeatureOff(error) ? { kind: 'unavailable' } : { kind: 'failed' })
      })
      .finally(() => {
        inFlightRef.current = false
      })
  }, [projectId])

  useEffect(() => {
    if (!isSessionsPanelOpen || !projectId) return
    fetchDeepResearchRuns()
  }, [isSessionsPanelOpen, projectId, fetchDeepResearchRuns])

  return { deepResearch: state, fetchDeepResearchRuns }
}
