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

export function lastProjectAmong(recentProjectIds: readonly string[], projectIds: readonly string[]): string | null {
  return recentProjectIds.find((id) => projectIds.includes(id)) ?? null
}

export function readLastProjectId(projectIds: readonly string[]): string | null {
  return lastProjectAmong(readRecentProjectIds(), projectIds)
}

export function withRecentProject(ids: readonly string[], projectId: string): string[] {
  return [projectId, ...ids.filter((id) => id !== projectId)].slice(0, KEEP)
}

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
