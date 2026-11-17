import { stripDirectives } from '@/lib/text/answer-directives'
import { marked, type Token, type Tokens } from 'marked'
import type { DocBlock, DocRun, HeadingLevel } from './blocks'
import { DIAGRAM_SOURCE_KINDS } from '@/lib/diagrams/diagram-sources'
import { REFUSED_SKETCH_FENCE_LANGUAGE } from '@/lib/diagrams/sketch-fence'
import { PRODUCT_NAME } from '@/lib/brand'

type InlineHost = { tokens?: Token[]; text?: string; raw?: string }

const runsFrom = (tokens: Token[] | undefined, inherited: Partial<DocRun> = {}): DocRun[] => {
  if (!tokens) return []
  const runs: DocRun[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        runs.push(...runsFrom((token as Tokens.Strong).tokens, { ...inherited, bold: true }))
        break
      case 'em':
        runs.push(...runsFrom((token as Tokens.Em).tokens, { ...inherited, italic: true }))
        break
      case 'del':
        runs.push(...runsFrom((token as Tokens.Del).tokens, inherited))
        break
      case 'codespan':
        runs.push({ ...inherited, text: (token as Tokens.Codespan).text, mono: true })
        break
      case 'link': {
        const link = token as Tokens.Link
        const label = link.text?.trim() || link.href
        const suffix = link.href && link.href !== label ? ` (${link.href})` : ''
        runs.push({ ...inherited, text: `${label}${suffix}` })
        break
      }
      case 'br':
        runs.push({ ...inherited, text: '\n' })
        break
      case 'image':
        runs.push({ ...inherited, text: (token as Tokens.Image).text || '', italic: true })
        break
      default: {
        const text = (token as InlineHost).text ?? (token as InlineHost).raw ?? ''
        if (text) runs.push({ ...inherited, text })
      }
    }
  }
  return runs
}

const cellRuns = (cell: unknown): DocRun[] => {
  if (typeof cell === 'string') return [{ text: cell }]
  if (cell && typeof cell === 'object') {
    const host = cell as InlineHost
    const runs = runsFrom(host.tokens)
    if (runs.length > 0) return runs
    return [{ text: host.text ?? host.raw ?? '' }]
  }
  return [{ text: '' }]
}

const listBlocks = (token: Tokens.List): DocBlock[] => {
  const blocks: DocBlock[] = []
  const items: DocRun[][] = []
  token.items.forEach((item, index) => {
    const inline = (item.tokens ?? []).filter((child) => child.type !== 'list')
    const nested = (item.tokens ?? []).filter(
      (child): child is Tokens.List => child.type === 'list'
    )
    const prefix = token.ordered ? `${(token.start || 1) + index}. ` : ''
    const runs = inline.flatMap((child) =>
      child.type === 'text' || child.type === 'paragraph'
        ? runsFrom((child as InlineHost).tokens ?? [], {})
        : runsFrom([child])
    )
    items.push(prefix ? [{ text: prefix }, ...runs] : runs)
    for (const child of nested) blocks.push(...listBlocks(child))
  })
  if (items.length > 0) blocks.unshift({ kind: 'bullets', items })
  return blocks
}

const blockFrom = (token: Token, options: MarkdownToBlocksOptions = {}): DocBlock[] => {
  switch (token.type) {
    case 'space':
      return []
    case 'heading': {
      const heading = token as Tokens.Heading
      const prose = Math.min(3, Math.max(1, heading.depth + 1))
      return [{ kind: 'heading', level: Math.max(options.headingFloor ?? 1, prose) as HeadingLevel, text: heading.text }]
    }
    case 'paragraph':
      return [{ kind: 'paragraph', runs: runsFrom((token as Tokens.Paragraph).tokens) }]
    case 'text': {
      const runs = runsFrom((token as InlineHost).tokens)
      return [{ kind: 'paragraph', runs: runs.length > 0 ? runs : [{ text: (token as InlineHost).text ?? '' }] }]
    }
    case 'list':
      return listBlocks(token as Tokens.List)
    case 'blockquote':
      return (token as Tokens.Blockquote).tokens.flatMap((child) => blockFrom(child, options)).map((block) =>
        block.kind === 'paragraph' ? { ...block, style: 'quote' as const } : block
      )
    case 'code': {
      const code = token as Tokens.Code
      if (isDiagramFence(code.lang)) return diagramBlocks(code.lang, code.text, options.diagramPlaceholder)
      return [{ kind: 'paragraph', runs: [{ text: code.text, mono: true }] }]
    }
    case 'table': {
      const table = token as Tokens.Table
      return [
        {
          kind: 'table',
          head: table.header.map((cell) =>
            typeof cell === 'string' ? cell : ((cell as InlineHost).text ?? '')
          ),
          rows: table.rows.map((row) => row.map(cellRuns)),
        },
      ]
    }
    case 'hr':
      return [{ kind: 'rule' }]
    default: {
      const raw = ((token as InlineHost).text ?? (token as InlineHost).raw ?? '').trim()
      return raw ? [{ kind: 'paragraph', runs: [{ text: raw }] }] : []
    }
  }
}


const isDiagramFence = (lang: string | undefined): boolean =>
  typeof lang === 'string' &&
  ((DIAGRAM_SOURCE_KINDS as readonly string[]).includes(lang.trim().toLowerCase()) ||
    lang.trim().toLowerCase() === REFUSED_SKETCH_FENCE_LANGUAGE)

const isSketchFence = (lang: string | undefined): boolean =>
  /^excalidraw(?:-refused)?$/.test((lang ?? '').trim().toLowerCase())

export const diagramLabel = (lang: string | undefined): string =>
  isSketchFence(lang)
    ? 'Skizze — in dieser Datei nicht dargestellt. Die Antwort in ' + PRODUCT_NAME + ' zeigt sie als Zeichnung.'
    : `Diagramm (${(lang ?? '').trim().toLowerCase()}) — hier als Quelltext, im Original als Zeichnung.`

export const diagramBlocks = (lang: string | undefined, source: string, placeholder?: string): DocBlock[] => {
  if (placeholder) return [{ kind: 'paragraph', runs: [{ text: placeholder, italic: true }], style: 'meta' }]
  const label: DocBlock = { kind: 'paragraph', runs: [{ text: diagramLabel(lang), italic: true }], style: 'meta' }
  return source && !isSketchFence(lang) ? [label, { kind: 'paragraph', runs: [{ text: source, mono: true }] }] : [label]
}

export interface MarkdownToBlocksOptions {
  diagramPlaceholder?: string
  headingFloor?: HeadingLevel
}

export function markdownToBlocks(
  markdown: string,
  options: MarkdownToBlocksOptions = {}
): DocBlock[] {
  if (!markdown.trim()) return []
  return marked.lexer(stripDirectives(markdown)).flatMap((token) => blockFrom(token, options))
}
