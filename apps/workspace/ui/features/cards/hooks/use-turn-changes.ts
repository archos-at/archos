'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getTurnChanges } from '@/lib/changes/client'
import type { AgentChangeView } from '@/lib/changes/types'

export interface TurnChanges {
  changes: readonly AgentChangeView[] | null
  refetch: () => Promise<readonly AgentChangeView[] | null>
  adopt: (change: AgentChangeView) => void
}

export function useTurnChanges(
  conversationId: string | null,
  messageId: string | undefined,
  { enabled, token }: { enabled: boolean; token: number }
): TurnChanges {
  const [changes, setChanges] = useState<readonly AgentChangeView[] | null>(null)
  const started = useRef(0)
  const applied = useRef(0)

  const refetch = useCallback(async () => {
    if (!conversationId || !messageId) return null
    const ticket = ++started.current
    try {
      const response = await getTurnChanges(conversationId, messageId)
      if (ticket > applied.current) {
        applied.current = ticket
        setChanges(response.changes)
      }
      return response.changes
    } catch {
      return null
    }
  }, [conversationId, messageId])

  useEffect(() => {
    if (enabled) void refetch()
  }, [enabled, refetch, token])

  const adopt = useCallback((change: AgentChangeView) => {
    setChanges((previous) => previous?.map((existing) => (existing.id === change.id ? change : existing)) ?? previous)
  }, [])

  return { changes, refetch, adopt }
}
