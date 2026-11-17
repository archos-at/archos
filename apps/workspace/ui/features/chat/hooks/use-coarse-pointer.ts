'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(pointer: coarse)'

const subscribe = (onChange: () => void): (() => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

const getSnapshot = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches

export const useCoarsePointer = (): boolean => useSyncExternalStore(subscribe, getSnapshot, () => false)
