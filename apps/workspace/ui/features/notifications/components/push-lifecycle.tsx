'use client'

import { useRouter } from 'next/navigation'
import { useEffect, type JSX } from 'react'
import { registerWorker } from '@/lib/push/browser'
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
    const onMessage = (event: MessageEvent): void => {
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const { type, url } = data as { type?: unknown; url?: unknown }
      if (type === 'piloti:navigate' && typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
        router.push(url)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [enabled, router])

  return null
}
