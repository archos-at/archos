'use client'

import { useCallback, useEffect, useRef } from 'react'
import { applyJitter } from '@/shared/utils/backoff'
import {
  checkBackendHealthCached,
  invalidateHealthCache,
} from '@/shared/hooks/use-backend-health'
import { useChatStore, selectHasRecoverableConnectionError } from '../store'

const INITIAL_DELAY_MS = 5_000
const MAX_DELAY_MS = 60_000
const BACKOFF_FACTOR = 2

export function useConnectionRecovery(onRecovered: () => void): void {
  const hasConnectionError = useChatStore(selectHasRecoverableConnectionError)
  const dismissConnectionErrors = useChatStore(
    (s) => s.dismissConnectionErrors
  )

  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const delayRef = useRef(INITIAL_DELAY_MS)
  const activeRef = useRef(false)

  const checkHealth = useCallback(async () => {
    invalidateHealthCache()
    const healthy = await checkBackendHealthCached()

    if (!activeRef.current) return

    if (healthy) {
      activeRef.current = false
      dismissConnectionErrors()
      onRecovered()
      return
    }

    delayRef.current = Math.min(
      delayRef.current * BACKOFF_FACTOR,
      MAX_DELAY_MS
    )
    timerRef.current = setTimeout(checkHealth, applyJitter(delayRef.current))
  }, [dismissConnectionErrors, onRecovered])

  useEffect(() => {
    if (!hasConnectionError) {
      activeRef.current = false
      delayRef.current = INITIAL_DELAY_MS
      clearTimeout(timerRef.current)
      return
    }

    activeRef.current = true
    delayRef.current = INITIAL_DELAY_MS
    timerRef.current = setTimeout(checkHealth, applyJitter(delayRef.current))

    return () => {
      activeRef.current = false
      clearTimeout(timerRef.current)
    }
  }, [hasConnectionError, checkHealth])

  useEffect(() => {
    if (!hasConnectionError) return

    const onOnline = () => {
      delayRef.current = INITIAL_DELAY_MS
      checkHealth()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        checkHealth()
      }
    }

    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hasConnectionError, checkHealth])
}
