/**
 * The file browser previews' fixtures: the files and folders, the fetch shim
 * that answers thumbnails and the search, and the folder navigation, shared by
 * `/dev/file-browser` and `/dev/files-page` so both draw the same project.
 * Development only.
 */

import { useState } from 'react'
import type { FolderNavigation } from '@/features/documents/components/file-browser-pane'
import type { FileItem, FolderItem } from '@/features/documents/components/project-file-workspace'
import { documentSearchAnswer, fileSearchHit } from '@/test-utils/search-answers'

export function makeFile(id: string, filename: string, summary: string, extra: Record<string, unknown> = {}): FileItem {
  return {
    id,
    filename,
    displayName: null,
    fileSize: 2_400_000,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00Z',
    errorMessage: null,
    summary,
    pageCount: 24,
    chunkCount: 48,
    contentTypes: ['text', 'table'],
    tags: null,
    topics: null,
    capture: null,
    ...extra,
  }
}

export const FILES: FileItem[] = [
  // Filed documents — reachable by drilling into their folder, and countable
  // on its card ("2 items" on Brandschutz).
  makeFile('p1', 'Brandschutzkonzept_Wohnbau-Nord.pdf', 'Brandschutzkonzept für den Wohnbau Nord (GK 4).', {
    fileSize: 3_800_000,
    folderId: 'f-brand',
  }),
  makeFile('p2', 'Fluchtwegplan_EG-2OG.pdf', 'Fluchtwegplan für Erdgeschoss bis 2. Obergeschoss.', {
    fileSize: 1_200_000,
    folderId: 'f-brand-plan',
  }),
  makeFile('p3', 'Grundriss_Regelgeschoss.dwg', 'CAD-Grundriss des Regelgeschosses.', {
    contentType: 'application/acad',
    fileSize: 5_600_000,
  }),
  // Image with no thumbnail → the WARM placeholder (soft tile + format chip),
  // NOT a broken-image glyph.
  makeFile('p4', 'Fassadenschnitt_Nord.png', 'Fassadenschnitt der Nordseite mit Fluchtbalkon.', {
    contentType: 'image/png',
    fileSize: 4_100_000,
  }),
  makeFile('p5', 'Statik_Positionsplan.pdf', 'Positionsplan der Tragstruktur mit Lastannahmen.', {
    fileSize: 2_900_000,
    folderId: 'f-statik',
    marks: { open: 1, proposed: 0, forYou: 0 },
  }),
  // What is still open on its pages, under the size and the date: four open
  // Anmerkungen (every Fassung), two of them for the reader, and three of
  // the agent's proposals nobody took over, „4 offen · 2 für Sie · 3 Vorschläge".
  // A press opens the review.
  makeFile('p10', 'Einreichplan_Grundriss_EG_Index-C.pdf', 'Einreichplan Grundriss Erdgeschoss, Index C.', {
    fileSize: 1_900_000,
    marks: { open: 4, proposed: 3, forYou: 2 },
  }),
  makeFile('p6', 'Energieausweis.pdf', 'Energieausweis mit Heizwärmebedarf und Effizienzklasse.', {
    status: 'processing',
    fileSize: 900_000,
  }),
  // Image whose thumbnail genuinely FAILS to load (5xx) → the distinct
  // "Vorschau nicht verfügbar" treatment, separate from "no thumbnail".
  makeFile('p7', 'Baustellenfoto_Rohbau.jpg', 'Baustellenfoto des Rohbaus, Nordfassade.', {
    contentType: 'image/jpeg',
    fileSize: 5_300_000,
  }),
  // FORMAT BEATS THE NAME. „plan" matches anywhere in a filename, so these two
  // used to draw a floor-plan card — outer walls, partitions and a door swing —
  // over a Markdown note and a table. `Statik_Positionsplan.pdf` above is the
  // control: it is a PDF, it really can be a drawing, and it still reads as one.
  makeFile('p8', 'Projektplan_Sanierung.md', 'Ablauf der Sanierung in Phasen, mit offenen Punkten je Gewerk.', {
    contentType: 'text/markdown',
    fileSize: 31_000,
    pageCount: null,
    contentTypes: ['text'],
  }),
  makeFile('p9', 'Zeitplan_Gewerke.csv', 'Gewerke mit Start- und Endterminen je Bauabschnitt.', {
    contentType: 'text/csv',
    fileSize: 18_000,
    pageCount: null,
    contentTypes: ['table'],
  }),
]

/**
 * Stand-in for a rendered PDF first page — inline so the fixture needs no
 * backend and no committed binary. Shaped like a landscape drawing sheet, which
 * is what the card's thumbnail well actually has to crop.
 */
export const PAGE_THUMBNAIL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260">
       <rect width="400" height="260" fill="#ffffff"/>
       <g fill="none" stroke="#1f2937" stroke-width="2">
         <path d="M40 220h320"/>
         <path d="M110 220V80l90-46 90 46v140"/>
         <path d="M110 174h180M110 128h180M110 80h180"/>
         <rect x="140" y="182" width="34" height="38"/>
         <rect x="226" y="182" width="34" height="38"/>
       </g>
       <g fill="none" stroke="#9ca3af" stroke-width="1.5">
         <path d="M40 226l10-10M64 226l10-10M88 226l10-10M302 226l10-10M326 226l10-10M350 226l10-10"/>
         <circle cx="62" cy="118" r="18"/><path d="M62 136v34"/>
         <circle cx="344" cy="130" r="14"/><path d="M344 144v26"/>
       </g>
     </svg>`
  )

/**
 * The moment a batch lands: two documents still being read (no summary yet, one
 * of them already showing its page preview) beside two that have settled. The
 * settled cards carry a two-line description, so they set the row height and the
 * unsettled ones have to fill it.
 */
export const UPLOADING_FILES: FileItem[] = [
  makeFile('u1', '240119_PerspektivischerSchnitt_Bauteil-A.pdf', '', {
    status: 'processing',
    summary: null,
    fileSize: 2_400_000,
  }),
  // Waiting in the ingest queue behind two of the office's own uploads.
  makeFile('u2', 'Baubeschreibung_Einreichung.pdf', '', {
    status: 'pending',
    queueAhead: 2,
    summary: null,
    fileSize: 1_700_000,
  }),
  makeFile('u3', 'Lageplan_Bestand.pdf', 'Lageplan des Bestands mit Grundstücksgrenzen und Zufahrt.', {
    fileSize: 3_100_000,
  }),
  makeFile('u4', 'Bauphysik_Nachweis.pdf', 'Bauphysikalischer Nachweis für die Außenbauteile.', {
    fileSize: 2_200_000,
  }),
]

// Root + nested folders so the drill-down renders folder cards, counts, and a
// multi-level breadcrumb once Brandschutz › Fluchtwege is entered.
export const FOLDERS: FolderItem[] = [
  { id: 'f-brand', parentId: null, name: 'Brandschutz', path: '/Brandschutz' },
  { id: 'f-brand-plan', parentId: 'f-brand', name: 'Fluchtwege', path: '/Brandschutz/Fluchtwege' },
  { id: 'f-statik', parentId: null, name: 'Statik', path: '/Statik' },
  { id: 'f-arch', parentId: null, name: 'Architektur', path: '/Architektur' },
]

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __fileBrowserShim?: boolean }
  if (!w.__fileBrowserShim) {
    w.__fileBrowserShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      // u1 already has its page preview while ingestion is still running — the
      // PDF thumbnail is produced at upload time, the summary much later.
      if (/\/api\/documents\/u1\/thumbnail$/.test(url)) {
        return Response.json({ url: PAGE_THUMBNAIL })
      }
      // p7 simulates a GENUINE thumbnail failure (5xx) → distinct error tile;
      // every other thumbnail 404s → warm "no thumbnail" placeholder.
      if (/\/api\/documents\/p7\/thumbnail$/.test(url)) return new Response(null, { status: 500 })
      if (/\/api\/documents\/.+\/thumbnail$/.test(url)) return new Response(null, { status: 404 })
      if (/\/api\/search\?/.test(url)) {
        const variant = new URLSearchParams(window.location.search).get('variant')
        // The semantic search, refusing to run — see the `search-failed` variant.
        if (variant === 'search-failed') return new Response(null, { status: 500 })
        // A RANKED answer, deliberately out of upload order: the best match is
        // the oldest file in the set, so a list that re-sorted by date would
        // put it last and the ranking would be gone without a word.
        if (variant === 'search-list') {
          return Response.json(
            documentSearchAnswer([
              fileSearchHit(FILES[1], { text: 'Die nutzbare Fluchtwegbreite beträgt mindestens 1,20 m.', page: 2 }),
              fileSearchHit(FILES[0], { text: 'Der zweite Fluchtweg führt über die Nordfassade.', page: 11 }),
              fileSearchHit(FILES[4], { text: 'Lastannahmen für den Fluchtbalkon nach ÖNORM B 1991.', page: 7 }),
            ])
          )
        }
      }
      return real(input, init)
    }
  }
}

export function useFixtureFolderNav(): FolderNavigation & { currentFolderId: string | null } {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  return {
    folders: FOLDERS,
    currentFolderId,
    onNavigate: setCurrentFolderId,
    onCreateFolder: async () => false,
    onRenameFolder: async () => true,
    onDeleteFolder: async () => true,
  }
}
