export const REPORT_SOURCE_ANCHOR_PREFIX = 'report-source-'

export type ReportSourceKind = 'kb' | 'web' | 'ris'

export interface ReportSourceEntry {
  number: number
  markdown: string
  sourceKind?: ReportSourceKind
}

export interface SplitReportSources {
  body: string
  heading: string | null
  entries: ReportSourceEntry[]
}

const SOURCES_HEADING_RE =
  /^(?:#{1,4}\s*|\*\*)?(?:\d+\.?\s*)?(sources|quellen|quellenverzeichnis|quellenangaben|references|referenzen)\s*:?\s*(?:\*\*)?$/i

const SOURCE_ENTRY_RE = /^\s*(?:[-*+]\s+)?(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+(.+)$/

const SOURCE_KIND_TOKEN_RE = /^\[(KB|Web|RIS)\]\s*/i

const TOKEN_TO_SOURCE_KIND: Record<string, ReportSourceKind> = {
  kb: 'kb',
  web: 'web',
  ris: 'ris',
}

const parseSourceKind = (
  text: string
): { markdown: string; sourceKind?: ReportSourceKind } => {
  const match = text.match(SOURCE_KIND_TOKEN_RE)
  if (!match) return { markdown: text }
  return {
    markdown: text.slice(match[0].length).trim(),
    sourceKind: TOKEN_TO_SOURCE_KIND[match[1].toLowerCase()],
  }
}

export const splitReportSources = (markdown: string): SplitReportSources => {
  const noSplit: SplitReportSources = { body: markdown, heading: null, entries: [] }
  if (!markdown.trim()) return noSplit

  const lines = markdown.split('\n')

  let headingIndex = -1
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence && SOURCES_HEADING_RE.test(line.trim())) {
      headingIndex = i
    }
  }
  if (headingIndex === -1) return noSplit

  const headingMatch = lines[headingIndex].trim().match(SOURCES_HEADING_RE)
  const heading = headingMatch ? headingMatch[1] : null

  const entries: ReportSourceEntry[] = []
  let end = lines.length
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,6}\s/.test(line)) {
      end = i
      break
    }
    const entryMatch = line.match(SOURCE_ENTRY_RE)
    if (entryMatch) {
      const number = Number(entryMatch[1] ?? entryMatch[2])
      const { markdown, sourceKind } = parseSourceKind(entryMatch[3].trim())
      entries.push({ number, markdown, sourceKind })
    } else if (line.trim() && entries.length > 0) {
      entries[entries.length - 1].markdown += ` ${line.trim()}`
    }
  }

  if (entries.length === 0) return noSplit

  const body = [...lines.slice(0, headingIndex), ...lines.slice(end)].join('\n').trimEnd()
  return { body, heading, entries }
}
