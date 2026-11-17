import type { RevisionRef } from '@/lib/documents/revision-links'
import type { Shelf } from '@/lib/source-kinds'
import { citedLoci, type CitationLocus, type CitedDocument } from './model'
import { isHttpUrl } from './text'
import { parseKbLocator, type KbCitationLocator } from './locator'
import {
  isIndexedFromRendition,
  isInlinePreviewable,
  isRenditionSource,
} from '@/lib/documents/preview-types'

export interface StoredDocumentRef {
  id: string
  filename: string
  contentType?: string | null
  shelf?: Shelf
  supersededBy?: RevisionRef | null
}

const STORED_SHELVES: ReadonlySet<Shelf> = new Set<Shelf>(['project', 'office_shelf', 'session'])

export type CitationTarget =
  | { kind: 'url'; url: string }
  | {
      kind: 'ris'
      title: string
      url: string
      snippet?: string
    }
  | {
      kind: 'document'
      title: string
      fileName: string
      page?: number
      snippet?: string
      document:
        | {
            type: 'stored'
            id: string
            filename: string
            contentType: string | null
            shelf?: Shelf
          }
        | { type: 'base'; fileName: string }
      supersededBy?: RevisionRef
    }
  | {
      kind: 'download'
      title: string
      fileName: string
      snippet?: string
      document: { type: 'stored'; id: string; filename: string; contentType: string | null }
      supersededBy?: RevisionRef
    }
  | { kind: 'info'; title: string; snippet?: string }

const isPreviewableContentType = isInlinePreviewable

const renditionPage = (filename: string, locus: CitationLocus | undefined): number => {
  const page = locus?.page
  if (
    isIndexedFromRendition(filename) &&
    typeof page === 'number' &&
    Number.isInteger(page) &&
    page >= 1
  )
    return page
  return 1
}

const supersededByOf = (row: StoredDocumentRef): { supersededBy?: RevisionRef } =>
  row.supersededBy ? { supersededBy: row.supersededBy } : {}

const documentLocator = (doc: CitedDocument): KbCitationLocator | null => {
  if (doc.fileName?.trim()) return { filename: doc.fileName.trim(), shelf: doc.shelf }
  for (const locus of doc.loci) {
    const parsed = locus.citationKey ? parseKbLocator(locus.citationKey) : null
    if (parsed) return { ...parsed, shelf: doc.shelf ?? parsed.shelf }
  }
  return null
}

export const citedFileName = (doc: CitedDocument): string | null => documentLocator(doc)?.filename ?? null

export const RIS_DOCUMENT_HOSTS: ReadonlySet<string> = new Set([
  'www.ris.bka.gv.at',
  'ris.bka.gv.at',
  'data.bka.gv.at',
])

export const isRisUrl = (url: string | undefined | null): boolean => {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && RIS_DOCUMENT_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

const isActionable = (locus: CitationLocus | undefined): locus is CitationLocus =>
  locus != null &&
  ((typeof locus.page === 'number' && Number.isFinite(locus.page)) || !!locus.snippet?.trim())

const openAt = (doc: CitedDocument, locus?: CitationLocus): CitationLocus | undefined => {
  const asked = locus ?? citedLoci(doc)[0] ?? doc.loci[0]
  if (isActionable(asked)) return asked
  return citedLoci(doc).find(isActionable) ?? doc.loci.find(isActionable) ?? asked
}

export const openAtLocus = (doc: CitedDocument, locus?: CitationLocus): CitationLocus | undefined =>
  openAt(doc, locus)

const addressTarget = (doc: CitedDocument, url: string, snippet: string | undefined): CitationTarget =>
  isRisUrl(url) ? { kind: 'ris', title: doc.title, url, snippet } : { kind: 'url', url }

export const resolveCitationTarget = (
  doc: CitedDocument,
  options?: {
    locus?: CitationLocus
    storedDocuments?: StoredDocumentRef[]
    baseCorpusFiles?: string[]
  }
): CitationTarget => {
  const locus = openAt(doc, options?.locus)
  const snippet = options?.locus?.snippet ?? locus?.snippet ?? doc.snippet
  if (isHttpUrl(doc.url)) return addressTarget(doc, doc.url!, snippet)

  const locator = documentLocator(doc)

  if (locator) {
    const wanted = locator.filename.toLowerCase()
    const named =
      options?.storedDocuments?.filter((row) => row.filename.toLowerCase() === wanted) ?? []
    const baseFile = options?.baseCorpusFiles?.find((name) => name.toLowerCase() === wanted)
    const shelf = locator.shelf
    const isStoredShelf = shelf !== undefined && STORED_SHELVES.has(shelf)

    const candidates =
      shelf === undefined
        ? named
        : isStoredShelf
          ? named.filter((row) => row.shelf === undefined || row.shelf === shelf)
          : []
    const storedDoc = candidates[0]

    const isOffice = storedDoc != null && isRenditionSource(storedDoc)
    if (storedDoc && (isPreviewableContentType(storedDoc.contentType) || isOffice)) {
      return {
        kind: 'document',
        title: doc.title,
        fileName: storedDoc.filename,
        page: isOffice ? renditionPage(storedDoc.filename, locus) : locus?.page,
        snippet,
        document: {
          type: 'stored',
          id: storedDoc.id,
          filename: storedDoc.filename,
          contentType: storedDoc.contentType ?? null,
          ...(storedDoc.shelf ? { shelf: storedDoc.shelf } : {}),
        },
        ...supersededByOf(storedDoc),
      }
    }
    if (baseFile && !isStoredShelf) {
      return {
        kind: 'document',
        title: doc.title,
        fileName: baseFile,
        page: locus?.page,
        snippet,
        document: { type: 'base', fileName: baseFile },
      }
    }
    if (storedDoc) {
      return {
        kind: 'download',
        title: doc.title,
        fileName: storedDoc.filename,
        snippet,
        document: {
          type: 'stored',
          id: storedDoc.id,
          filename: storedDoc.filename,
          contentType: storedDoc.contentType ?? null,
        },
        ...supersededByOf(storedDoc),
      }
    }
  }

  const publicUrl = doc.line?.public_url
  if (publicUrl && isHttpUrl(publicUrl)) return addressTarget(doc, publicUrl, snippet)

  return { kind: 'info', title: doc.title, snippet }
}
