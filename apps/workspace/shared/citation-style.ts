import type { CitationStyle, CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import type { CitationLineWire } from './citation-line'

export const fillTemplate = (template: string | readonly string[], values: Readonly<Record<string, string | undefined>>) =>
  [template]
    .flat()
    .map((segment) => {
      let complete = true
      const text = segment.replace(/\{(\w+)\}/g, (_, field: string) => values[field] || ((complete = false), ''))
      return complete ? text : ''
    })
    .join('')

export function styleFor({ styles }: CitationStylePayload, language = ''): CitationStyle {
  const base = (tag: string) => tag.split('-')[0]
  return styles.find((style) => style.language === language) ?? styles.find((style) => base(style.language) === base(language)) ?? styles[0]
}

export interface CslDate {
  'date-parts': number[][]
}

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
  section?: string
  issued?: CslDate
  accessed?: CslDate
  URL?: string
  note?: string
}

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
  line?: Pick<CitationLineWire, 'language' | 'edition_id' | 'designation' | 'edition_label' | 'issuer'>
  host?: string
  locus?: string
  page?: number
}

const cslDate = (year: number, month?: number): CslDate => ({ 'date-parts': [month ? [year, month] : [year]] })

function parseEdition(text: string, style: CitationStyle): { edition?: string; issued?: CslDate } {
  const phrase = style.edition
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

const kindOf = (source: CitedSource, { kinds }: CitationStyle) =>
  kinds.find(
    ({ match }) =>
      match.authorities.includes(source.authority ?? '') ||
      match.tints.includes(source.tint ?? '') ||
      match.origins.includes(source.origin ?? '') ||
      match.lanePrefixes.some((prefix) => (source.lane ?? '').toLowerCase().startsWith(prefix.toLowerCase()))
  )

const FILE_NAME = /^\S*\.\w{2,5}$/

export function recordedName(source: { title?: string | null; fileName?: string | null; line?: CitedSource['line'] }): string | undefined {
  const line = source.line
  if (!line?.edition_id || !line.designation) return undefined
  const named = line.edition_label && line.edition_label !== line.designation ? `${line.designation}, ${line.edition_label}` : line.designation
  const title = source.title?.trim() ?? ''
  const ownTitle = title !== '' && title !== named && title !== source.fileName?.trim() && !FILE_NAME.test(title)
  return ownTitle ? undefined : named
}

function recordedItem(source: CitedSource, style: CitationStyle, base: { id: string; title: string }): CslItem {
  const line = source.line
  const matched = kindOf(source, style)
  const kind = (line?.issuer && style.kinds.find((one) => one.publisher === line.issuer)) || (matched?.type === 'standard' ? matched : undefined)
  const publisher = kind?.publisher ?? line?.issuer ?? undefined
  const by = publisher && { publisher, ...(kind?.place && { 'publisher-place': kind.place }), authority: publisher }
  return { ...base, type: 'standard', ...by, ...(line?.edition_label && { edition: line.edition_label }) }
}

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
  const note = source.fileName && source.fileName !== title ? source.fileName : undefined
  return { id, type: 'report', title, ...(note && { note }), ...located }
}

const pad = (value: number) => String(value).padStart(2, '0')
const pageOf = (page: string | undefined, style: CitationStyle) => page && fillTemplate(style.page, { page })

export function citationLine(csl: CslItem, now: Date, style: CitationStyle): string {
  const edition = csl.edition && !csl.title.toLowerCase().includes(csl.edition.toLowerCase()) ? csl.edition : undefined
  const locus = csl.section && /^\d/.test(csl.section) ? fillTemplate(style.bareLocus, { locus: csl.section }) : csl.section
  const accessed = { day: pad(now.getDate()), month: pad(now.getMonth() + 1), year: String(now.getFullYear()) }
  return fillTemplate(style.lines[csl.type as keyof CitationStyle['lines']] ?? style.lines.report, {
    ...{ title: csl.title, edition, locus, page: pageOf(csl.page, style), note: csl.note, url: csl.URL },
    ...{ publisher: csl.publisher, place: csl['publisher-place'], container: csl['container-title'] },
    accessed: csl.URL ? fillTemplate(style.date, accessed) : undefined,
  })
}

export function sourceLine(source: CitedSource, now: Date, styles: CitationStylePayload): string {
  const style = styleFor(styles, source.line?.language)
  return citationLine(toCslItem(source, now, style), now, style)
}

export const quoteLine = (quote: string, source: CitedSource, style: CitationStyle): string =>
  fillTemplate(style.quote, { quote, title: source.title.trim(), page: pageOf(source.page != null ? String(source.page) : undefined, style) })
