'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(pointer: coarse)'

const hasMatchMedia = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener?.('change', onChange)
  return () => mql.removeEventListener?.('change', onChange)
}

const getSnapshot = (): boolean => hasMatchMedia() && window.matchMedia(QUERY).matches

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
