'use client'

import { useMemo } from 'react'
import type { BimProfileSuggestion } from '@/lib/bim/profile'
import type { BimQuantityRow, BimRoomSchedule } from '@/lib/bim/schedule'
import type { AsyncState } from '../lib/async-request'
import { selectProfile, selectSchedule, selectTakeoff } from '../lib/model-query-results'
import { useModelQuery } from './use-model-query'

const SCHEDULE_REQUEST = { op: 'schedule' } as const
const PROFILE_REQUEST = { op: 'profile' } as const

export function useBimRoomSchedule(
  modelId: string | null
): AsyncState<{ schedule: BimRoomSchedule; truncated: boolean }> & { reload: () => void } {
  return useModelQuery(modelId, SCHEDULE_REQUEST, selectSchedule)
}

export function useBimTakeoff(
  modelId: string | null,
  quantity: string,
  byMaterial: boolean
): AsyncState<{ rows: BimQuantityRow[]; truncated: boolean }> & { reload: () => void } {
  const request = useMemo(
    () => ({ op: 'takeoff' as const, quantity, byMaterial }),
    [quantity, byMaterial]
  )
  return useModelQuery(modelId, request, selectTakeoff)
}

export function useBimProfileSuggestions(
  modelId: string | null
): AsyncState<BimProfileSuggestion[]> & { reload: () => void } {
  return useModelQuery(modelId, PROFILE_REQUEST, selectProfile)
}
