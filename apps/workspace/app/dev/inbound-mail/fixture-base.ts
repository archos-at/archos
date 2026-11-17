import type { FolderOption } from '@/features/inbound-mail/lib/draft'

export const PROJECT_ID = 'p-dev-1'
export const PROJECT_NAME = 'Bauplatz 12 – Wohnbau Seestadt'
export const FIXTURE_NOW = ((): number => {
  const now = new Date()
  now.setUTCMinutes(0, 0, 0)
  return now.getTime()
})()

export const minutesAgo = (minutes: number): string => new Date(FIXTURE_NOW - minutes * 60_000).toISOString()
export const daysAhead = (days: number): string => new Date(FIXTURE_NOW + days * 86_400_000).toISOString()

export function fixtureId(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const hex = hash.toString(16).padStart(8, '0')
  return `${hex}-0000-4000-8000-${hex}${hex.slice(0, 4)}`
}

export const FOLDERS: FolderOption[] = [
  { id: fixtureId('folder:behoerde'), parentId: null, name: 'Behörde', path: 'Behörde', writable: true },
  { id: fixtureId('folder:bescheide'), parentId: fixtureId('folder:behoerde'), name: 'Bescheide', path: 'Behörde/Bescheide', writable: true },
  { id: fixtureId('folder:tragwerk'), parentId: null, name: 'Tragwerk', path: 'Tragwerk', writable: true },
  { id: fixtureId('folder:korrespondenz'), parentId: null, name: 'Korrespondenz', path: 'Korrespondenz', writable: true },
  { id: fixtureId('folder:vertraege'), parentId: null, name: 'Verträge', path: 'Verträge', writable: false },
]
