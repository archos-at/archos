'use client'

import { useEffect } from 'react'

const RELOAD_TS_KEY = 'chunk-reload-ts'
const MIN_RELOAD_GAP_MS = 10_000

export function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null | undefined
  const message = e?.message ?? ''
  return e?.name === 'ChunkLoadError' || /Loading (chunk|CSS chunk)|dynamically imported module/i.test(message)
}

export function ChunkReloadGuard(): null {
  useEffect(() => {
    const reloadOnce = (): void => {
      try {
        const last = Number(window.sessionStorage.getItem(RELOAD_TS_KEY) || '0')
        if (Date.now() - last < MIN_RELOAD_GAP_MS) return // reloaded very recently — don't loop
        window.sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()))
      } catch {
        return // no sessionStorage (private mode etc.) — skip rather than risk a loop
      }
      window.location.reload()
    }

    const onError = (event: ErrorEvent): void => {
      if (isChunkLoadError(event.error)) reloadOnce()
    }
    const onRejection = (event: PromiseRejectionEvent): void => {
      if (isChunkLoadError(event.reason)) reloadOnce()
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
