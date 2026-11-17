import type { CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import type { CitationRef } from './citations'
import { toCslItem, toCslJson, toTechnicalTextList, toQuoteList } from './source-citation'

export type CitationFormat = 'quotes' | 'fachtext' | 'apa' | 'bibtex' | 'ris' | 'csl-json'

export const CITATION_FORMATS: readonly CitationFormat[] = [
  'quotes',
  'fachtext',
  'apa',
  'bibtex',
  'ris',
  'csl-json',
] as const

export const CITATION_FILE_EXTENSION: Record<CitationFormat, string> = {
  quotes: 'txt',
  fachtext: 'txt',
  apa: 'txt',
  bibtex: 'bib',
  ris: 'ris',
  'csl-json': 'json',
}

const SERVER_RENDERED = new Set<CitationFormat>(['apa', 'bibtex', 'ris'])

export const renderCitations = async (
  refs: CitationRef[],
  format: CitationFormat,
  now: Date,
  styles?: CitationStylePayload
): Promise<string> => {
  if (refs.length === 0) return ''
  if (format === 'quotes') return toQuoteList(refs, now, styles)
  if (format === 'csl-json') return toCslJson(refs, now, styles)
  if (!SERVER_RENDERED.has(format)) return toTechnicalTextList(refs, now, styles)

  try {
    const response = await fetch('/api/citations/format', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format,
        items: refs.map((ref) => toCslItem(ref, now, styles)),
      }),
    })
    if (!response.ok) return toTechnicalTextList(refs, now, styles)
    const data = (await response.json()) as { text?: unknown }
    return typeof data.text === 'string' && data.text.trim()
      ? data.text
      : toTechnicalTextList(refs, now, styles)
  } catch {
    return toTechnicalTextList(refs, now, styles)
  }
}
