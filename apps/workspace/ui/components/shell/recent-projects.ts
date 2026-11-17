'use client'

import { useEffect } from 'react'

export const RECENT_PROJECTS_STORAGE_KEY = 'project.recent'

const KEEP = 8

export function readRecentProjectIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY) ?? '[]'
    )
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function withRecentProject(ids: readonly string[], projectId: string): string[] {
  return [projectId, ...ids.filter((id) => id !== projectId)].slice(0, KEEP)
}

// Browser-only storage: this list is never sent to the server or read by anyone else.
export function recordRecentProject(projectId: string): void {
  if (typeof window === 'undefined') return
  try {
    const next = withRecentProject(readRecentProjectIds(), projectId)
    window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable: the sheet simply has no recents to offer.
  }
}

export function useRecordRecentProject(projectId: string): void {
  useEffect(() => {
    recordRecentProject(projectId)
  }, [projectId])
}
