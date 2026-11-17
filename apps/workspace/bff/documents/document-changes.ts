import { useSyncExternalStore } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()

let generation = 0
const generationListeners = new Set<Listener>()

export function onDocumentsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyDocumentsChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.warn('[documents] a change listener threw', error)
    }
  }
  generation += 1
  for (const listener of [...generationListeners]) listener()
}

const subscribeGeneration = (listener: Listener): (() => void) => {
  generationListeners.add(listener)
  return () => {
    generationListeners.delete(listener)
  }
}

export function useDocumentsGeneration(): number {
  return useSyncExternalStore(
    subscribeGeneration,
    () => generation,
    () => 0
  )
}
