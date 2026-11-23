'use client'

import { useMemo } from 'react'
import {
  notReadyModelStatus,
  resolveModelByFilename,
  useProjectBimModels,
  type BimModelHeaderView,
} from '@/features/bim/hooks/use-bim-model'

export function useResolvedModel(
  projectId: string | null,
  modelFile: string | null
): {
  model: BimModelHeaderView | null
  models: BimModelHeaderView[]
  isLoading: boolean
  error: string | null
  ambiguous: boolean
  notReady: 'extracting' | 'failed' | null
} {
  const { data, isLoading, error } = useProjectBimModels(projectId)
  const models = useMemo(
    () => (data ?? []).filter((candidate) => candidate.status === 'ready'),
    [data]
  )
  const { model, ambiguous } = useMemo(
    () => resolveModelByFilename(models, modelFile),
    [models, modelFile]
  )
  const notReady = useMemo(
    () => (model ? null : notReadyModelStatus(data ?? [], modelFile)),
    [model, data, modelFile]
  )
  return { model, models, isLoading: isLoading && data === null, error, ambiguous, notReady }
}
