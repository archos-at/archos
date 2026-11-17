'use client'

import { useEffect, useState } from 'react'

export function useModelQuery<T>(
  modelId: string | null,
  body: Record<string, unknown> | null,
  pick: (payload: Record<string, unknown>) => T | undefined
): { data: T | null; isLoading: boolean; error: boolean } {
  const [state, setState] = useState<{ data: T | null; isLoading: boolean; error: boolean }>({
    data: null,
    isLoading: false,
    error: false,
  })
  const key = body ? JSON.stringify(body) : null

  useEffect(() => {
    if (!modelId || !key) {
      setState({ data: null, isLoading: false, error: false })
      return
    }
    let cancelled = false
    setState({ data: null, isLoading: true, error: false })
    fetch(`/api/bim/models/${modelId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: key,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        return (await response.json()) as Record<string, unknown>
      })
      .then((payload) => {
        if (!cancelled) setState({ data: pick(payload) ?? null, isLoading: false, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: true })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, key])

  return state
}
