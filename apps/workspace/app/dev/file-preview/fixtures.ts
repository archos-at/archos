import type { FileItem } from '@/features/documents/components/project-file-workspace'
import { SEARCH_FIXTURE_DOCUMENTS } from '../_fixtures/search'

export const FIXTURE: FileItem = {
  id: 'dev-doc-1',
  filename: 'Brandschutzkonzept_Wohnbau-Nord_Gebaeudeklasse-4.pdf',
  displayName: null,
  fileSize: 4_820_000,
  contentType: 'image/png',
  status: 'ready',
  folderId: null,
  createdAt: '2026-06-14T09:00:00Z',
  errorMessage: null,
  summary:
    'Brandschutzkonzept für den Wohnbau Nord (Gebäudeklasse 4) nach OIB-Richtlinie 2 (2023). ' +
    'Das Dokument weist die beiden voneinander unabhängigen Fluchtwege je Nutzungseinheit nach: ' +
    'der erste über den notwendigen Flur ins nördliche Sicherheitstreppenhaus, der zweite über die ' +
    'anleiterbaren Fenster der Feuerwehr an der Ostfassade. Die maximale Gehweglänge im notwendigen ' +
    'Flur beträgt 34 m und liegt damit unter dem Grenzwert von 40 m. ' +
    'Brandabschnitte sind mit REI 90 Trennwänden ausgeführt; die Wohnungstrennwände erreichen REI 60. ' +
    'Der Nachweis der Rauchableitung erfolgt über die Rauch- und Wärmeabzugsanlage im Treppenhaus ' +
    'mit einer aerodynamisch wirksamen Öffnungsfläche von 1,0 m². ' +
    'Löschwasserversorgung, Feuerwehraufstellflächen und die Kennzeichnung der Rettungswege sind ' +
    'im Lageplan Blatt 3 dokumentiert und mit der örtlichen Feuerwehr abgestimmt.',
  pageCount: 24,
  chunkCount: 58,
  contentTypes: ['text', 'table', 'drawing', 'image', 'chart'],
  tags: [
    'Gutachten', // a Brandschutzkonzept is a report, not a drawing: „Grundriss“ read wrong to an architect
    'Brandschutz',
    'Standsicherheit',
    'Nutzungssicherheit/Barrierefreiheit',
    'Schallschutz',
  ],
  topics: ['Fluchtwege', 'Rauchableitung'],
  capture: null,
  assignees: [
    { userId: 'u-1', name: 'Miriam Hofer', email: 'm.hofer@example.at', profilePictureUrl: null },
  ],
}

export const GENERATED_FIXTURE: FileItem = {
  id: 'dev-doc-generated',
  filename: 'fluchtweglangen-gebaudeklasse-4-2026-06-14.pdf',
  displayName: null,
  fileSize: 128_400,
  contentType: 'application/pdf',
  status: 'stored',
  authoredBy: 'agent',
  folderId: null,
  createdAt: '2026-06-14T09:00:00Z',
  errorMessage: null,
  summary: null,
  pageCount: 6,
  chunkCount: 0,
  contentTypes: [],
  tags: [],
  topics: null,
  capture: null,
}

const OFFICE_VARIANTS = ['office-converting', 'office-converted', 'office-failed'] as const
type OfficeVariant = (typeof OFFICE_VARIANTS)[number]

export const isOfficeVariant = (value: string | undefined): value is OfficeVariant =>
  (OFFICE_VARIANTS as readonly string[]).includes(value ?? '')

export const officeFixture = (variant: OfficeVariant): FileItem => ({
  id: `dev-doc-${variant}`,
  filename: 'Raumprogramm_Wohnbau-Nord.docx',
  displayName: null,
  fileSize: 184_000,
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  status: 'ready',
  folderId: null,
  createdAt: '2026-06-14T09:00:00Z',
  errorMessage: null,
  summary: 'Raumprogramm für den Wohnbau Nord mit Flächen je Nutzungseinheit und Geschoss.',
  pageCount: 6,
  chunkCount: 12,
  contentTypes: ['text', 'table'],
  tags: [],
  topics: null,
  capture: null,
})

const PDF_VARIANTS = ['pdf', 'pdf-unreadable'] as const
type PdfVariant = (typeof PDF_VARIANTS)[number]

export const isPdfVariant = (value: string | undefined): value is PdfVariant =>
  (PDF_VARIANTS as readonly string[]).includes(value ?? '')

export const pdfFixture = (variant: PdfVariant): FileItem => ({
  ...FIXTURE,
  id: `dev-doc-${variant}`,
  contentType: 'application/pdf',
})

export const SEARCH_HIT = SEARCH_FIXTURE_DOCUMENTS[0]!
export const SEARCH_HIT_FIXTURE: FileItem = {
  ...FIXTURE,
  id: SEARCH_HIT.id,
  filename: SEARCH_HIT.filename,
  displayName: SEARCH_HIT.title,
  contentType: 'application/pdf',
  fileSize: 3_140_000,
  pageCount: SEARCH_HIT.pageCount,
  summary:
    'Brandschutzkonzept für das Wohnhaus Seestadt Baufeld J7 (Gebäudeklasse 4) nach OIB-Richtlinie 2 (2023). ' +
    'Es weist die Fluchtwege je Geschoss nach: die Fluchtweglänge beträgt höchstens 40 m bis zum nächsten ' +
    'gesicherten Stiegenhaus. Brandabschnitte sind mit REI 90 ausgeführt, die Rauchableitung erfolgt über die ' +
    'Rauch- und Wärmeabzugsanlage im Stiegenhaus.',
  topics: ['Fluchtwege', 'Stiegenhaus'],
}
