/** A page of the What's new list for the dev preview and the specs: two weeks, one summarised. */

import type { LocalizedReleaseNoteList } from '@/lib/release-notes/release-notes-wire'

export const WHATS_NEW_FIXTURE: LocalizedReleaseNoteList = {
  area: null,
  cursor: null,
  nextCursor: '2026-W44',
  areas: [
    { id: 'documents', count: 3 },
    { id: 'search', count: 1 },
    { id: 'building-law', count: 1 },
    { id: 'bim', count: 0 },
  ],
  weeks: [
    {
      id: '2026-W45',
      kind: 'week',
      version: null,
      date: '2026-11-02',
      dateEnd: '2026-11-08',
      summary: null,
      notes: [
        { section: 'features', area: 'documents', text: 'DXF files open as a PDF drawn to a standard scale, with a scale bar and a title block.' },
        { section: 'improvements', area: 'search', text: 'Search results hold still while you move through them.' },
        { section: 'fixes', area: 'documents', text: 'Previews of spreadsheets saved on Windows show euro signs again.' },
      ],
    },
    {
      id: '2026-W44',
      kind: 'week',
      version: null,
      date: '2026-10-26',
      dateEnd: '2026-11-01',
      summary: 'Ctrl+K now searches everything your office holds, by name, by kind and by what a document says.',
      notes: [
        { section: 'features', area: 'building-law', text: 'A U-value or an escape route’s length now comes as a „Was wäre, wenn“ card.' },
        { section: 'features', area: 'documents', text: 'Filter documents by type, drawing number, revision and scale.' },
      ],
    },
  ],
}
