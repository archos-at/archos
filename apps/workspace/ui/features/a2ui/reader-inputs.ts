'use client'

import { createContext, createElement, useContext, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { DataContext } from '@a2ui/web_core/v0_9'

export type ReaderOverrides = Readonly<Record<string, number | null>>

export interface ReaderInputStore {
  get(): ReaderOverrides | undefined
  set(next: ReaderOverrides | undefined): void
  subscribe(onChange: () => void): () => void
}

export const readerInputsPath = (leafId: string): string => `/inputs/${leafId.replace(/[~/]/g, '_')}`

export function dataModelStore(dataContext: DataContext, leafId: string): ReaderInputStore {
  const path = readerInputsPath(leafId)
  return {
    get: () => dataContext.dataModel.get(path) as ReaderOverrides | undefined,
    set: (next) => dataContext.set(path, next),
    subscribe: (onChange) => {
      const subscription = dataContext.dataModel.subscribe(path, () => onChange())
      return () => subscription.unsubscribe()
    },
  }
}

export function localStore(): ReaderInputStore {
  let value: ReaderOverrides | undefined
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
  }
}

const ReaderInputsContext = createContext<ReaderInputStore | null>(null)

export function ReaderInputsProvider({ store, children }: { store: ReaderInputStore; children: ReactNode }) {
  return createElement(ReaderInputsContext.Provider, { value: store }, children)
}

const NO_OVERRIDES: ReaderOverrides = Object.freeze({})

export function useReaderOverrides(): {
  overrides: ReaderOverrides
  change: (key: string, value: number | null) => void
  reset: () => void
} {
  const bound = useContext(ReaderInputsContext)
  const [local] = useState(localStore)
  const store = bound ?? local
  const overrides = useSyncExternalStore(store.subscribe, store.get, store.get) ?? NO_OVERRIDES
  return {
    overrides,
    change: (key, value) => store.set({ ...(store.get() ?? {}), [key]: value }),
    reset: () => store.set(undefined),
  }
}
