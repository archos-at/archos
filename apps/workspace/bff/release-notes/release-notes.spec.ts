import { describe, expect, it } from 'vitest'
import { whatsNew as de } from '@/i18n/dictionaries/de/whats-new'
import { whatsNew as en } from '@/i18n/dictionaries/en/whats-new'
import {
  listReleaseNotes,
  localizeReleaseNotes,
  releaseNoteArtifact,
  type ReleaseNoteArtifact,
} from './release-notes'
import { RELEASE_NOTE_AREAS, RELEASE_NOTE_SECTIONS, WEEKS_PER_PAGE } from './release-notes-wire'

const note = (area: (typeof RELEASE_NOTE_AREAS)[number], text: string) =>
  ({ section: 'features', area, text: { en: text, de: `${text} (de)` } }) as const

const week = (id: string, notes: ReturnType<typeof note>[]) => ({
  id,
  kind: 'week' as const,
  version: null,
  date: '2026-10-26',
  dateEnd: '2026-11-01',
  summary: { en: 'The week.', de: 'Die Woche.' },
  notes,
})

const SOURCE: ReleaseNoteArtifact = {
  sections: RELEASE_NOTE_SECTIONS,
  areas: RELEASE_NOTE_AREAS,
  releases: [
    week('2026-W45', [note('documents', 'A'), note('search', 'B')]),
    ...Array.from({ length: WEEKS_PER_PAGE + 1 }, (_, i) => week(`2026-W${40 - i}`, [note('documents', `C${i}`)])),
  ],
}

describe('release notes for members (ADR-0156)', () => {
  it('pages the weeks by cursor, newest first, and counts every area across all of them', () => {
    const first = listReleaseNotes({}, SOURCE)
    expect(first.weeks.map((w) => w.id)).toEqual(['2026-W45', '2026-W40', '2026-W39', '2026-W38'])
    expect(first.cursor).toBeNull()
    expect(first.nextCursor).toBe('2026-W38')
    expect(first.areas.find((a) => a.id === 'documents')?.count).toBe(WEEKS_PER_PAGE + 2)
    const second = listReleaseNotes({ cursor: first.nextCursor ?? undefined }, SOURCE)
    expect(second.weeks.map((w) => w.id)).toEqual(['2026-W37', '2026-W36'])
    expect(second.nextCursor).toBeNull()
    // A cursor that names no week starts from the newest.
    expect(listReleaseNotes({ cursor: '1999-W01' }, SOURCE).weeks[0].id).toBe('2026-W45')
  })

  it('narrowed to an area, a week keeps only its notes, drops its summary, and drops out when empty', () => {
    const search = listReleaseNotes({ area: 'search' }, SOURCE)
    expect(search.weeks).toHaveLength(1)
    expect(search.weeks[0].summary).toBeNull()
    expect(search.weeks[0].notes.map((n) => n.text.en)).toEqual(['B'])
  })

  it('sends the reader only their language', () => {
    const list = localizeReleaseNotes(listReleaseNotes({}, SOURCE), 'de')
    expect(list.weeks[0].summary).toBe('Die Woche.')
    expect(list.weeks[0].notes[0].text).toBe('A (de)')
  })

  it('the committed artifact speaks the wire’s vocabulary, and every area and section has a label', () => {
    const artifact = releaseNoteArtifact()
    expect(artifact.areas).toEqual(RELEASE_NOTE_AREAS)
    expect(artifact.sections).toEqual(RELEASE_NOTE_SECTIONS)
    expect(artifact.releases.length).toBeGreaterThan(0)
    for (const release of artifact.releases)
      for (const item of release.notes) {
        expect(RELEASE_NOTE_AREAS).toContain(item.area)
        expect(RELEASE_NOTE_SECTIONS).toContain(item.section)
      }
    for (const dictionary of [en, de]) {
      expect(Object.keys(dictionary.areas).sort()).toEqual([...RELEASE_NOTE_AREAS].sort())
      expect(Object.keys(dictionary.sections).sort()).toEqual([...RELEASE_NOTE_SECTIONS].sort())
    }
  })
})
