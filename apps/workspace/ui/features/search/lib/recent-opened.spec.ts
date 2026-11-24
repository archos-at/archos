import { beforeEach, describe, expect, it } from 'vitest'

import { SEARCH_FIXTURE_RESPONSE } from '@/app/dev/_fixtures/search'
import { RECENT_OPENED_KEY, RECENT_OPENED_MAX, openedEntry, readRecentOpened, rememberOpened } from './recent-opened'

const documents = SEARCH_FIXTURE_RESPONSE.sections.document!.hits
const conversation = SEARCH_FIXTURE_RESPONSE.sections.conversation!.hits[0]

describe('what was opened from the search window', () => {
  beforeEach(() => window.localStorage.removeItem(RECENT_OPENED_KEY))

  it('keeps a document under its read title, with its project and folder, and opens it without the passage', () => {
    const hit = documents.find((document) => document.passage !== null && document.title !== null)!
    const entry = openedEntry(hit)
    expect(entry.title).toBe(hit.title)
    expect(entry.projectName).toBe(hit.projectName)
    expect(entry.folderName).toBe(hit.folderName)
    expect(entry.href).not.toContain('highlight=')
    expect(entry.href).toContain(hit.id)
  })

  it('keeps a chat under its title and project', () => {
    expect(openedEntry(conversation)).toMatchObject({ kind: 'conversation', title: conversation.title, projectName: conversation.projectName })
  })

  it('puts the newest first, keeps one row per place, and no more than the window shows', () => {
    for (const hit of documents) rememberOpened(hit)
    rememberOpened(conversation)
    const again = rememberOpened(documents[0])
    expect(again[0].href).toBe(openedEntry(documents[0]).href)
    expect(again.filter((entry) => entry.href === again[0].href)).toHaveLength(1)
    expect(again.length).toBeLessThanOrEqual(RECENT_OPENED_MAX)
    expect(readRecentOpened()).toEqual(again)
  })

  it('reads nothing from a record it does not understand, and no link that leaves the app', () => {
    window.localStorage.setItem(RECENT_OPENED_KEY, 'not json')
    expect(readRecentOpened()).toEqual([])
    const entry = openedEntry(conversation)
    window.localStorage.setItem(RECENT_OPENED_KEY, JSON.stringify([{ ...entry, href: 'https://example.org/' }, { title: 3 }, entry]))
    expect(readRecentOpened()).toEqual([entry])
  })
})
