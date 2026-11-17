import type { ReportSourceEntry } from '@/features/layout/lib/report-citations'
import type { CitationSource } from '../../types'
import type { TraceLaneCard } from '@/lib/conversations/message-provenance'
import {
  CitationAccumulator,
  isHttpUrl,
  normalizeFileName,
  stripOriginToken,
  type CitedDocument,
} from './model'
import { locatorFromPseudoUrl, parseKbLocator } from './locator'

export interface CitationInputs {
  citations?: CitationSource[]
  entries?: ReportSourceEntry[]
  traceLanes?: TraceLaneCard[]
}

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/i
const BARE_URL_RE = /(https?:\/\/[^\s)>\]]+)/i
const URL_SEPARATOR_RE = /[\s]*[-–—:]?[\s]*$/
const MD_MARKERS_RE = /[*`]/g

const ENTRY_KIND_TO_ORIGIN = { kb: 'kb', web: 'web', ris: 'ris' } as const

export const buildCitationModel = (inputs: CitationInputs): CitedDocument[] => {
  const accumulator = new CitationAccumulator()

  addWireCitations(accumulator, inputs.citations)
  addWrittenEntries(accumulator, inputs.entries)
  addTraceLanes(accumulator, inputs.traceLanes)

  return accumulator.build()
}

const addWireCitations = (
  accumulator: CitationAccumulator,
  citations: CitationSource[] | undefined
): void => {
  if (!citations?.length) return

  for (const citation of citations) {
    const parsed =
      (citation.citationKey ? parseKbLocator(citation.citationKey) : null) ??
      (citation.content ? parseKbLocator(citation.content) : null) ??
      (citation.url && !isHttpUrl(citation.url) ? locatorFromPseudoUrl(citation.url) : null)
    const fileName = citation.fileName?.trim() || parsed?.filename
    const page = typeof citation.page === 'number' ? citation.page : parsed?.page
    const label = citation.title || citation.citationKey || stripOriginToken(citation.content ?? '')

    accumulator.add({
      identity: {
        documentId: citation.documentId,
        fileName,
        collection: citation.collection,
        url: isHttpUrl(citation.url) ? citation.url : undefined,
        label,
      },
      title: citation.title,
      fileName,
      collection: citation.collection,
      shelf: citation.shelf,
      shelfFallback: parsed?.shelf,
      url: isHttpUrl(citation.url) ? citation.url : undefined,
      kind: citation.kind,
      lane: citation.lane,
      laneLabel: citation.laneLabel,
      bindingNote: citation.bindingNote,
      bindingStatus: citation.bindingStatus,
      line: citation.line,
      project: citation.project,
      origin: citation.origin,
      tool: citation.tool,
      locus: {
        page,
        clause: citation.clause,
        score: citation.score,
        number: citation.number,
        isCited: citation.isCited !== false,
        snippet: citation.snippet?.trim() || citationSnippet(citation),
        citationKey: citation.citationKey,
        regions: citation.regions,
      },
    })
  }
}

const LOOSE_PAGE_RE = /[,\s]\s*(?:p\.?|page)\s*(\d+)\s*$/i

const splitWrittenRef = (text: string): { name: string; page?: number } => {
  const match = LOOSE_PAGE_RE.exec(text)
  if (!match) return { name: text }
  const page = Number(match[1])
  return {
    name: text.slice(0, match.index).trim(),
    page: Number.isFinite(page) ? page : undefined,
  }
}

const TITLE_SEPARATOR_RE = /\s+[-–—]\s+|:\s+/g

export const writtenNameCandidates = (name: string): string[] => {
  const candidates = [name]
  for (const match of name.matchAll(TITLE_SEPARATOR_RE)) {
    const tail = name.slice((match.index ?? 0) + match[0].length).trim()
    if (tail && !candidates.includes(tail)) candidates.push(tail)
  }
  return candidates
}

const addWrittenEntries = (
  accumulator: CitationAccumulator,
  entries: ReportSourceEntry[] | undefined
): void => {
  if (!entries?.length) return

  for (const entry of entries) {
    const text = entry.markdown.replace(MD_MARKERS_RE, '').trim()

    let title = text
    let url: string | undefined
    const linkMatch = MARKDOWN_LINK_RE.exec(text)
    if (linkMatch) {
      url = linkMatch[2]
      title = text.replace(MARKDOWN_LINK_RE, linkMatch[1]).trim()
    } else {
      const urlMatch = BARE_URL_RE.exec(text)
      if (urlMatch) {
        url = urlMatch[1]
        title = text.slice(0, urlMatch.index).replace(URL_SEPARATOR_RE, '').trim()
      }
    }

    const locator = parseKbLocator(title || text)
    const ref = locator
      ? { name: locator.filename, page: locator.page }
      : splitWrittenRef(stripOriginToken(title || text))
    const bound = accumulator.findByNumber(entry.number)
    if (bound) {
      accumulator.adoptWrittenLocus(bound, { number: entry.number, page: ref.page })
      continue
    }
    const byFile = writtenNameCandidates(ref.name)
      .map((name) => accumulator.findByFile(normalizeFileName(name)))
      .find((doc) => doc !== undefined)
    if (byFile) {
      accumulator.attachLocus(byFile, { page: ref.page, number: entry.number, isCited: true })
      continue
    }
    const origin = entry.sourceKind ? ENTRY_KIND_TO_ORIGIN[entry.sourceKind] : undefined

    accumulator.add({
      identity: {
        fileName: locator?.filename,
        url: isHttpUrl(url) ? url : undefined,
        label: locator ? locator.filename : title || url || text,
      },
      title: locator ? undefined : title || undefined,
      fileName: locator?.filename,
      shelfFallback: locator?.shelf,
      url: isHttpUrl(url) ? url : undefined,
      origin,
      locus: {
        page: locator?.page,
        number: entry.number,
        isCited: true,
      },
    })
  }
}

const addTraceLanes = (
  accumulator: CitationAccumulator,
  lanes: TraceLaneCard[] | undefined
): void => {
  if (!lanes?.length) return

  for (const lane of lanes) {
    for (const source of lane.sources) {
      const name = source.name?.trim()
      if (!name) continue
      const detail = source.detail?.trim()
      const isUrl = isHttpUrl(detail)
      const page = !isUrl && detail ? Number(/p\.?\s*(\d+)/i.exec(detail)?.[1]) : NaN
      const looksLikeFile = /\.\w{2,5}$/.test(name)

      accumulator.add({
        identity: {
          fileName: looksLikeFile ? name : undefined,
          url: isUrl ? detail : undefined,
          label: source.title || name,
        },
        title: source.title,
        fileName: looksLikeFile ? name : undefined,
        url: isUrl ? detail : undefined,
        shelf: source.shelf,
        kind: lane.kind,
        lane: lane.key,
        laneLabel: lane.label,
        locus: {
          page: Number.isFinite(page) ? page : undefined,
          isCited: false,
        },
      })
    }
  }
}

const MAX_SNIPPET_LENGTH = 600

export const citationSnippet = (
  citation: Pick<CitationSource, 'url' | 'content' | 'title' | 'citationKey'>
): string | undefined => {
  const text = stripOriginToken(citation.content ?? '')
  const url = citation.url?.trim() ?? ''
  if (!text || (url && text === url)) return undefined
  if (text === citation.title?.trim() || text === citation.citationKey?.trim()) return undefined
  const lines = text.split('\n')
  const firstLine = lines[0]?.trim() ?? ''
  const body = parseKbLocator(firstLine) ? lines.slice(1).join('\n').trim() : text
  if (!body) return undefined
  return body.length > MAX_SNIPPET_LENGTH ? `${body.slice(0, MAX_SNIPPET_LENGTH - 1)}…` : body
}
