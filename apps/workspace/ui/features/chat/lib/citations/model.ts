import { mergePageRegions, type PageRegion } from '@/features/knowledge/lib/page-region'
import type { CitationProject, CitationSource } from '../../types'
import type { CitationLineWire } from '@/shared/citation-line'
import { recordedName } from '@/shared/citation-style'
import { hostnameOf, isHttpUrl, normalizeUrl } from './text'
export { isHttpUrl } // `bff/agent-asks/answer-evidence.ts` imports it from here
import {
  KIND_TO_SIGNAL,
  accentForLane,
  authorityTag,
  asSourceKind,
  kindForLane,
  type Shelf,
  type SourceKind,
  type SourceTint,
} from '@/lib/source-kinds'
import { documentDisplayName } from '../document-names'

export type CitationOrigin = 'kb' | 'ris' | 'web'

export interface CitationLocus {
  key: string
  page?: number
  clause?: string
  score?: number
  number?: number
  isCited: boolean
  snippet?: string
  citationKey?: string
  regions?: PageRegion[]
}

export type LocusObservation = Omit<CitationLocus, 'key' | 'isCited'> & { isCited?: boolean }

export interface MeasuredElement {
  globalId: string
  name?: string
  ifcType?: string
}

export interface MeasurementFacts {
  provenance: string
  provenanceLabel: string
  valueText: string
  toleranceText?: string
  method: string
  statement: string
  elements: MeasuredElement[]
  model?: string
  caveat?: string
}

export interface CitedDocument {
  id: string
  title: string
  fileName?: string
  collection?: string
  shelf?: Shelf
  url?: string
  kind: SourceKind
  lane?: string
  laneLabel?: string
  tint: SourceTint
  authority?: string
  bindingNote?: string
  bindingStatus?: string
  line?: CitationLineWire
  project?: CitationProject
  origin?: CitationOrigin
  tool?: string
  snippet?: string
  loci: CitationLocus[]
}

const OIB_NUMBER_RE = /(?:oib[\s._-]*(?:rl|richtlinie)?|richtlinie)[\s._-]*(\d+(?:\.\d+)?)/i

export const oibDocumentKey = (nameOrLabel: string | undefined | null): string | null => {
  const raw = (nameOrLabel ?? '').trim().toLowerCase()
  if (!raw || !/(oib|richtlinie)/.test(raw)) return null

  const role = /erl[aä]uterung|erlaeuterung/.test(raw)
    ? 'erl'
    : /[äa]nderung|aenderung/.test(raw)
      ? 'aen'
      : ''
  const guide = /leitfaden/.test(raw) ? 'lf' : ''

  let subject: string | null = null
  if (/begriffsbestimmung/.test(raw)) subject = 'begriffe'
  else if (/zitierte/.test(raw) && /normen/.test(raw)) subject = 'zitnormen'
  else subject = OIB_NUMBER_RE.exec(raw)?.[1] ?? null

  if (!subject) return null
  return ['oib', role, subject, guide].filter(Boolean).join(':')
}

const OIB_IDENTITY_PREFIX = 'oib:'

const oibKeyFrom = (nameOrLabel: string | undefined | null): string | null => {
  const key = oibDocumentKey(nameOrLabel)
  return key ? `${OIB_IDENTITY_PREFIX}${key}` : null
}

const OIB_NAME_NOISE_RE =
  /\b(?:oib|richtlinien?|rl|ausgabe|fassung|vom|leitfaden|erl(?:ae|ä)uterung(?:en)?|(?:ae|ä)nderung(?:en)?|begriffsbestimmung(?:en)?|zitierte|normen|jan(?:uar)?|feb(?:ruar)?|m(?:ae|ä)rz|apr(?:il)?|mai|jun[i]?|jul[i]?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|dez(?:ember)?)\b/g

const oibCorpusKey = (nameOrLabel: string | undefined | null): string | null => {
  const key = oibKeyFrom(nameOrLabel)
  if (!key) return null
  const residue = (nameOrLabel ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/[_\-]+/g, ' ')
    .replace(OIB_NUMBER_RE, ' ')
    .replace(OIB_NAME_NOISE_RE, ' ')
    .replace(/[^a-zäöüß]+/g, '')
  return residue === '' ? key : null
}

const isBaseOrUnknownShelf = (shelf: Shelf | undefined): boolean =>
  shelf === undefined || shelf === 'base'

const DOCUMENT_EXTENSION_RE =
  /\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|md|csv|tsv|html?|xml|json|zip|dwg|dxf|ifc|png|jpe?g|tiff?|bmp|gif|webp|svg)$/

export const normalizeFileKey = (value: string | undefined | null): string =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '-')

export const documentExtensionOf = (value: string | undefined | null): string =>
  normalizeFileKey(value).match(DOCUMENT_EXTENSION_RE)?.[0] ?? ''

export const normalizeFileName = (value: string | undefined | null): string =>
  normalizeFileKey(value).replace(DOCUMENT_EXTENSION_RE, '')

export interface DocumentIdentityInput {
  documentId?: string
  fileName?: string
  collection?: string
  url?: string
  label?: string
}

export const documentIdentity = (input: DocumentIdentityInput): string => {
  const supplied = input.documentId?.trim()
  if (supplied) return supplied
  const fileName = normalizeFileKey(input.fileName)
  if (fileName) {
    const collection = input.collection?.trim().toLowerCase()
    return collection ? `doc:${collection}:${fileName}` : `doc:${fileName}`
  }
  const url = input.url?.trim()
  if (url) return `url:${normalizeUrl(url)}`
  const oib = oibDocumentKey(input.label)
  if (oib) return `oib:${oib}`
  const label = (input.label ?? '').trim().toLowerCase().slice(0, 120)
  return label ? `label:${label}` : ''
}

export const identityMatches = (a: string, b: string): boolean => {
  if (a === b) return true
  const fileKeyOf = (key: string): string => {
    if (!key.startsWith('doc:')) return ''
    const rest = key.slice('doc:'.length)
    const sep = rest.indexOf(':')
    return sep === -1 ? rest : rest.slice(sep + 1)
  }
  const fileOf = (key: string): { collection: string | null; file: string } | null => {
    if (!key.startsWith('doc:')) return null
    const rest = key.slice('doc:'.length)
    const sep = rest.indexOf(':')
    if (sep === -1) return { collection: null, file: normalizeFileName(rest) }
    return { collection: rest.slice(0, sep), file: normalizeFileName(rest.slice(sep + 1)) }
  }
  const fa = fileOf(a)
  const fb = fileOf(b)
  if (!fa || !fb || fa.file !== fb.file || !fa.file) return false
  const extA = documentExtensionOf(fileKeyOf(a))
  const extB = documentExtensionOf(fileKeyOf(b))
  if (extA && extB && extA !== extB) return false
  return fa.collection === null || fb.collection === null
}

export const locusKey = (page: number | undefined, citationKey?: string): string => {
  if (typeof page === 'number' && Number.isFinite(page)) return `p:${page}`
  const key = citationKey?.trim().toLowerCase()
  return key ? `k:${key}` : 'whole'
}

export const stripOriginToken = (text: string): string =>
  text.replace(/^\s*\[(KB|Web|RIS)\]\s*/i, '').trim()

export const resolveKind = (source: {
  kind?: string | null
  lane?: string | null
  origin?: string | null
  url?: string | null
}): SourceKind => {
  const canonical = asSourceKind(source.kind)
  if (canonical) return canonical
  if (source.lane?.trim()) return kindForLane(source.lane)
  if (source.origin === 'ris') return 'building_law'
  if (source.origin === 'kb') return 'building_law'
  if (source.url && /ris\.bka\.gv\.at/i.test(source.url)) return 'building_law'
  if (isHttpUrl(source.url)) return 'web'
  return 'building_law'
}

export const resolveTint = (kind: SourceKind, lane?: string | null): SourceTint =>
  accentForLane(lane, KIND_TO_SIGNAL[kind])

export const resolveTitle = (input: {
  title?: string | null
  fileName?: string | null
  url?: string | null
  label?: string | null
}): string => {
  const explicit = input.title?.trim()
  const fileName = input.fileName?.trim()
  if (explicit || fileName) return documentDisplayName(fileName ?? '', explicit)
  if (isHttpUrl(input.url)) {
    const host = hostnameOf(input.url!)
    if (host) return host
  }
  const label = stripOriginToken(input.label ?? '')
  if (label) return documentDisplayName(label)
  return input.url?.trim() ?? ''
}

export interface CitationRef {
  document: CitedDocument
  locus?: CitationLocus
}

export const citedLoci = (doc: CitedDocument): CitationLocus[] =>
  doc.loci
    .filter((locus) => locus.isCited)
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))

export const isCited = (doc: CitedDocument): boolean => doc.loci.some((locus) => locus.isCited)

export const citationNumbers = (doc: CitedDocument): number[] =>
  Array.from(
    new Set(
      doc.loci
        .map((locus) => locus.number)
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    )
  ).sort((a, b) => a - b)

const pagesOf = (loci: readonly CitationLocus[]): number[] =>
  Array.from(
    new Set(
      loci
        .map((locus) => locus.page)
        .filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
    )
  ).sort((a, b) => a - b)

export const citedPages = (doc: CitedDocument): number[] =>
  pagesOf(doc.loci.filter((locus) => locus.isCited))

export const readPages = (doc: CitedDocument): number[] => pagesOf(doc.loci)

export const documentPages = (doc: CitedDocument): number[] =>
  isCited(doc) ? citedPages(doc) : readPages(doc)

export const hitCount = (doc: CitedDocument): number => Math.max(doc.loci.length, 1)

export const refNumber = (ref: CitationRef): number | undefined =>
  ref.locus?.number ?? citationNumbers(ref.document)[0]

export const refPage = (ref: CitationRef): number | undefined => {
  if (ref.locus) return ref.locus.page
  const pages = documentPages(ref.document)
  return pages.length === 1 ? pages[0] : undefined
}

export const refPages = (ref: CitationRef): number[] =>
  ref.locus?.page != null ? [ref.locus.page] : documentPages(ref.document)

export const refHost = (ref: CitationRef): string | undefined =>
  ref.document.url && isHttpUrl(ref.document.url)
    ? (hostnameOf(ref.document.url) ?? undefined)
    : undefined

export const refKey = (ref: CitationRef): string =>
  ref.locus ? `${ref.document.id}#${ref.locus.key}` : ref.document.id

const KIND_ORDER: Record<SourceKind, number> = {
  building_law: 0,
  office: 1,
  project: 2,
  measurement: 3,
  web: 4,
}

export const compareDocuments = (a: CitedDocument, b: CitedDocument): number => {
  const numbersA = citationNumbers(a)
  const numbersB = citationNumbers(b)
  const firstA = numbersA[0] ?? Infinity
  const firstB = numbersB[0] ?? Infinity
  if (firstA !== firstB) return firstA - firstB
  const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  if (kind !== 0) return kind
  return a.title.localeCompare(b.title, 'de')
}

export class CitationAccumulator {
  private readonly docs = new Map<string, CitedDocument>()
  private readonly explicitShelves = new WeakMap<CitedDocument, Shelf>()

  add(observation: {
    identity: DocumentIdentityInput
    title?: string | null
    fileName?: string | null
    collection?: string | null
    shelf?: Shelf
    shelfFallback?: Shelf
    url?: string | null
    kind?: string | null
    lane?: string | null
    laneLabel?: string | null
    bindingNote?: string | null
    bindingStatus?: string | null
    line?: CitationLineWire
    project?: CitationProject
    origin?: string | null
    tool?: string | null
    snippet?: string | null
    locus?: LocusObservation
  }): CitedDocument | null {
    const id = documentIdentity(observation.identity)
    if (!id) return null
    const incomingTitle = resolveTitle({
      title: observation.title,
      fileName: observation.fileName,
      url: observation.url,
      label: observation.identity.label,
    })
    const existing = this.find(id, incomingTitle, observation.shelf ?? observation.shelfFallback, observation.fileName)
    const laneFromIdentity = oibKeyFrom(observation.fileName || observation.identity.label)
      ? 'building_law_oib'
      : undefined
    const kind = resolveKind({
      kind: observation.kind,
      lane: observation.lane ?? laneFromIdentity,
      origin: observation.origin,
      url: observation.url,
    })
    const lane = observation.lane?.trim() || existing?.lane || laneFromIdentity
    const resolvedKind = existing && !asSourceKind(observation.kind) ? existing.kind : kind

    const doc: CitedDocument = existing ?? {
      id,
      title: '',
      kind: resolvedKind,
      tint: resolveTint(resolvedKind, lane),
      loci: [],
    }

    doc.fileName = doc.fileName || observation.fileName?.trim() || undefined
    doc.collection = doc.collection || observation.collection?.trim() || undefined
    const explicitShelf = this.explicitShelves.get(doc) ?? observation.shelf
    if (explicitShelf) {
      this.explicitShelves.set(doc, explicitShelf)
      doc.shelf = explicitShelf
    } else {
      doc.shelf = doc.shelf ?? observation.shelfFallback
    }
    doc.url = doc.url ?? (observation.url?.trim() || undefined)
    doc.tool = doc.tool ?? (observation.tool?.trim() || undefined)
    doc.bindingNote = doc.bindingNote ?? (observation.bindingNote?.trim() || undefined)
    doc.bindingStatus = doc.bindingStatus ?? (observation.bindingStatus?.trim() || undefined)
    doc.line = doc.line ?? observation.line
    doc.project = doc.project ?? observation.project
    doc.snippet = doc.snippet ?? (observation.snippet?.trim() || undefined)
    doc.laneLabel = doc.laneLabel ?? (observation.laneLabel?.trim() || undefined)
    const origin = observation.origin?.trim().toLowerCase()
    if (!doc.origin && (origin === 'kb' || origin === 'ris' || origin === 'web')) {
      doc.origin = origin
    }
    if (asSourceKind(observation.kind)) doc.kind = asSourceKind(observation.kind)!
    if (lane) doc.lane = lane
    doc.tint = resolveTint(doc.kind, doc.lane)
    doc.authority = authorityTag(doc.lane) ?? doc.authority ?? undefined

    const title =
      resolveTitle({
        title: observation.title,
        fileName: doc.fileName,
        url: doc.url,
        label: observation.identity.label,
      }) || incomingTitle
    if (title && (!doc.title || looksLikeFilename(doc.title))) doc.title = title
    if (observation.title != null) {
      doc.title = recordedName({ title: observation.title, fileName: doc.fileName, line: observation.line ?? doc.line }) ?? doc.title
    }

    if (observation.locus) this.mergeLocus(doc, observation.locus)

    this.docs.set(doc.id, doc)
    return doc
  }

  private mergeLocus(
    doc: CitedDocument,
    locus: LocusObservation
  ): void {
    const page =
      typeof locus.page === 'number' && Number.isFinite(locus.page) ? locus.page : undefined
    const score =
      typeof locus.score === 'number' && Number.isFinite(locus.score) ? locus.score : undefined
    const key = locusKey(page, locus.citationKey)
    const existing = doc.loci.find((candidate) => candidate.key === key)
    if (existing) {
      existing.isCited = existing.isCited || !!locus.isCited
      existing.number = existing.number ?? locus.number
      existing.snippet = existing.snippet || locus.snippet?.trim() || undefined
      existing.citationKey = existing.citationKey || locus.citationKey?.trim() || undefined
      existing.clause = existing.clause || locus.clause?.trim() || undefined
      existing.regions = mergePageRegions(existing.regions, locus.regions)
      existing.score =
        existing.score === undefined
          ? score
          : score === undefined
            ? existing.score
            : Math.max(existing.score, score)
      return
    }
    doc.loci.push({
      key,
      page,
      clause: locus.clause?.trim() || undefined,
      score,
      number: locus.number,
      isCited: !!locus.isCited,
      snippet: locus.snippet?.trim() || undefined,
      citationKey: locus.citationKey?.trim() || undefined,
      regions: locus.regions?.length ? locus.regions : undefined,
    })
  }

  private find(
    id: string,
    title: string,
    shelf?: Shelf,
    fileName?: string | null
  ): CitedDocument | undefined {
    const exact = this.docs.get(id)
    if (exact) return exact
    for (const doc of this.docs.values()) {
      if (identityMatches(doc.id, id)) return doc
    }
    const incomingLabel = labelOf(id)
    const normIncomingLabel = incomingLabel ? normalizeFileName(incomingLabel) : ''
    const normName = normalizeFileName(title)
    for (const doc of this.docs.values()) {
      if (normIncomingLabel && normalizeFileName(doc.title) === normIncomingLabel) return doc
      const heldLabel = labelOf(doc.id)
      if (normName && heldLabel && normalizeFileName(heldLabel) === normName) return doc
    }
    return this.findOibCounterpart(id, title, shelf, fileName)
  }

  private findOibCounterpart(
    id: string,
    title: string,
    shelf: Shelf | undefined,
    fileName: string | null | undefined
  ): CitedDocument | undefined {
    const incomingOib = id.startsWith(OIB_IDENTITY_PREFIX) ? id : null
    const incomingKey = incomingOib ?? oibCorpusKey(fileName ?? title)
    if (!incomingKey) return undefined
    if (!isBaseOrUnknownShelf(shelf)) return undefined

    for (const doc of this.docs.values()) {
      const heldIsLabelOnly = doc.id.startsWith(OIB_IDENTITY_PREFIX)
      if (heldIsLabelOnly === Boolean(incomingOib)) continue
      if (!isBaseOrUnknownShelf(doc.shelf)) continue
      const heldKey = heldIsLabelOnly ? doc.id : oibCorpusKey(doc.fileName ?? doc.title)
      if (heldKey && heldKey === incomingKey) return doc
    }
    return undefined
  }

  findByNumber(number: number | undefined): CitedDocument | undefined {
    if (typeof number !== 'number') return undefined
    for (const doc of this.docs.values()) {
      if (doc.loci.some((locus) => locus.number === number)) return doc
    }
    return undefined
  }

  findByFile(normFile: string): CitedDocument | undefined {
    if (!normFile) return undefined
    const matches = Array.from(this.docs.values()).filter(
      (doc) => !!doc.fileName && normalizeFileName(doc.fileName) === normFile
    )
    return matches.length === 1 ? matches[0] : undefined
  }

  adoptWrittenLocus(doc: CitedDocument, locus: { number: number; page?: number }): void {
    const numbered = doc.loci.find((candidate) => candidate.number === locus.number)
    if (numbered?.page !== undefined) return
    this.mergeLocus(doc, { page: locus.page, number: locus.number, isCited: true })
  }

  attachLocus(
    doc: CitedDocument,
    locus: LocusObservation
  ): void {
    this.mergeLocus(doc, locus)
  }

  build(): CitedDocument[] {
    const docs = Array.from(this.docs.values())
    for (const doc of docs) {
      doc.loci.sort(locusOrder)
      if (!doc.title) doc.title = doc.fileName ?? doc.url ?? doc.id
    }
    return docs.sort(compareDocuments)
  }
}

const locusOrder = (a: CitationLocus, b: CitationLocus): number => {
  const numberDelta = (a.number ?? Infinity) - (b.number ?? Infinity)
  if (numberDelta !== 0) return numberDelta
  return (a.page ?? Infinity) - (b.page ?? Infinity)
}

const labelOf = (id: string): string | null =>
  id.startsWith('label:') ? id.slice('label:'.length) : null

const FILENAME_LIKE_RE = /^\S*\.\w{2,5}$/
const looksLikeFilename = (value: string): boolean => FILENAME_LIKE_RE.test(value.trim())

export const locusOf = (citation: CitationSource): CitationLocus => ({
  key: locusKey(citation.page, citation.citationKey),
  page: typeof citation.page === 'number' ? citation.page : undefined,
  clause: citation.clause?.trim() || undefined,
  score: typeof citation.score === 'number' ? citation.score : undefined,
  number: citation.number,
  isCited: !!citation.isCited,
  citationKey: citation.citationKey?.trim() || undefined,
  regions: citation.regions,
})
