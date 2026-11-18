'use client'

import { useCallback, useEffect, useState } from 'react'
import { listDocumentRoles, type RoleBinding } from '@/adapters/api/document-roles-client'
import { fetchListingPages } from '@/features/documents/lib/fetch-listing-pages'

export type { RoleBinding }

export interface ProjectDocumentOption {
  id: string
  filename: string
  displayName?: string | null
}

export interface DocumentRolesState {
  bindings: RoleBinding[] | null
  documents: ProjectDocumentOption[]
}

type Listener = (state: DocumentRolesState) => void

const EMPTY: DocumentRolesState = { bindings: null, documents: [] }

const states = new Map<string, DocumentRolesState>()
const listeners = new Map<string, Set<Listener>>()
const inFlight = new Map<string, Promise<void>>()

function publish(projectId: string, next: DocumentRolesState): void {
  states.set(projectId, next)
  for (const listener of listeners.get(projectId) ?? []) listener(next)
}

async function load(projectId: string): Promise<void> {
  const [roles, listed] = await Promise.all([
    listDocumentRoles(projectId).catch((): RoleBinding[] => []),
    fetchListingPages<unknown>(`/api/documents?projectId=${encodeURIComponent(projectId)}`)
      .then(({ documents }) => documents)
      .catch(() => [] as unknown[]),
  ])

  const documents = listed.filter(
    (row): row is ProjectDocumentOption =>
      !!row &&
      typeof row === 'object' &&
      typeof (row as Record<string, unknown>).id === 'string' &&
      typeof (row as Record<string, unknown>).filename === 'string'
  )

  if (listeners.has(projectId)) publish(projectId, { bindings: roles, documents })
}

export function refreshDocumentRoles(
  projectId: string,
  options?: { afterWrite?: boolean }
): Promise<void> {
  const existing = inFlight.get(projectId)
  if (existing && !options?.afterWrite) return existing

  const start = (): Promise<void> => {
    const promise = load(projectId).finally(() => {
      if (inFlight.get(projectId) === promise) inFlight.delete(projectId)
    })
    inFlight.set(projectId, promise)
    return promise
  }

  return existing ? existing.then(start, start) : start()
}

export function useDocumentRoles(projectId: string): DocumentRolesState & {
  refresh: (options?: { afterWrite?: boolean }) => Promise<void>
} {
  const [state, setState] = useState<DocumentRolesState>(() => states.get(projectId) ?? EMPTY)

  useEffect(() => {
    let listenerSet = listeners.get(projectId)
    if (!listenerSet) {
      listenerSet = new Set()
      listeners.set(projectId, listenerSet)
    }
    const listener: Listener = (next) => setState(next)
    listenerSet.add(listener)
    setState(states.get(projectId) ?? EMPTY)

    if (!states.has(projectId)) void refreshDocumentRoles(projectId)

    return () => {
      listenerSet.delete(listener)
      if (listenerSet.size === 0) {
        listeners.delete(projectId)
        states.delete(projectId)
      }
    }
  }, [projectId])

  const refresh = useCallback(
    (options?: { afterWrite?: boolean }) => refreshDocumentRoles(projectId, options),
    [projectId]
  )
  return { ...state, refresh }
}

export function __resetDocumentRolesStore(): void {
  states.clear()
  listeners.clear()
  inFlight.clear()
}
