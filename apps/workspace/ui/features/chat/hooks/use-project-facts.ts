'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { projectFactResolver, type ProjectFactResolver } from '@/lib/project-profile/answer-bindings'

type Entry = { state: 'loading' } | { state: 'ready'; resolve: ProjectFactResolver } | { state: 'failed' }

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((listener) => listener())

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function load(projectId: string): Promise<void> {
  entries.set(projectId, { state: 'loading' })
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/profile`)
    if (!response.ok) throw new Error(String(response.status))
    const data = (await response.json()) as { profile?: unknown }
    entries.set(projectId, { state: 'ready', resolve: projectFactResolver(data?.profile) })
  } catch {
    entries.set(projectId, { state: 'failed' })
  }
  notify()
}

export function invalidateProjectFacts(projectId: string | null): void {
  if (!projectId || !entries.has(projectId)) return
  void load(projectId)
}

export const resetProjectFactsCache = (): void => {
  entries.clear()
  notify()
}

export function useProjectFacts(projectId: string | null | undefined, profile?: unknown): ProjectFactResolver | null {
  const entry = useSyncExternalStore(
    subscribe,
    () => (projectId ? entries.get(projectId) : undefined),
    () => undefined
  )
  const fetchNeeded = profile === undefined && Boolean(projectId) && entry === undefined
  useEffect(() => {
    if (fetchNeeded && projectId && !entries.has(projectId)) void load(projectId)
  }, [fetchNeeded, projectId])
  if (profile !== undefined) return fixedResolver(profile)
  return entry?.state === 'ready' ? entry.resolve : null
}

const fixed = new WeakMap<object, ProjectFactResolver>()
function fixedResolver(profile: unknown): ProjectFactResolver {
  if (typeof profile !== 'object' || profile === null) return projectFactResolver(profile)
  const known = fixed.get(profile)
  if (known) return known
  const resolve = projectFactResolver(profile)
  fixed.set(profile, resolve)
  return resolve
}
