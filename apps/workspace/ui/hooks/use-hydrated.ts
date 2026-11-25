'use client'

import { useSyncExternalStore } from 'react'

const subscribeToNothing = (): (() => void) => () => {}

/** False on the server and through hydration, true from the first client render after it. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, () => true, () => false)
}
