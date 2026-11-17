'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export const LAST_SECTION_STORAGE_KEY = 'project.last-section'

export const KNOWN_PROJECT_SECTIONS = [
  'overview',
  'chat',
  'files',
  'model',
  'history',
  'settings',
  'knowledge',
  'research',
  'members',
  'intake',
] as const

export type ProjectSection = (typeof KNOWN_PROJECT_SECTIONS)[number]

function isKnownSection(value: string): value is ProjectSection {
  return (KNOWN_PROJECT_SECTIONS as readonly string[]).includes(value)
}

export function sectionFromPathname(pathname: string, projectId: string): ProjectSection | null {
  const base = `/app/projects/${projectId}`
  if (pathname === base || pathname === `${base}/`) return 'overview'
  if (!pathname.startsWith(`${base}/`)) return null
  const segment = pathname.slice(base.length + 1).split('/')[0]
  return isKnownSection(segment) ? segment : null
}

export function buildProjectHref(projectId: string, section: ProjectSection | null): string {
  const base = `/app/projects/${projectId}`
  return section && section !== 'overview' ? `${base}/${section}` : base
}

type SectionMap = Record<string, string>

function readMap(): SectionMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(LAST_SECTION_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as SectionMap) : {}
  } catch {
    return {}
  }
}

function writeMap(map: SectionMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAST_SECTION_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Storage unavailable — fail soft; resume simply won't persist.
  }
}

export function readLastProjectSection(projectId: string): ProjectSection | null {
  const value = readMap()[projectId]
  return typeof value === 'string' && isKnownSection(value) ? value : null
}

export function writeLastProjectSection(projectId: string, section: ProjectSection): void {
  const map = readMap()
  if (map[projectId] === section) return
  map[projectId] = section
  writeMap(map)
}

export function pruneProjectSections(validProjectIds: readonly string[]): void {
  const map = readMap()
  const valid = new Set(validProjectIds)
  let changed = false
  for (const id of Object.keys(map)) {
    if (!valid.has(id)) {
      delete map[id]
      changed = true
    }
  }
  if (changed) writeMap(map)
}

export function useRecordProjectSection(projectId: string): void {
  const pathname = usePathname() ?? ''
  useEffect(() => {
    const section = sectionFromPathname(pathname, projectId)
    if (section) writeLastProjectSection(projectId, section)
  }, [pathname, projectId])
}

export function useResumeProjectHref(projectId: string): string {
  const [href, setHref] = useState(() => buildProjectHref(projectId, null))
  useEffect(() => {
    setHref(buildProjectHref(projectId, readLastProjectSection(projectId)))
  }, [projectId])
  return href
}
