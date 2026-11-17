import { stripDirectives, type StripOptions } from '@/lib/text/answer-directives'
import { stripCardMarkers } from '@/lib/text/card-markers'
import {
  answerDocuments,
  bibliographyRows,
  documentPages,
  isHttpUrl,
  type CitedDocument,
} from './citations'

export { stripCardMarkers }

export interface AnswerSourceLabels {
  heading: string
  page: (page: number) => string
  pages: (pages: number[]) => string
  untitled: string
}

const describeSource = (
  doc: CitedDocument,
  pageText: string | undefined,
  untitled: string
): string => {
  const title = doc.title?.trim() || doc.fileName?.trim() || untitled
  const fileName = doc.fileName?.trim()
  const locator = isHttpUrl(doc.url)
    ? doc.url
    : fileName && fileName !== title
      ? fileName
      : undefined

  const head = pageText ? `${title}, ${pageText}` : title
  return locator ? `${head} — ${locator}` : head
}

const pageTextFor = (doc: CitedDocument, labels: AnswerSourceLabels): string | undefined => {
  const pages = documentPages(doc)
  if (pages.length === 1) return labels.page(pages[0]!)
  if (pages.length > 1) return labels.pages(pages)
  return undefined
}

export const sourcesMarkdown = (documents: CitedDocument[], labels: AnswerSourceLabels): string => {
  const docs = answerDocuments(documents)
  if (docs.length === 0) return ''

  const rows = bibliographyRows(docs)
  const numbered = rows.map(
    (row) =>
      `[${row.number}] ${describeSource(
        row.document,
        row.locus.page != null ? labels.page(row.locus.page) : undefined,
        labels.untitled
      )}`
  )

  const claimed = new Set(rows.map((row) => row.document.id))
  const rest = docs
    .filter((doc) => !claimed.has(doc.id))
    .map((doc) => `- ${describeSource(doc, pageTextFor(doc, labels), labels.untitled)}`)

  const lines = Array.from(new Set([...numbered, ...rest]))
  if (lines.length === 0) return ''
  return `## ${labels.heading}\n\n${lines.join('\n')}`
}

export const hasCopyableSources = (documents: CitedDocument[]): boolean =>
  answerDocuments(documents).length > 0

export const answerMarkdown = (content: string, strip?: StripOptions): string =>
  stripDirectives(stripCardMarkers(content), strip)

export const answerMarkdownWithSources = (
  body: string,
  documents: CitedDocument[],
  labels: AnswerSourceLabels,
  strip?: StripOptions
): string => {
  const prose = stripDirectives(stripCardMarkers(body), strip)
  const sources = sourcesMarkdown(documents, labels)
  if (!sources) return prose
  return prose ? `${prose}\n\n${sources}` : sources
}
