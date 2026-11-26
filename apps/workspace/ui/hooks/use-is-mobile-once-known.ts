'use client'

import { useHydrated } from './use-hydrated'
import { useIsMobile } from './use-is-mobile'

export function useIsMobileOnceKnown(): boolean | null {
  const mobile = useIsMobile()
  return useHydrated() ? mobile : null
}
