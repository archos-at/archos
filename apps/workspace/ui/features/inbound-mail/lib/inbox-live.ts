'use client'

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useShelfLive } from '@/features/realtime/use-shelf-live'

export const LIVE_QUIET_MS = 5_000

export function useInboxLive({
  projectId,
  enabled,
  stamp,
  lastRead,
  reload,
}: {
  projectId: string
  enabled: boolean
  stamp: string | null | undefined
  lastRead: RefObject<number>
  reload: () => unknown
}): void {
  const reloadIfStale = useCallback(() => {
    if (!enabled || Date.now() - lastRead.current < LIVE_QUIET_MS) return
    void reload()
  }, [enabled, lastRead, reload])

  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (stamp === null || stamp === undefined) return
    const previous = seen.current
    seen.current = stamp
    if (previous !== null && previous !== stamp) reloadIfStale()
  }, [stamp, reloadIfStale])

  const shelf = useMemo(() => ({ kind: 'project' as const, projectId }), [projectId])
  useShelfLive(shelf, reloadIfStale, { enabled })
}
