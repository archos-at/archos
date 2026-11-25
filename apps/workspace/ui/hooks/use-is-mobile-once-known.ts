'use client'

import { useSyncExternalStore } from 'react'

import { useIsMobile } from './use-is-mobile'

const subscribeToNothing = (): (() => void) => () => {}

export function useIsMobileOnceKnown(): boolean | null {
  const mobile = useIsMobile()
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false)
  return hydrated ? mobile : null
}
