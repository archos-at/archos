'use client'

import { useSyncExternalStore } from 'react'
import { useLayoutStore } from '@/features/layout/store'
import type { DiagramTheme } from './render-diagram'

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  media?.addEventListener?.('change', onChange)
  const unsubscribe = useLayoutStore.subscribe(onChange)
  return () => {
    observer.disconnect()
    media?.removeEventListener?.('change', onChange)
    unsubscribe()
  }
}

function getSnapshot(): DiagramTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function getServerSnapshot(): DiagramTheme {
  return 'light'
}

export function useDiagramTheme(): DiagramTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
