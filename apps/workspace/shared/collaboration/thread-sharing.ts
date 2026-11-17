'use client'

import { useSyncExternalStore } from 'react'
import type { ResourceRole } from '@/lib/sharing/types'

export type ThreadSharing = 'unknown' | 'private' | 'shared'

const facts = new Map<string, 'private' | 'shared'>()
const turnActors = new Map<string, string>()
const threadRoles = new Map<string, ResourceRole>()
const revisions = new Map<string, number>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishThreadSharing(conversationId: string, shared: boolean): void {
  const next = shared ? 'shared' : 'private'
  if (facts.get(conversationId) === next) return
  facts.set(conversationId, next)
  emit()
}

export function publishTurnActor(conversationId: string, name: string | null): void {
  const current = turnActors.get(conversationId) ?? null
  if (current === name) return
  if (name === null) turnActors.delete(conversationId)
  else turnActors.set(conversationId, name)
  emit()
}

export function publishThreadRole(conversationId: string, role: ResourceRole | null): void {
  const current = threadRoles.get(conversationId) ?? null
  if (current === role) return
  if (role === null) threadRoles.delete(conversationId)
  else threadRoles.set(conversationId, role)
  emit()
}

export function bumpThreadRevision(conversationId: string): void {
  revisions.set(conversationId, (revisions.get(conversationId) ?? 0) + 1)
  emit()
}

export function getThreadSharing(conversationId: string | null | undefined): ThreadSharing {
  if (!conversationId) return 'unknown'
  return facts.get(conversationId) ?? 'unknown'
}

export function resetThreadSharing(): void {
  if (
    facts.size === 0 &&
    turnActors.size === 0 &&
    threadRoles.size === 0 &&
    revisions.size === 0
  ) {
    return
  }
  facts.clear()
  turnActors.clear()
  threadRoles.clear()
  revisions.clear()
  emit()
}

export function useThreadRevision(conversationId: string | null | undefined): number {
  return useSyncExternalStore(
    subscribe,
    () => (conversationId ? (revisions.get(conversationId) ?? 0) : 0),
    () => 0
  )
}

export function useTurnActorName(conversationId: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (conversationId ? (turnActors.get(conversationId) ?? null) : null),
    () => null
  )
}

export function useThreadRole(conversationId: string | null | undefined): ResourceRole | null {
  return useSyncExternalStore(
    subscribe,
    () => (conversationId ? (threadRoles.get(conversationId) ?? null) : null),
    () => null
  )
}

export function useThreadSharing(conversationId: string | null | undefined): ThreadSharing {
  return useSyncExternalStore(
    subscribe,
    () => getThreadSharing(conversationId),
    () => 'unknown' as ThreadSharing
  )
}
