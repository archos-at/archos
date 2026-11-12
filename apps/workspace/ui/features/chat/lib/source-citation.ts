/**
 * Citations an architect can paste: the line, the quoted passages and CSL-JSON. The
 * form is the office's `citation_style` record, interpreted by `@/shared/citation-style`;
 * this maps the citation model onto it. Nothing is invented: an unknown edition, page
 * or date is absent, never guessed.
 */

import { type CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import { FALLBACK_CITATION_STYLES } from '@/shared/citation-style-fallback'
import { quoteLine, sourceLine, styleFor, toCslItem as styledCslItem, type CitedSource, type CslItem } from '@/shared/citation-style'
import { refHost, refNumber, refPage, type CitationRef } from './citations'

export type { CslItem } from '@/shared/citation-style'

/** Characters a CSL `id` may carry — citation-js writes it as the BibTeX key. */
const UNSAFE_ID_CHARS = /[^A-Za-z0-9._-]+/g

/**
 * The identifier of ONE reference, unique per locus: a bibliography lists one row
 * per locus and CSL consumers key on `id`. It is reduced to the characters a BibTeX
 * key may carry; when that loses the identity (`p:3` and `p/3`), a fingerprint of
 * the real identity keeps two references apart.
 */
const cslId = (ref: CitationRef): string => {
  const base = refNumber(ref) ?? ref.document.id
  const locus = ref.locus ? `-${ref.locus.key}` : ''
  const identity = `source-${base}${locus}`
  const safe = identity.replace(UNSAFE_ID_CHARS, '-')
  return safe === identity ? safe : `${safe}-${fingerprint(identity)}`
}

/** FNV-1a, 32 bits: deterministic across runs, so an export keeps its ids. */
const fingerprint = (text: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** What the interpreter reads of a reference: the model's document, and this reference's locus and page. */
export const citedSource = (ref: CitationRef): CitedSource => ({
  ...ref.document,
  id: cslId(ref),
  host: refHost(ref),
  locus: ref.locus?.clause,
  page: refPage(ref),
})

const styleOf = (ref: CitationRef, styles: CitationStylePayload) => styleFor(styles, ref.document.line?.language)

/** One reference as a CSL-JSON item. `now` is passed in so `accessed` is testable. */
export const toCslItem = (ref: CitationRef, now: Date, styles = FALLBACK_CITATION_STYLES): CslItem =>
  styledCslItem(citedSource(ref), now, styleOf(ref, styles))

/** The reference line, in the style of the office's country, in the language of the source's text. */
export const toTechnicalText = (ref: CitationRef, now: Date, styles = FALLBACK_CITATION_STYLES): string =>
  sourceLine(citedSource(ref), now, styles)

/** The numbered bibliography for a whole answer. */
export const toTechnicalTextList = (refs: CitationRef[], now: Date, styles = FALLBACK_CITATION_STYLES): string =>
  refs.map((ref, index) => `[${refNumber(ref) ?? index + 1}] ${toTechnicalText(ref, now, styles)}`).join('\n')

/**
 * The quoted passages the answer leaned on. A reference with no passage is
 * skipped; with none at all, the bibliography is the honest fallback.
 */
export const toQuoteList = (refs: CitationRef[], now: Date, styles = FALLBACK_CITATION_STYLES): string => {
  const lines = refs.flatMap((ref) => {
    const snippet = ref.locus?.snippet?.trim()
    return snippet ? [quoteLine(snippet, citedSource(ref), styleOf(ref, styles))] : []
  })
  return lines.length > 0 ? lines.join('\n\n') : toTechnicalTextList(refs, now, styles)
}

/** CSL-JSON for a whole answer, ready for Zotero / Word / pandoc import. */
export const toCslJson = (refs: CitationRef[], now: Date, styles = FALLBACK_CITATION_STYLES): string =>
  JSON.stringify(
    refs.map((ref) => toCslItem(ref, now, styles)),
    null,
    2
  )
