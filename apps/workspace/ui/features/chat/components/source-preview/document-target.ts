import { isRenditionSource } from '@/lib/documents/preview-types'
import type { CitationLocus, CitationTarget, CitedDocument } from '../../lib/citations'

export type DocumentTarget = Extract<CitationTarget, { kind: 'document' }>
export type DownloadTarget = Extract<CitationTarget, { kind: 'download' }>
export type RisTarget = Extract<CitationTarget, { kind: 'ris' }>

export type InfoTarget = Extract<CitationTarget, { kind: 'info' }>

export const isImageTarget = (target: DocumentTarget): boolean =>
  target.document.type === 'stored' &&
  (target.document.contentType ?? '').toLowerCase().startsWith('image/')

export const isRenditionTarget = (target: DocumentTarget): boolean =>
  target.document.type === 'stored' && isRenditionSource(target.document)

export const asDownloadTarget = (target: DocumentTarget): DownloadTarget | null =>
  target.document.type === 'stored'
    ? {
        kind: 'download',
        title: target.title,
        fileName: target.document.filename,
        snippet: target.snippet,
        document: target.document,
      }
    : null

export const isRenditionUnavailable = (status: number): boolean => status === 415 || status === 502

export const RENDITION_PENDING_NOTICE_MS = 400

export const navigableLoci = (doc: CitedDocument): CitationLocus[] =>
  doc.loci.filter((locus) => typeof locus.page === 'number').sort((a, b) => a.page! - b.page!)

export const EMPTY_DOCUMENT_TARGET: DocumentTarget = {
  kind: 'document',
  title: '',
  fileName: '',
  document: { type: 'base', fileName: '' },
}
