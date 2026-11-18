'use client'

import { useCallback, useSyncExternalStore } from 'react'

export const SHORTCUTS_PREFERENCE_KEY = 'keyboard-shortcuts.enabled'

const CHANGE_EVENT = 'keyboard-shortcuts-preference'

function readEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(SHORTCUTS_PREFERENCE_KEY) !== 'false'
  } catch {
    return true
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

export interface ShortcutsPreference {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

export function useShortcutsPreference(): ShortcutsPreference {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => true)

  const setEnabled = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(SHORTCUTS_PREFERENCE_KEY, String(next))
    } catch {
      // Storage unavailable — fail soft; the default (ON) keeps applying.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return { enabled, setEnabled }
}
