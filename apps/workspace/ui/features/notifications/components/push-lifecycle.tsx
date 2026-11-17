'use client'

import { useRouter } from 'next/navigation'
import { useEffect, type JSX } from 'react'
import { registerWorker } from '@/lib/push/browser'
import { LEGACY_WORKER_MESSAGES } from '@/lib/push/legacy-worker-names'
import { refreshRegisteredDevice } from '../hooks/use-push-notifications'

export function PushLifecycle({ enabled }: { enabled: boolean }): JSX.Element | null {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void registerWorker().then(async (registration) => {
      if (!registration || cancelled) return
      try {
        await refreshRegisteredDevice()
      } catch {
        // Offline or signed out mid-load: the next page load tries again.
      }
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    let followedByLegacyCopy: string | null = null
    const onMessage = (event: MessageEvent): void => {
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const { type, url } = data as { type?: unknown; url?: unknown }
      if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return
      if (type === 'navigate') {
        followedByLegacyCopy = url
        router.push(url)
      } else if (type === LEGACY_WORKER_MESSAGES.navigate) {
        if (followedByLegacyCopy !== url) router.push(url)
        followedByLegacyCopy = null
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [enabled, router])

  return null
}
