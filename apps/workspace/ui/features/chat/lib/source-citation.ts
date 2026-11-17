import { type CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import { FALLBACK_CITATION_STYLES } from '@/shared/citation-style-fallback'
import { quoteLine, sourceLine, styleFor, toCslItem as styledCslItem, type CitedSource, type CslItem } from '@/shared/citation-style'
import { refHost, refNumber, refPage, type CitationRef } from './citations'

export type { CslItem } from '@/shared/citation-style'

const UNSAFE_ID_CHARS = /[^A-Za-z0-9._-]+/g

const cslId = (ref: CitationRef): string => {
  const base = refNumber(ref) ?? ref.document.id
  const locus = ref.locus ? `-${ref.locus.key}` : ''
  const identity = `source-${base}${locus}`
  const safe = identity.replace(UNSAFE_ID_CHARS, '-')
  return safe === identity ? safe : `${safe}-${fingerprint(identity)}`
}

const fingerprint = (text: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export const citedSource = (ref: CitationRef): CitedSource => ({
  ...ref.document,
  id: cslId(ref),
  host: refHost(ref),
  locus: ref.locus?.clause,
  page: refPage(ref),
})

const styleOf = (ref: CitationRef, styles: CitationStylePayload) => styleFor(styles, ref.document.line?.language)

export const toCslItem = (ref: CitationRef, now: Date, styles = FALLBACK_CITATION_STYLES): CslItem =>
  styledCslItem(citedSource(ref), now, styleOf(ref, styles))

export const toTechnicalText = (ref: CitationRef, now: Date, styles = FALLBACK_CITATION_STYLES): string =>
  sourceLine(citedSource(ref), now, styles)

export const toTechnicalTextList = (refs: CitationRef[], now: Date, styles = FALLBACK_CITATION_STYLES): string =>
  refs.map((ref, index) => `[${refNumber(ref) ?? index + 1}] ${toTechnicalText(ref, now, styles)}`).join('\n')

export const toQuoteList = (refs: CitationRef[], now: Date, styles = FALLBACK_CITATION_STYLES): string => {
  const lines = refs.flatMap((ref) => {
    const snippet = ref.locus?.snippet?.trim()
    return snippet ? [quoteLine(snippet, citedSource(ref), styleOf(ref, styles))] : []
  })
  return lines.length > 0 ? lines.join('\n\n') : toTechnicalTextList(refs, now, styles)
}

export const toCslJson = (refs: CitationRef[], now: Date, styles = FALLBACK_CITATION_STYLES): string =>
  JSON.stringify(
    refs.map((ref) => toCslItem(ref, now, styles)),
    null,
    2
  )
