/** The project, the clock and the folders every E-Mail-Eingang fixture is built against (`./fixtures.ts`). */

import type { FolderOption } from '@/features/inbound-mail/lib/draft'

export const PROJECT_ID = 'p-dev-1'
export const PROJECT_NAME = 'Bauplatz 12 – Wohnbau Seestadt'
/**
 * Now, for every fixture: the times below are minutes and days before it. Today at 09:30 UTC, not a pinned date:
 * the rows' „vor … Tagen“ reads the browser's clock, so a pinned date drifted until „wiederherstellbar bis“ named a
 * day already past beside a mail received „vor 15 Tagen“.
 */
export const FIXTURE_NOW = ((): number => {
  const today = new Date()
  today.setUTCHours(9, 30, 0, 0)
  return today.getTime()
})()

export const minutesAgo = (minutes: number): string => new Date(FIXTURE_NOW - minutes * 60_000).toISOString()
export const daysAhead = (days: number): string => new Date(FIXTURE_NOW + days * 86_400_000).toISOString()

/** A stable, uuid-shaped id per name, so a preview reloads to the same URLs. */
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
