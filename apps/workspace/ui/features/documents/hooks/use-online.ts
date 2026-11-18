'use client'

import { useSyncExternalStore } from 'react'

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}
const readOnline = (): boolean => navigator.onLine
const serverOnline = (): boolean => true

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, serverOnline)
}
