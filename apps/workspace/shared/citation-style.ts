/**
 * The citation line's interpreter: it fills a country's `citation_style` record
 * (docs/design/citations.md, slice 2) and knows no country. Pure; BFF and UI read it.
 */

import type { CitationStyle, CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import type { CitationLineWire } from './citation-line'

/** Fill a template: each segment printed only when every field it names has a value. */
export const fillTemplate = (template: string | readonly string[], values: Readonly<Record<string, string | undefined>>) =>
  [template]
    .flat()
    .map((segment) => {
      let complete = true
      const text = segment.replace(/\{(\w+)\}/g, (_, field: string) => values[field] || ((complete = false), ''))
      return complete ? text : ''
    })
    .join('')

/** The style for a text in `language`: that tag, then that language with or without a region, then the first. */
export function styleFor({ styles }: CitationStylePayload, language = ''): CitationStyle {
  const base = (tag: string) => tag.split('-')[0]
  return styles.find((style) => style.language === language) ?? styles.find((style) => base(style.language) === base(language)) ?? styles[0]
}

/** CSL-JSON date shape (`{"date-parts": [[year, month]]}`). */
export interface CslDate {
  'date-parts': number[][]
}

/** A narrow CSL-JSON item: only the fields filled from real data. */
export interface CslItem {
  id: string
  type: string
  title: string
  authority?: string
  publisher?: string
  'publisher-place'?: string
  'container-title'?: string
  edition?: string
  page?: string
  /** The locus (a Punkt, a §): it identifies the requirement, a page only where one edition prints it. */
  section?: string
  issued?: CslDate
  accessed?: CslDate
  URL?: string
  note?: string
}

/** What the interpreter reads of one cited source: the citation model's own fields. */
export interface CitedSource {
  id: string
  title: string
  fileName?: string
  kind: string
  lane?: string
  laneLabel?: string
  authority?: string
  tint?: string
  origin?: string
  url?: string
  /** The language of the text read, which picks the style's language, and the records the text was read as. */
  line?: Pick<CitationLineWire, 'language' | 'edition_id' | 'designation' | 'edition_label' | 'issuer'>
  /** The host of `url`, for a web page. */
  host?: string
  locus?: string
  page?: number
}

const cslDate = (year: number, month?: number): CslDate => ({ 'date-parts': [month ? [year, month] : [year]] })

/** The edition the title or file name states, in the style's phrase, and its date; a bare year dates it only. */
function parseEdition(text: string, style: CitationStyle): { edition?: string; issued?: CslDate } {
  const phrase = style.edition
  // The record's word is found as text, never compiled: a regex from data is a ReDoS door.
  const [lower, word] = [text.toLowerCase(), phrase?.word.toLowerCase() ?? '']
  let match: RegExpExecArray | null = null
  for (let at = word ? lower.indexOf(word) : -1; phrase && at !== -1 && !match; at = lower.indexOf(word, at + 1)) {
    match = /^:?\s*(\p{L}+)?\s*(\d{4})/u.exec(text.slice(at + word.length))
  }
  if (phrase && match) {
    const [, named, year] = match
    const month = named && `${named[0].toUpperCase()}${named.slice(1).toLowerCase()}`
    return { edition: fillTemplate(phrase.label, { month, year }), issued: cslDate(Number(year), phrase.months[named?.toLowerCase() ?? '']) }
  }
  const year = /\b(19|20)\d{2}\b/.exec(text)
  return year ? { issued: cslDate(Number(year[0])) } : {}
}

/** The first of the style's kinds this source matches: by authority, tint, origin, or lane prefix. */
const kindOf = (source: CitedSource, { kinds }: CitationStyle) =>
  kinds.find(
    ({ match }) =>
      match.authorities.includes(source.authority ?? '') ||
      match.tints.includes(source.tint ?? '') ||
      match.origins.includes(source.origin ?? '') ||
      match.lanePrefixes.some((prefix) => (source.lane ?? '').toLowerCase().startsWith(prefix.toLowerCase()))
  )

/** A file name, not a title: what a corpus text no title of its own is called until the records name it. */
const FILE_NAME = /^\S*\.\w{2,5}$/

/**
 * What a text of an edition the records name is called, by them: the work's designation and the edition's
 * label. Only for a text with no title of its own (none, or its file name): law read live always carries its
 * title, and keeps it even where the records name an edition of its work. Undefined for any other source.
 */
export function recordedName(source: { title?: string | null; fileName?: string | null; line?: CitedSource['line'] }): string | undefined {
  const line = source.line
  if (!line?.edition_id || !line.designation) return undefined
  const named = [line.designation, line.edition_label].filter(Boolean).join(', ')
  const title = source.title?.trim() ?? ''
  const ownTitle = title !== '' && title !== named && title !== source.fileName?.trim() && !FILE_NAME.test(title)
  return ownTitle ? undefined : named
}

/**
 * A text of an edition the records name is a publication of the work's issuer, whatever lane or file name
 * it has: the style's kind for that publisher gives its place. A work whose record names no issuer, or one
 * the style spells otherwise, keeps the publisher of the standard kind its lane matches.
 */
function recordedItem(source: CitedSource, style: CitationStyle, base: { id: string; title: string }): CslItem {
  const line = source.line
  const matched = kindOf(source, style)
  const kind = (line?.issuer && style.kinds.find((one) => one.publisher === line.issuer)) || (matched?.type === 'standard' ? matched : undefined)
  const publisher = kind?.publisher ?? line?.issuer ?? undefined
  const by = publisher && { publisher, ...(kind?.place && { 'publisher-place': kind.place }), authority: publisher }
  return { ...base, type: 'standard', ...by, ...(line?.edition_label && { edition: line.edition_label }) }
}

/** One source as a CSL-JSON item. `now` is passed in, so `accessed` is testable. */
export function toCslItem(source: CitedSource, now: Date, style: CitationStyle): CslItem {
  const { id, url } = source
  const named = recordedName(source)
  const title = named ?? source.title.trim()
  const { edition, issued } = parseEdition(`${title} ${source.fileName ?? ''}`, style)
  const page = source.page != null ? String(source.page) : undefined
  const section = source.locus?.trim() || undefined
  const located = { ...(issued && { issued }), ...(section && { section }), ...(page && { page }) }
  const online = url ? { URL: url, accessed: cslDate(now.getFullYear(), now.getMonth() + 1) } : {}
  if (named) return { ...recordedItem(source, style, { id, title }), ...located, ...online }
  const kind = kindOf(source, style)
  if (kind?.type === 'standard') {
    const { publisher, place } = kind
    const by = publisher && { publisher, ...(place && { 'publisher-place': place }), authority: publisher }
    return { id, type: 'standard', title, ...by, ...(edition && { edition }), ...located, ...online }
  }
  if (kind?.type === 'legislation') {
    const authority = source.laneLabel && { authority: source.laneLabel }
    return { id, type: 'legislation', title, ...authority, ...(kind.container && { 'container-title': kind.container }), ...located, ...online }
  }
  if (source.kind === 'web') {
    return { id, type: 'webpage', title, ...(source.host && { 'container-title': source.host }), ...(issued && { issued }), ...online }
  }
  // A project or office document: an artifact, not a publication.
  const note = source.fileName && source.fileName !== title ? source.fileName : undefined
  return { id, type: 'report', title, ...(note && { note }), ...located }
}

const pad = (value: number) => String(value).padStart(2, '0')
const pageOf = (page: string | undefined, style: CitationStyle) => page && fillTemplate(style.page, { page })

/** The reference line in the style's form, for the kind of source the CSL item is. */
export function citationLine(csl: CslItem, now: Date, style: CitationStyle): string {
  // The edition is often part of the title already: never state it twice.
  const edition = csl.edition && !csl.title.toLowerCase().includes(csl.edition.toLowerCase()) ? csl.edition : undefined
  const locus = csl.section && /^\d/.test(csl.section) ? fillTemplate(style.bareLocus, { locus: csl.section }) : csl.section
  const accessed = { day: pad(now.getDate()), month: pad(now.getMonth() + 1), year: String(now.getFullYear()) }
  return fillTemplate(style.lines[csl.type as keyof CitationStyle['lines']] ?? style.lines.report, {
    ...{ title: csl.title, edition, locus, page: pageOf(csl.page, style), note: csl.note, url: csl.URL },
    ...{ publisher: csl.publisher, place: csl['publisher-place'], container: csl['container-title'] },
    accessed: csl.URL ? fillTemplate(style.date, accessed) : undefined,
  })
}

/** The line of one source, in the style for its text's language. */
export function sourceLine(source: CitedSource, now: Date, styles: CitationStylePayload): string {
  const style = styleFor(styles, source.line?.language)
  return citationLine(toCslItem(source, now, style), now, style)
}

/** A quoted passage with the source it is from, in the style's form. */
export const quoteLine = (quote: string, source: CitedSource, style: CitationStyle): string =>
  fillTemplate(style.quote, { quote, title: source.title.trim(), page: pageOf(source.page != null ? String(source.page) : undefined, style) })
