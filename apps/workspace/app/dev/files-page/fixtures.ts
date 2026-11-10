/**
 * `/dev/files-page?project=real`: a project shaped like the first real one the
 * Dateien rework met on dev (2026-11-10), which the `/dev/file-browser` fixture
 * did not resemble: five folders at the root and only two loose files, a
 * finding from the documents, and the levels a person walks into (a folder in
 * a folder in a folder with a long name, an empty folder, a folder holding only
 * folders, a folder of twenty-one files). The page drew those states wrong on
 * dev while every preview looked right, because no preview had them.
 * Development only.
 */

import type { FileItem, FolderItem } from '@/features/documents/components/project-file-workspace'
import type { DocumentFindingsResponse } from '@/lib/documents/findings-wire'
import { makeFile } from '../file-browser/fixtures'

const LONG_FOLDER_NAME = 'Einreichplanung Bauteil A – Wohnhausanlage Holzbau Wien, Baufeld 3 (Index C, Stand November 2026)'

export const REAL_FOLDERS: FolderItem[] = [
  { id: 'r-abgabe', parentId: null, name: 'Abgabepläne', path: '/Abgabepläne' },
  { id: 'r-abgabe-index', parentId: 'r-abgabe', name: 'Index C', path: '/Abgabepläne/Index C' },
  {
    id: 'r-abgabe-long',
    parentId: 'r-abgabe-index',
    name: LONG_FOLDER_NAME,
    path: `/Abgabepläne/Index C/${LONG_FOLDER_NAME}`,
  },
  { id: 'r-berichte', parentId: null, name: 'Berichte', path: '/Berichte' },
  { id: 'r-grund', parentId: null, name: 'Grundlagen', path: '/Grundlagen' },
  { id: 'r-grund-bestand', parentId: 'r-grund', name: 'Bestand', path: '/Grundlagen/Bestand' },
  { id: 'r-grund-gutachten', parentId: 'r-grund', name: 'Gutachten', path: '/Grundlagen/Gutachten' },
  { id: 'r-test', parentId: null, name: 'Test', path: '/Test' },
  { id: 'r-sonst', parentId: null, name: 'sonstiges', path: '/sonstiges' },
  // Five levels deep, each name a German compound, to the folder `r-deep-5`.
  { id: 'r-deep-1', parentId: 'r-grund-gutachten', name: 'Brandschutzsachverständigengutachten', path: '/Grundlagen/Gutachten/…' },
  { id: 'r-deep-2', parentId: 'r-deep-1', name: 'Stellungnahmen Baubehörde', path: '/…' },
  { id: 'r-deep-3', parentId: 'r-deep-2', name: 'Nachreichungen 2026', path: '/…' },
  { id: 'r-deep-4', parentId: 'r-deep-3', name: 'Fluchtwegnachweise Tiefgarage', path: '/…' },
  { id: 'r-deep-5', parentId: 'r-deep-4', name: 'Rauchabschnittsbildung_Bauteil_C_Index-D', path: '/…' },
  // A folder of the office's archive with counts in the hundreds.
  { id: 'r-archiv', parentId: null, name: 'Planarchiv 2019–2024 (Altbestand, nicht mehr gültig)', path: '/Planarchiv' },
]

/** `?folders=many`: twenty-four folders at the root, as an office that files by trade and phase has them. */
export const MANY_FOLDERS: FolderItem[] = [
  ...REAL_FOLDERS,
  ...[
    'Tragwerksplanung', 'Haustechnik HKLS', 'Elektroplanung', 'Bauphysik', 'Vermessung', 'Behördenverfahren',
    'Ausschreibung und Vergabe', 'Kostenplanung', 'Terminplanung', 'Besprechungsprotokolle', 'Fotodokumentation',
    'Freiraumplanung', 'Brandschutzplanung', 'Schriftverkehr Bauherrschaft', 'Rechnungen',
  ].map((name, index) => ({ id: `r-m${index}`, parentId: null, name, path: `/${name}` })),
]

const pdf = (id: string, filename: string, folderId: string | null, extra: Record<string, unknown> = {}): FileItem =>
  makeFile(id, filename, '', { folderId, fileSize: 240_000 + id.length * 37_000, createdAt: '2026-11-03T11:39:00Z', tags: ['Grundriss'], ...extra })

const REPORTS = Array.from({ length: 21 }, (_, index) =>
  pdf(`r-b${index + 1}`, `Bericht_${String(index + 1).padStart(2, '0')}_Baustellenbesprechung.pdf`, 'r-berichte')
)

export const REAL_FILES: FileItem[] = [
  // The root's two loose files, as on dev: a screenshot and a drawing in its second Fassung.
  makeFile('r-l1', 'Bildschirmfoto 2026-11-03 um 12.39.37.png', '', {
    contentType: 'image/png',
    fileSize: 361_000,
    createdAt: '2026-11-03T11:39:00Z',
    pageCount: null,
  }),
  pdf('r-l2', '024-03 ANS_S-Ansicht Süd-West.pdf', null, { versionCount: 2 }),
  ...['01 Lageplan', '02 Grundriss EG', '03 Grundriss OG', '04 Schnitt A-A', '05 Ansichten', '06 Dach'].map((name, index) =>
    pdf(`r-a${index}`, `024-${name}.pdf`, 'r-abgabe')
  ),
  pdf('r-ai1', '024-02 Grundriss EG Index C.pdf', 'r-abgabe-index'),
  pdf('r-ai2', '024-04 Schnitt A-A Index C.pdf', 'r-abgabe-index'),
  pdf('r-al1', 'Baubeschreibung Bauteil A.pdf', 'r-abgabe-long'),
  pdf('r-al2', 'Katasterauszug-KG16117-Beispiel.dxf', 'r-abgabe-long', { contentType: 'image/vnd.dxf', pageCount: 2 }),
  ...REPORTS,
  pdf('r-d5a', 'Brandschutzkonzept_Wohnhausanlage_Bauteil_C_Index-D.pdf', 'r-deep-5'),
  pdf('r-d5b', 'Rauchabschnitte_Tiefgarage_Ebene-2_Variantenvergleich_Stand-2026-11-03.pdf', 'r-deep-5'),
  ...Array.from({ length: 240 }, (_, index) => pdf(`r-ar${index}`, `Plan_${String(index + 1).padStart(3, '0')}_Altbestand.pdf`, 'r-archiv')),
  pdf('r-gb1', 'Bestandsplan EG.pdf', 'r-grund-bestand'),
  pdf('r-gb2', 'Bestandsplan OG.pdf', 'r-grund-bestand'),
  pdf('r-gb3', 'Fotodokumentation Bestand.pdf', 'r-grund-bestand'),
  pdf('r-gg1', 'Bodengutachten.pdf', 'r-grund-gutachten'),
  pdf('r-gg2', 'Schallschutzgutachten.pdf', 'r-grund-gutachten'),
  pdf('r-gg3', 'Holzschutzgutachten.pdf', 'r-grund-gutachten'),
  ...['Notiz Bauherr', 'Kostenschätzung', 'Terminplan', 'Protokoll Vorbesprechung', 'Visitenkarte'].map((name, index) =>
    pdf(`r-s${index}`, `${name}.pdf`, 'r-sonst')
  ),
]

/** The one finding dev showed: a drawing number the cadastral extract names that no document carries. */
export const REAL_FINDINGS: DocumentFindingsResponse = {
  findings: [
    {
      kind: 'missing_plan',
      key: 'a4',
      label: 'A4',
      sources: [{ documentId: 'r-al2', name: 'Katasterauszug-KG16117-Beispiel.dxf', pages: [1, 2] }],
    },
  ],
  documentCount: REAL_FILES.length,
  truncated: false,
  document: null,
}
