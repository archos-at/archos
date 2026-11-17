'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { use, useEffect } from 'react'
import { FilePreviewDialog } from '@/features/documents/components/file-preview-dialog'
import { FilePreviewHost } from '@/features/documents/components/file-preview-host'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import { FilePreviewPane } from '@/features/documents/components/file-preview-pane'
import type { FileItem } from '@/features/documents/components/project-file-workspace'
import { buildPdf, type PdfLine } from '../_fixtures/sample-pdf'
import { a1SheetPdf } from '../_fixtures/a1-sheet'
import { SEARCH_FIXTURE_DOCUMENTS } from '../_fixtures/search'
import { normalizeDrawingStructured } from '@/lib/documents/drawing-structured'

const PAGE_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="700" viewBox="0 0 520 700">
       <rect width="520" height="700" fill="#ffffff"/>
       <rect x="40" y="48" width="240" height="16" rx="3" fill="#1c1b19"/>
       <rect x="40" y="76" width="150" height="10" rx="3" fill="#a8a5a1"/>
       <rect x="40" y="128" width="440" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="150" width="440" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="172" width="360" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="230" width="440" height="220" rx="6" fill="none" stroke="#cfcbc6" stroke-width="2" stroke-dasharray="6 6"/>
       <path d="M120 400 L200 300 L280 360 L360 280 L440 380" fill="none" stroke="#57534e" stroke-width="3"/>
       <rect x="40" y="500" width="440" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="522" width="400" height="8" rx="3" fill="#dedbd7"/>
       <rect x="40" y="544" width="420" height="8" rx="3" fill="#dedbd7"/>
     </svg>`
  )

const FIXTURE: FileItem = {
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

const GENERATED_FIXTURE: FileItem = {
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

const TEXT_FIXTURES: Record<'markdown' | 'csv' | 'text', FileItem> = {
  markdown: {
    id: 'dev-doc-md',
    filename: 'Bueroablauf_Einreichplanung.md',
    displayName: null,
    fileSize: 2_140,
    contentType: 'text/markdown',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00Z',
    errorMessage: null,
    summary: 'Interne Checkliste für die Einreichplanung, Stand Juni 2026.',
    pageCount: null,
    chunkCount: 4,
    contentTypes: ['text'],
    tags: ['Checkliste'],
    topics: null,
    capture: null,
  },
  csv: {
    id: 'dev-doc-csv',
    filename: 'U-Werte_Bauteilkatalog.csv',
    displayName: null,
    fileSize: 860,
    contentType: 'text/csv',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00Z',
    errorMessage: null,
    summary: 'Bauteilkatalog mit U-Werten und den zugehörigen OIB-Anforderungen.',
    pageCount: null,
    chunkCount: 2,
    contentTypes: ['text', 'table'],
    tags: [],
    topics: null,
    capture: null,
  },
  text: {
    id: 'dev-doc-txt',
    filename: 'Protokoll_Bauverhandlung.txt',
    displayName: null,
    fileSize: 1_180,
    contentType: 'text/plain',
    status: 'ready',
    folderId: null,
    createdAt: '2026-06-14T09:00:00Z',
    errorMessage: null,
    summary: null,
    pageCount: null,
    chunkCount: 1,
    contentTypes: ['text'],
    tags: [],
    topics: null,
    capture: null,
  },
}

const OFFICE_VARIANTS = ['office-converting', 'office-converted', 'office-failed'] as const
type OfficeVariant = (typeof OFFICE_VARIANTS)[number]

const officeFixture = (variant: OfficeVariant): FileItem => ({
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

const SETTLING_FIXTURE: FileItem = {
  ...FIXTURE,
  id: 'dev-doc-settling',
  status: 'processing',
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  assignees: [],
}

let settlingReads = 0

function settlingStatus(): Record<string, unknown> {
  settlingReads += 1
  const base = { id: SETTLING_FIXTURE.id, filename: SETTLING_FIXTURE.filename, versionCount: 1 }
  if (settlingReads <= 2) return { ...base, status: 'processing' }
  if (settlingReads === 3) return { ...base, status: 'completed', summary: null }
  return {
    ...base,
    status: 'completed',
    summary: FIXTURE.summary,
    pageCount: FIXTURE.pageCount,
    chunkCount: FIXTURE.chunkCount,
    contentTypes: FIXTURE.contentTypes,
    tags: FIXTURE.tags,
  }
}

function SettlingPreview(): JSX.Element {
  useEffect(() => {
    settlingReads = 0
    useFilePreviewStore.getState().open(SETTLING_FIXTURE, 'modal', { projectId: 'proj-demo' })
  }, [])
  return <FilePreviewHost />
}

const PDF_VARIANTS = ['pdf', 'pdf-unreadable'] as const
type PdfVariant = (typeof PDF_VARIANTS)[number]

const pdfFixture = (variant: PdfVariant): FileItem => ({
  ...FIXTURE,
  id: `dev-doc-${variant}`,
  contentType: 'application/pdf',
})

const DRAWING_FIXTURE: FileItem = {
  ...FIXTURE,
  id: 'dev-doc-drawing',
  filename: 'WBN_Grundriss_1OG_Index_C.pdf',
  contentType: 'application/pdf',
  fileSize: 2_380_000,
  pageCount: 1,
}

const SEARCH_HIT = SEARCH_FIXTURE_DOCUMENTS[0]!
const SEARCH_HIT_FIXTURE: FileItem = {
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

const SEARCH_HIT_SECTIONS = [
  'Allgemeines',
  'Grundlagen',
  'Gebäudebeschreibung',
  'Brandabschnitte',
  'Tragwerk',
  'Fluchtwege',
  'Stiegenhäuser',
  'Rauchableitung',
  'Löschwasser',
  'Feuerwehrzufahrt',
  'Brandmeldeanlage',
  'Sicherheitsbeleuchtung',
]

const searchHitPages = (): PdfLine[][] =>
  Array.from({ length: SEARCH_HIT.pageCount ?? 24 }, (_, index) => {
    const page = index + 1
    const head: PdfLine[] = [[`Brandschutzkonzept Wohnhaus Seestadt J7 · Seite ${page}`, 9, false], ['', 11, false]]
    if (page === 7) {
      return [
        ...head,
        ['5. Fluchtwege', 14, true],
        ['', 11, false],
        ['5.1 Fluchtweglängen', 12, true],
        ['', 11, false],
        ['Jede Wohnung hat einen Fluchtweg über das Stiegenhaus. Die Fluchtweglänge', 11, false],
        ['beträgt max. 40 m bis zum nächsten gesicherten Stiegenhaus (GK 4, OIB-RL 2,', 11, false],
        ['Pkt. 5.1.1). Gemessen wird in der Lauflinie ab der Wohnungseingangstür.', 11, false],
        ['', 11, false],
        ['Stiege 2 erreicht 42,10 m; die Abweichung ist in Abschnitt 5.3 begründet.', 11, false],
      ]
    }
    const section = SEARCH_HIT_SECTIONS[Math.floor(index / 2) % SEARCH_HIT_SECTIONS.length]!
    return [
      ...head,
      [`${Math.floor(index / 2) + 1}. ${section}`, 14, true],
      ['', 11, false],
      ['Die Angaben dieses Abschnitts beziehen sich auf die Einreichplanung', 11, false],
      ['vom 14.10.2026 und die Pläne EP-01 bis EP-06.', 11, false],
    ]
  })

const isPdfVariant = (value: string | undefined): value is PdfVariant =>
  (PDF_VARIANTS as readonly string[]).includes(value ?? '')

const FIRE_SAFETY_PAGES: readonly (readonly PdfLine[])[] = [
  [
    ['Brandschutzkonzept Wohnbau Nord', 22, true],
    ['Gebäudeklasse 4 · OIB-Richtlinie 2 (2023)', 11, false],
    ['', 11, false],
    ['1. Fluchtwege', 14, true],
    ['', 11, false],
    ['Je Nutzungseinheit stehen zwei voneinander unabhängige Fluchtwege', 11, false],
    ['zur Verfügung: der erste über den notwendigen Flur in das nördliche', 11, false],
    ['Sicherheitstreppenhaus, der zweite über die anleiterbaren Fenster', 11, false],
    ['an der Ostfassade.', 11, false],
    ['', 11, false],
    ['Die maximale Gehweglänge im notwendigen Flur beträgt 34 m und', 11, false],
    ['liegt damit unter dem Grenzwert von 40 m.', 11, false],
    ['', 11, false],
    ['2. Brandabschnitte', 14, true],
    ['', 11, false],
    ['Brandabschnitte sind mit Trennwänden REI 90 ausgeführt; die', 11, false],
    ['Wohnungstrennwände erreichen REI 60.', 11, false],
  ],
  [
    ['3. Rauchableitung', 14, true],
    ['', 11, false],
    ['Die Rauchableitung erfolgt über die Rauch- und Wärmeabzugsanlage', 11, false],
    ['im Treppenhaus mit einer aerodynamisch wirksamen Öffnungsfläche', 11, false],
    ['von 1,0 m².', 11, false],
    ['', 11, false],
    ['4. Löschwasser und Feuerwehr', 14, true],
    ['', 11, false],
    ['Löschwasserversorgung, Aufstellflächen und die Kennzeichnung der', 11, false],
    ['Rettungswege sind im Lageplan Blatt 3 dokumentiert.', 11, false],
  ],
]

const ROOM_PROGRAMME_PAGES: readonly (readonly PdfLine[])[] = [
  [
    ['Raumprogramm Wohnbau Nord', 22, true],
    ['Flächen je Nutzungseinheit und Geschoss', 11, false],
    ['', 11, false],
    ['Regelgeschoss', 14, true],
    ['', 11, false],
    ['Top 1   Wohnen/Essen 38,4 m²   Zimmer 12,1 m²   Zimmer 10,8 m²', 11, false],
    ['Top 2   Wohnen/Essen 34,9 m²   Zimmer 11,6 m²', 11, false],
    ['Top 3   Wohnen/Essen 38,4 m²   Zimmer 12,1 m²   Zimmer 10,8 m²', 11, false],
    ['Top 4   Wohnen/Essen 29,7 m²', 11, false],
    ['', 11, false],
    ['Erschließung über den Laubengang an der Hofseite.', 11, false],
  ],
]

const isOfficeVariant = (value: string | undefined): value is OfficeVariant =>
  (OFFICE_VARIANTS as readonly string[]).includes(value ?? '')

const MARKDOWN_BODY = `# Einreichplanung — Bürocheckliste

Gilt für alle Einreichungen in Oberösterreich ab **Juni 2026**.

## Vor der Abgabe

- [x] Lageplan mit Höhenkoten, Maßstab 1:500
- [x] Grundrisse aller Geschosse, 1:100
- [ ] Energieausweis nach OIB-RL 6
- [ ] Nachweis der zwei Fluchtwege je Nutzungseinheit (OIB-RL 2)

## Häufige Rückfragen der Behörde

| Thema | Fundstelle | Anmerkung |
| --- | --- | --- |
| Fluchtweglänge | OIB-RL 2, Pkt. 5.1.1 | max. 40 m im notwendigen Flur |
| Anleiterbarkeit | OIB-RL 2, Pkt. 5.2 | Ostfassade, Aufstellfläche prüfen |

> Bei Gebäudeklasse 4 ist das Sicherheitstreppenhaus früh mit der Feuerwehr
> abzustimmen — Nachbesserungen kosten hier regelmäßig zwei Wochen.
`

const CSV_BODY = `Bauteil;U-Wert [W/m²K];Anforderung OIB-6;Bewertung
Außenwand gegen Außenluft;0,20;0,35;erfüllt
Oberste Geschossdecke;0,15;0,20;erfüllt
Fenster (Uw);1,10;1,40;erfüllt
Kellerdecke;0,38;0,40;"knapp erfüllt, Nachweis beilegen"
Eingangstür;1,60;1,70;erfüllt
`

const TEXT_BODY = `Protokoll der Bauverhandlung
Wohnbau Nord, Linz — 14.06.2026, 09:00 Uhr

Anwesend:
  Bauwerberin      Wohnbau Nord GmbH, vertreten durch DI Huber
  Sachverständiger Amt der Oö. Landesregierung, DI Mayrhofer
  Nachbarn         Grundstück 412/3 und 412/7

Verhandlungsgegenstand
  Neubau eines Wohngebaeudes der Gebaeudeklasse 4 mit vier Wohneinheiten
  je Regelgeschoss, Errichtung in Brettsperrholz-Bauweise.

Ergebnis
  Keine Einwendungen der Nachbarn zur Bebauungshoehe. Der Sachverständige
  fordert die Vorlage des Rauchableitungsnachweises fuer das Treppenhaus
  binnen vier Wochen nach.
`

const DEV_STRUCTURED_RAW = {
  schema_version: 4,
  registry: 'architecture+general@850c9b2d770a',
  segment: {
    domain: 'architecture',
    segment_type: 'floor_plan',
    title: 'Regelgeschoss',
    scale: '1:100',
    summary: 'Regelgeschoss mit vier Wohneinheiten um einen zentralen Erschließungskern.',
    entities: [
      { name: 'Wohnen/Essen', category: 'space', role: 'Aufenthalt', measure: '38,4 m²' },
      { name: 'Laubengang', category: 'circulation', role: 'Erschließung', measure: null },
      { name: 'Sicherheitstreppenhaus', category: 'circulation', role: null, measure: null },
      { name: 'Stützenraster 5,40 m', category: 'structure', role: null, measure: null },
      { name: 'Wärmepumpe Sole/Wasser', category: 'services', role: null, measure: null },
      {
        name: 'Schallschutz Wohnungstrennwand',
        category: 'building_physics',
        role: 'R′w 55 dB',
        measure: null,
      },
      { name: 'Brettsperrholz', category: 'material', role: null, measure: null },
    ],
    compositions: [
      {
        component: 'Außenwand',
        layers: [
          { material: 'Lärchenschalung', thickness: '24 mm', function: 'Witterungsschutz' },
          { material: 'Mineralwolle', thickness: '200 mm', function: 'Dämmung' },
          { material: 'Brettsperrholz', thickness: '100 mm', function: 'tragend' },
        ],
      },
    ],
    states: [
      { element: 'Bestandsmauer Hof', state: 'existing' },
      { element: 'Laubengang', state: 'new' },
    ],
    quantities: [
      {
        object: 'Bausubstanz erhalten',
        property: 'Anteil',
        value: '71',
        unit: '%',
        source: 'text',
        confidence: 'high',
      },
      {
        object: 'Wohneinheiten',
        property: 'Anzahl',
        value: '4',
        unit: null,
        source: 'visual',
        confidence: 'high',
      },
    ],
    relations: [
      { subject: 'Laubengang', relation: 'erschließt', object: 'alle vier Wohneinheiten' },
    ],
    annotations: ['5,40', '38,4 m²'],
    source: 'visual',
    confidence: 'medium',
  },
  document: {
    title: 'Wohnbau Nord',
    subtitle: 'Transformation eines Bestandsbaus',
    slogans: ['ABRISS STOPPEN'],
    author: 'Arch. DI Huber',
    institution: 'TU Wien',
    supervision: null,
    location: 'Linz',
    strategies: ['Bestandserhalt', 'Vorfertigung'],
    process_steps: ['Abriss stoppen', 'Bestand transformieren', 'gemeinschaftlich wohnen'],
  },
}

const REVIEW_FIXTURE: FileItem = {
  ...FIXTURE,
  id: 'dev-doc-review',
  versionState: 'in_review',
  versionCount: 2,
}

let scrolledIntoView = false

function ScrollRailIntoView(): null {
  useEffect(() => {
    const timer = setInterval(() => {
      if (scrolledIntoView) return clearInterval(timer)
      const panel = document.querySelector('[data-testid="document-revisions"]')
      if (!panel) return
      panel.scrollIntoView({ block: 'start', behavior: 'instant' })
      const box = panel.getBoundingClientRect()
      if (box.top >= 0 && box.top < window.innerHeight) {
        scrolledIntoView = true
        clearInterval(timer)
      }
    }, 120)
    return () => clearInterval(timer)
  }, [])
  return null
}

const REVIEW_PERMISSIONS = [
  'project:view',
  'project:edit',
  'project:documents:write',
] as const

const REVIEW_VERSIONS = {
  documentId: 'dev-doc-review',
  lifecycle: 'active',
  publishedVersionId: null,
  versions: [
    {
      id: 'ver_1',
      documentId: 'dev-doc-review',
      versionNumber: 1,
      state: 'in_review',
      contentType: 'text/markdown',
      fileSize: 18_400,
      contentHash: 'sha256:1',
      submittedBy: 'u-2',
      submittedAt: '2026-09-03T10:15:00.000Z',
      reviewedBy: null,
      reviewedAt: null,
      approvedBy: null,
      approvedAt: null,
      publishedBy: null,
      publishedAt: null,
      reviewComment: null,
      createdBy: 'u-2',
      createdAt: '2026-09-02T07:30:00.000Z',
      updatedAt: '2026-09-03T10:15:00.000Z',
    },
  ],
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __filePreviewShim?: boolean }
  if (!w.__filePreviewShim) {
    w.__filePreviewShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const officeMatch = /\/api\/documents\/dev-doc-(office-[a-z]+)\/preview$/.exec(url)
      if (officeMatch?.[1] === 'office-converting') {
        return new Promise<Response>(() => {})
      }
      if (officeMatch?.[1] === 'office-failed') {
        return Response.json({ code: 'RENDITION_FAILED' }, { status: 502 })
      }
      if (officeMatch) {
        return Response.json({
          url: PAGE_SVG,
          contentType: 'application/pdf',
          rendition: true,
          sourceContentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
      }
      const fileMatch = /\/api\/documents\/(.+)\/file$/.exec(url)
      if (fileMatch?.[1] === DRAWING_FIXTURE.id) {
        return new Response(a1SheetPdf('C'), { headers: { 'Content-Type': 'application/pdf' } })
      }
      if (fileMatch?.[1] === SEARCH_HIT_FIXTURE.id) {
        return new Response(buildPdf(searchHitPages()), { headers: { 'Content-Type': 'application/pdf' } })
      }
      if (fileMatch?.[1] === 'dev-doc-pdf-unreadable') {
        return new Response('upstream unavailable', { status: 500 })
      }
      if (fileMatch) {
        const pages =
          fileMatch[1] === 'dev-doc-office-converted' ? ROOM_PROGRAMME_PAGES : FIRE_SAFETY_PAGES
        return new Response(buildPdf(pages), { headers: { 'Content-Type': 'application/pdf' } })
      }
      if (/\/api\/documents\/.+\/preview$/.test(url)) {
        return Response.json({ url: PAGE_SVG })
      }
      const textMatch = /\/api\/documents\/(.+)\/text$/.exec(url)
      if (textMatch) {
        const body =
          textMatch[1] === 'dev-doc-csv'
            ? CSV_BODY
            : textMatch[1] === 'dev-doc-txt'
              ? TEXT_BODY
              : MARKDOWN_BODY
        return Response.json({ text: body, truncated: textMatch[1] === 'dev-doc-txt' })
      }
      if (/\/api\/documents\/.+\/versions\/reviewers$/.test(url)) {
        return Response.json({
          candidates: [
            { userId: 'u-1', name: 'Miriam Hofer' },
            { userId: 'u-2', name: 'Anna Berger' },
          ],
        })
      }
      if (/\/api\/documents\/.+\/versions$/.test(url)) {
        return Response.json(REVIEW_VERSIONS)
      }
      if (url.endsWith(`/api/documents/${SETTLING_FIXTURE.id}/status`)) {
        return Response.json(settlingStatus())
      }
      if (url.endsWith(`/api/documents/${SETTLING_FIXTURE.id}/visual-details`) && settlingReads < 4) {
        return Response.json({ details: [] })
      }
      if (/\/api\/documents\/.+\/visual-details$/.test(url)) {
        return Response.json({
          details: [
            {
              page: 3,
              contentType: 'drawing',
              drawingType: 'site_plan',
              scale: '1:500',
              segment: 0,
              text: 'Lageplan mit Feuerwehraufstellflächen, Löschwasserentnahmestellen und Zufahrten.',
              structured: null,
            },
            {
              page: 7,
              contentType: 'drawing',
              drawingType: 'floor_plan',
              scale: '1:100',
              segment: 0,
              text: 'Regelgeschoss mit eingetragenen Fluchtwegen und Brandabschnittsgrenzen (REI 90).',
              structured: normalizeDrawingStructured(DEV_STRUCTURED_RAW),
            },
            {
              page: 7,
              contentType: 'drawing',
              drawingType: 'section',
              scale: '1:50',
              segment: 1,
              text: 'Querschnitt durch das Atrium mit Galerieebenen und Oberlicht.',
              structured: null,
            },
          ],
        })
      }
      return real(input, init)
    }
  }
}

export default function FilePreviewDevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const params = use(searchParams)
  const authored = params.authored
  const variant = typeof params.variant === 'string' ? params.variant : undefined
  const textFixture =
    variant === 'markdown' || variant === 'csv' || variant === 'text'
      ? TEXT_FIXTURES[variant]
      : null

  if (variant === 'review') {
    return (
      <main className="bg-muted/40 flex min-h-dvh items-center justify-center">
        <ScrollRailIntoView />
        <div className="bg-popover text-popover-foreground h-[85dvh] w-[min(960px,calc(100%-2rem))] overflow-hidden rounded-2xl border shadow-lg phone:fixed phone:inset-0 phone:h-dvh phone:w-full phone:rounded-none phone:border-0">
          <FilePreviewPane
            file={REVIEW_FIXTURE}
            projectId="proj-demo"
            projectName="Wohnbau Nord — Linz"
            canManage
            canCollaborate
            lifecyclePermissions={REVIEW_PERMISSIONS}
            viewerUserId="u-1"
            onClose={() => {}}
          />
        </div>
      </main>
    )
  }

  if (variant === 'settling') return <SettlingPreview />

  const officeFile = isOfficeVariant(variant)
    ? officeFixture(variant)
    : isPdfVariant(variant)
      ? pdfFixture(variant)
      : variant === 'drawing'
        ? DRAWING_FIXTURE
        : variant === 'search-hit'
          ? SEARCH_HIT_FIXTURE
          : null

  return (
    <FilePreviewDialog
      file={officeFile ?? textFixture ?? (authored === 'agent' ? GENERATED_FIXTURE : FIXTURE)}
      projectId="proj-demo"
      projectName="Wohnbau Nord — Linz"
      canManage
      canCollaborate
      onClose={() => {}}
    />
  )
}
