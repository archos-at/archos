import { KIND_TO_SIGNAL, modernizeLane, type Shelf, type SourceSignal } from '@/lib/source-kinds'
import { splitReportSources, type ReportSourceEntry } from '@/features/layout/lib/report-citations'
import {
  citationNumbers,
  citedLoci,
  isCited,
  type CitationLocus,
  type CitedDocument,
} from './model'

export const referencesByNumber = (
  docs: CitedDocument[]
): Map<number, { document: CitedDocument; locus?: CitationLocus }> => {
  const byNumber = new Map<number, { document: CitedDocument; locus?: CitationLocus }>()
  for (const document of docs) {
    for (const locus of document.loci) {
      if (typeof locus.number !== 'number') continue
      const held = byNumber.get(locus.number)
      if (held && (held.document !== document || held.locus?.page != null || locus.page == null)) {
        continue
      }
      byNumber.set(locus.number, { document, locus })
    }
    for (const number of citationNumbers(document)) {
      if (!byNumber.has(number)) byNumber.set(number, { document })
    }
  }
  return byNumber
}

export const ANSWER_SOURCE_ANCHOR_PREFIX = 'answer-source-'

export const answerSourceAnchorPrefix = (messageId: string): string =>
  `${ANSWER_SOURCE_ANCHOR_PREFIX}${messageId}-`

export const answerDocuments = (docs: CitedDocument[]): CitedDocument[] => {
  const claimed = docs.filter((doc) => isCited(doc) || doc.loci.length === 0)
  return claimed.length > 0 ? claimed : docs
}

export const unusedDocuments = (docs: CitedDocument[]): CitedDocument[] =>
  docs.filter((doc) => doc.loci.length > 0 && !isCited(doc))

export interface BibliographyRow {
  number: number
  document: CitedDocument
  locus: CitationLocus
}

export const bibliographyRows = (docs: CitedDocument[]): BibliographyRow[] => {
  const rows: BibliographyRow[] = []
  for (const doc of docs) {
    for (const locus of citedLoci(doc)) {
      if (typeof locus.number === 'number')
        rows.push({ number: locus.number, document: doc, locus })
    }
  }
  return rows.sort((a, b) => a.number - b.number)
}

export const anchoredNumbers = (docs: CitedDocument[]): Set<number> => {
  const numbers = new Set<number>()
  for (const doc of docs) for (const n of citationNumbers(doc)) numbers.add(n)
  return numbers
}

export const totalHits = (docs: CitedDocument[]): number =>
  docs.reduce((sum, doc) => sum + doc.loci.length, 0)

export interface AnswerBodySplit {
  body: string
  entries: ReportSourceEntry[]
  numbers: ReadonlySet<number>
}

export const splitAnswerBody = (markdown: string): AnswerBodySplit => {
  const split = splitReportSources(markdown)
  if (split.entries.length === 0) return { body: markdown, entries: [], numbers: EMPTY_NUMBERS }
  return {
    body: split.body,
    entries: split.entries,
    numbers: new Set(split.entries.map((entry) => entry.number)),
  }
}

const EMPTY_NUMBERS: ReadonlySet<number> = new Set()

export const proseLength = (markdown: string): number => {
  const split = splitReportSources(markdown)
  if (split.entries.length === 0 || !markdown.startsWith(split.body)) return markdown.length
  return split.body.length
}

export const NAMED_LANES = [
  'building_law_oib',
  'building_law_oib_guide',
  'building_law_oib_explanatory_note',
  'building_law_oib_definitions',
  'building_law_oib_reference',
  'building_law_oib_amendment',
  'building_law_ris',
  'building_law_base',
  'building_law_federal',
  'building_law_state',
  'building_law_ordinance',
  'authority',
  'external_standard',
  'office_piloti',
  'office_agent',
  'measurement',
] as const
export type NamedLane = (typeof NAMED_LANES)[number]

const isNamedLane = (lane: string): lane is NamedLane => (NAMED_LANES as readonly string[]).includes(lane)

export interface SourceTabLabels {
  (
    key:
      | `sourceTabs.${SourceSignal}`
      | `sourceTabs.shelves.${Shelf}`
      | `sourceTabs.lanes.${NamedLane}`
  ): string
}

export const documentShelfLabel = (doc: CitedDocument, t: SourceTabLabels): string | undefined =>
  doc.shelf ? t(`sourceTabs.shelves.${doc.shelf}`) : undefined

export const documentTabLabel = (doc: CitedDocument, t: SourceTabLabels): string => {
  const lane = modernizeLane(doc.lane?.trim())?.toLowerCase()
  if (lane && isNamedLane(lane)) return t(`sourceTabs.lanes.${lane}`)
  const legacy = lane ? undefined : doc.laneLabel?.trim()
  return legacy || documentShelfLabel(doc, t) || t(`sourceTabs.${KIND_TO_SIGNAL[doc.kind]}`)
}
