'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AwaitingStateResponse, MentionCandidatesResponse } from '@/lib/mentions/types'
import type {
  ResourceRole,
  ResourceSharingState,
  ResourceVisibility,
  ShareCandidate,
  ShareableResourceType,
} from '@/lib/sharing/types'
import { createRetryLadder, type RetryLadder } from '@/shared/utils/backoff'
import { useLiveEvents } from './use-live-events'
import {
  changeResourceRole,
  escalateResourceAccess,
  getResourceSharing,
  getShareCandidates,
  grantResourceAccess,
  NO_FAILURE_DETAIL,
  revokeResourceAccess,
  setResourceVisibility,
  SharingRequestError,
  type SharingFailure,
  type ShareCandidatesResponse,
} from '@/adapters/api/sharing-client'
import { getAwaitingState, getMentionCandidates, releaseMention } from '@/adapters/api/mentions-client'

export type { SharingFailure } from '@/adapters/api/sharing-client'

const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000]

export interface UseSharingResult {
  state: ResourceSharingState | null
  loading: boolean
  loadError: boolean
  failure: SharingFailure | null
  dismissFailure: () => void
  saving: boolean
  refresh: () => void
  setVisibility: (visibility: ResourceVisibility) => Promise<boolean>
  grant: (subjectUserId: string, role?: ResourceRole) => Promise<boolean>
  changeRole: (subjectUserId: string, role: ResourceRole) => Promise<boolean>
  revoke: (subjectUserId: string) => Promise<boolean>
  escalate: () => Promise<boolean>
}

export function useSharing(
  resourceType: ShareableResourceType,
  resourceId: string | null,
  enabled: boolean,
): UseSharingResult {
  const [state, setState] = useState<ResourceSharingState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [failure, setFailure] = useState<SharingFailure | null>(null)
  const [saving, setSaving] = useState(false)
  const seq = useRef(0)
  const retryRef = useRef<RetryLadder | null>(null)
  retryRef.current ??= createRetryLadder({ delaysMs: RETRY_DELAYS_MS })
  const retry = retryRef.current
  const refreshRef = useRef<() => void>(() => {})

  const base = resourceId
    ? `/api/sharing/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`
    : null

  const cancelRetry = useCallback(() => retry.cancel(), [retry])

  const refresh = useCallback(async () => {
    if (!enabled || !resourceId) {
      seq.current += 1
      retry.cancel()
      setState(null)
      setLoading(false)
      return
    }
    const current = ++seq.current
    try {
      const data = await getResourceSharing(resourceType, resourceId)
      if (current !== seq.current) return
      setState(data)
      setLoadError(false)
      retry.reset()
      setLoading(false)
    } catch {
      if (current !== seq.current) return
      if (!retry.schedule(() => refreshRef.current())) {
        setLoadError(true)
        setLoading(false)
      }
    }
  }, [resourceType, resourceId, enabled, retry])

  useEffect(() => {
    refreshRef.current = () => void refresh()
  }, [refresh])

  const restart = useCallback(() => {
    retry.reset()
    setLoadError(false)
    setLoading(Boolean(enabled && base))
    void refresh()
  }, [refresh, retry, enabled, base])

  useEffect(() => {
    retry.reset()
    setLoadError(false)
    setLoading(Boolean(enabled && base))
    void refresh()
    return cancelRetry
  }, [refresh, enabled, base, cancelRetry, retry])

  useLiveEvents({
    enabled: enabled && Boolean(base),
    onEvent: (event) => {
      if (event.kind === 'resource.access.changed' && event.resourceId === resourceId) restart()
    },
    onRefresh: restart,
  })

  const mutate = useCallback(
    async (request: () => Promise<ResourceSharingState>): Promise<boolean> => {
      setFailure(null)
      setSaving(true)
      try {
        const data = await request()
        seq.current += 1
        retry.reset()
        setState(data)
        setLoadError(false)
        setLoading(false)
        return true
      } catch (error) {
        setFailure(error instanceof SharingRequestError ? error.failure : NO_FAILURE_DETAIL)
        return false
      } finally {
        setSaving(false)
      }
    },
    [retry],
  )

  return {
    state,
    loading,
    loadError,
    failure,
    dismissFailure: () => setFailure(null),
    saving,
    refresh: restart,
    setVisibility: async (visibility) =>
      resourceId ? mutate(() => setResourceVisibility(resourceType, resourceId, visibility)) : false,
    grant: async (subjectUserId, role = 'collaborator') =>
      resourceId ? mutate(() => grantResourceAccess(resourceType, resourceId, subjectUserId, role)) : false,
    changeRole: async (subjectUserId, role) =>
      resourceId ? mutate(() => changeResourceRole(resourceType, resourceId, subjectUserId, role)) : false,
    revoke: async (subjectUserId) =>
      resourceId ? mutate(() => revokeResourceAccess(resourceType, resourceId, subjectUserId)) : false,
    escalate: async () => (resourceId ? mutate(() => escalateResourceAccess(resourceType, resourceId)) : false),
  }
}

export function useShareCandidates(
  resourceType: ShareableResourceType,
  resourceId: string | null,
  enabled: boolean,
): { candidates: ShareCandidate[]; loading: boolean; error: boolean; reload: () => void } {
  const [candidates, setCandidates] = useState<ShareCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled || !resourceId) {
      setCandidates([])
      setError(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    void (async () => {
      try {
        const data: ShareCandidatesResponse = await getShareCandidates(resourceType, resourceId)
        if (cancelled) return
        setCandidates(Array.isArray(data) ? data : (data.candidates ?? []))
      } catch {
        if (!cancelled) {
          setCandidates([])
          setError(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resourceType, resourceId, enabled, attempt])

  return { candidates, loading, error, reload: () => setAttempt((current) => current + 1) }
}

export function useAwaitingState(
  conversationId: string | null,
  enabled: boolean,
): { awaiting: AwaitingStateResponse | null; refresh: () => void; release: (requestId: string) => Promise<boolean> } {
  const [awaiting, setAwaiting] = useState<AwaitingStateResponse | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled || !conversationId) {
      setAwaiting(null)
      return
    }
    try {
      setAwaiting(await getAwaitingState(conversationId))
    } catch {
      // Keep the last known state: a failed poll must not make the thread look
    }
  }, [conversationId, enabled])

  useLiveEvents({
    enabled: enabled && Boolean(conversationId),
    onEvent: (event) => {
      if (event.kind === 'conversation.awaiting' && event.conversationId === conversationId) void refresh()
      if (event.kind === 'conversation.message' && event.conversationId === conversationId) void refresh()
    },
    onRefresh: () => void refresh(),
  })

  useEffect(() => {
    void refresh()
  }, [refresh])

  const release = useCallback(
    async (requestId: string): Promise<boolean> => {
      try {
        setAwaiting(await releaseMention(requestId))
        return true
      } catch {
        return false
      }
    },
    [],
  )

  return { awaiting, refresh: () => void refresh(), release }
}

export function useMentionCandidates(
  conversationId: string | null,
  enabled: boolean,
): { data: MentionCandidatesResponse | null; loading: boolean; restart: () => void } {
  const [data, setData] = useState<MentionCandidatesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  const retryRef = useRef<RetryLadder | null>(null)
  retryRef.current ??= createRetryLadder({ delaysMs: RETRY_DELAYS_MS })
  const retry = retryRef.current

  const cancelRetry = useCallback(() => retry.cancel(), [retry])

  const refresh = useCallback(async () => {
    if (!enabled || !conversationId) {
      seq.current += 1
      retry.cancel()
      setData(null)
      setLoading(false)
      return
    }
    const current = ++seq.current
    try {
      const candidates = await getMentionCandidates(conversationId)
      if (current !== seq.current) return
      setData(candidates)
      retry.reset()
      setLoading(false)
    } catch {
      if (current !== seq.current) return
      if (!retry.schedule(() => void refresh())) {
        setData(null)
        setLoading(false)
      }
    }
  }, [conversationId, enabled, retry])

  const restart = useCallback(() => {
    retry.reset()
    void refresh()
  }, [refresh, retry])

  useEffect(() => {
    retry.reset()
    setLoading(Boolean(enabled && conversationId))
    void refresh()
    return cancelRetry
  }, [refresh, enabled, conversationId, cancelRetry, retry])

  useLiveEvents({
    enabled: enabled && Boolean(conversationId),
    onRefresh: restart,
  })

  return { data, loading, restart }
}
