'use client'

import { useSyncExternalStore } from 'react'

import { PHONE_ON_ITS_SIDE_QUERY } from './phone-on-its-side'

export { PHONE_ON_ITS_SIDE_QUERY }

export const MOBILE_LAYOUT_QUERY = `(width < 48rem), ${PHONE_ON_ITS_SIDE_QUERY}`

export const PHONE_QUERY = `(width < 40rem), ${PHONE_ON_ITS_SIDE_QUERY}`

const subscribe = (onStoreChange: () => void): (() => void) => {
  const mql = window.matchMedia(MOBILE_LAYOUT_QUERY)
  mql.addEventListener('change', onStoreChange)
  return () => mql.removeEventListener('change', onStoreChange)
}

const getSnapshot = (): boolean => window.matchMedia(MOBILE_LAYOUT_QUERY).matches

const getServerSnapshot = (): boolean => false

const getUnknownSnapshot = (): null => null

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useIsMobileOnceKnown(): boolean | null {
  return useSyncExternalStore(subscribe, getSnapshot, getUnknownSnapshot)
}
