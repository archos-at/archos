'use client'

import { useCallback, useEffect, useState } from 'react'
import type { InboundMailAddressView } from '@/lib/inbound-mail/inbound-mail-wire'

export const START_HINT_UNTIL_RECEIVED = 5

const storageKey = (projectId: string): string => `inbound-mail.start-hint-dismissed:${projectId}`

function readDismissed(projectId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(projectId)) === '1'
  } catch {
    return false
  }
}

function writeDismissed(projectId: string): void {
  try {
    window.localStorage.setItem(storageKey(projectId), '1')
  } catch {
    return
  }
}

export function startHintDue(address: Pick<InboundMailAddressView, 'state' | 'address' | 'receivedCount'> | null): boolean {
  return !!address && address.state === 'active' && !!address.address && address.receivedCount < START_HINT_UNTIL_RECEIVED
}

export function useStartHint(projectId: string, address: InboundMailAddressView | null): { shown: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState<boolean | null>(null)
  useEffect(() => setDismissed(readDismissed(projectId)), [projectId])
  const dismiss = useCallback(() => {
    writeDismissed(projectId)
    setDismissed(true)
  }, [projectId])
  return { shown: dismissed === false && startHintDue(address), dismiss }
}
