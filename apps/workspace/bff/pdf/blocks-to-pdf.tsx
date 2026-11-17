import React from 'react'
import { Document, Font, Page, StyleSheet, View } from '@react-pdf/renderer'

import { Link, Text } from './printable-text'
import type { DocBlock, DocRun } from '@/lib/answer-export/blocks'
import { PRODUCT_NAME } from '@/lib/brand'
import { CoverContent, COVER_PAGE_STYLE, PageFooter, RunningHeader, type CoverInfo } from './branding'
import { PDF_PAGE, PDF_THEME, PDF_TYPE } from './theme'

const FONT_FAMILY = 'Helvetica'
const MONO_FAMILY = 'Courier'

Font.registerHyphenationCallback((word) => [word])

const styles = StyleSheet.create({
  page: {
    fontFamily: FONT_FAMILY,
    fontSize: PDF_TYPE.body,
    color: PDF_THEME.body,
    backgroundColor: PDF_THEME.paper,
    paddingTop: PDF_PAGE.marginTop,
    paddingBottom: PDF_PAGE.marginBottom,
    paddingHorizontal: PDF_PAGE.margin,
  },

  h1Group: { marginTop: 20, marginBottom: 12 },
  h1: {
    fontSize: PDF_TYPE.h1,
    fontWeight: 'bold',
    color: PDF_THEME.ink,
    lineHeight: PDF_TYPE.lineHeightTight,
    letterSpacing: -0.4,
  },
  h1Rule: {
    width: 34,
    height: 2.5,
    marginTop: 8,
    backgroundColor: PDF_THEME.accent,
  },
  h2Group: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.rule,
  },
  h2Mark: {
    width: 5,
    height: 5,
    marginRight: 8,
    backgroundColor: PDF_THEME.accent,
  },
  h2: {
    fontSize: PDF_TYPE.h2,
    fontWeight: 'bold',
    color: PDF_THEME.ink,
    lineHeight: PDF_TYPE.lineHeightTight,
    letterSpacing: -0.2,
  },
  h3: {
    fontSize: PDF_TYPE.h3,
    fontWeight: 'bold',
    color: PDF_THEME.ink,
    letterSpacing: 0.3,
    marginTop: 14,
    marginBottom: 5,
  },
  h4: {
    fontSize: PDF_TYPE.h3 - 0.25,
    fontWeight: 'bold',
    color: PDF_THEME.ink,
    marginTop: 10,
    marginBottom: 4,
  },
  h5: {
    fontSize: PDF_TYPE.body,
    fontWeight: 'bold',
    color: PDF_THEME.body,
    marginTop: 8,
    marginBottom: 3,
  },

  body: { marginBottom: 8, lineHeight: PDF_TYPE.lineHeight },
  meta: {
    fontSize: PDF_TYPE.meta,
    color: PDF_THEME.subtle,
    marginBottom: 5,
    lineHeight: 1.4,
  },
  quote: {
    borderLeftWidth: 2.5,
    borderLeftColor: PDF_THEME.accent,
    backgroundColor: PDF_THEME.panel,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 8,
    marginTop: 4,
    marginBottom: 10,
  },
  quoteText: { fontStyle: 'italic', color: PDF_THEME.ink, lineHeight: PDF_TYPE.lineHeight },

  code: {
    backgroundColor: PDF_THEME.surface,
    borderWidth: 1,
    borderColor: PDF_THEME.hairline,
    padding: 10,
    marginTop: 6,
    marginBottom: 10,
  },
  codeText: {
    fontFamily: MONO_FAMILY,
    fontSize: PDF_TYPE.mono,
    lineHeight: 1.4,
    color: PDF_THEME.ink,
  },

  reference: {
    flexDirection: 'row',
    marginBottom: 7,
  },
  referenceChip: {
    backgroundColor: PDF_THEME.accentTint,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    marginRight: 8,
    borderRadius: 3,
  },
  referenceChipText: {
    fontSize: PDF_TYPE.meta,
    fontWeight: 'bold',
    color: PDF_THEME.accentInk,
    lineHeight: 1.2,
  },
  referenceBody: { flexGrow: 1, flexBasis: 1, lineHeight: 1.45 },

  bulletRow: { flexDirection: 'row', marginBottom: 4 },
  bulletMark: {
    width: 12,
    color: PDF_THEME.accent,
    fontWeight: 'bold',
  },
  bulletBody: { flexGrow: 1, flexBasis: 1, lineHeight: PDF_TYPE.lineHeight },

  table: {
    marginTop: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: PDF_THEME.hairline,
  },
  definitionTable: {
    marginTop: 4,
    marginBottom: 12,
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.hairline,
  },
  headRow: {
    flexDirection: 'row',
    backgroundColor: PDF_THEME.surface,
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.rule,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.hairline,
  },
  rowAlt: {
    flexDirection: 'row',
    backgroundColor: PDF_THEME.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.hairline,
  },
  cell: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: PDF_TYPE.table,
    lineHeight: 1.4,
  },
  headCell: {
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontSize: PDF_TYPE.meta,
    fontWeight: 'bold',
    color: PDF_THEME.ink,
    lineHeight: 1.3,
  },
  definitionLabel: {
    paddingVertical: 6,
    paddingHorizontal: 0,
    paddingRight: 10,
    fontSize: PDF_TYPE.table,
    color: PDF_THEME.subtle,
    lineHeight: 1.4,
  },
  definitionValue: {
    paddingVertical: 6,
    paddingHorizontal: 0,
    fontSize: PDF_TYPE.table,
    color: PDF_THEME.ink,
    lineHeight: 1.4,
  },

  rule: {
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.rule,
    marginTop: 14,
    marginBottom: 16,
  },

  bold: { fontWeight: 'bold', color: PDF_THEME.ink },
  italic: { fontStyle: 'italic' },
  mono: { fontFamily: MONO_FAMILY, fontSize: PDF_TYPE.mono },
  link: { color: PDF_THEME.accentInk, textDecoration: 'underline' },
})

const LINKISH = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()[\]]+)/g

const trimUrl = (url: string): string => url.replace(/[.,;:!?'"]+$/, '')

export function pdfText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return ''
}

const inlineNodes = (text: unknown, keyPrefix: string): React.ReactNode[] => {
  const safe = pdfText(text)
  const nodes: React.ReactNode[] = []
  let cursor = 0
  let key = 0

  LINKISH.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINKISH.exec(safe)) !== null) {
    const [full, mdLabel, mdUrl, bare] = match
    const url = bare ? trimUrl(bare) : mdUrl
    const label = bare ? url : mdLabel
    const end = bare ? match.index + url.length : match.index + full.length

    if (match.index > cursor) {
      nodes.push(<Text key={`${keyPrefix}-t${key++}`}>{safe.slice(cursor, match.index)}</Text>)
    }
    nodes.push(
      <Link key={`${keyPrefix}-a${key++}`} src={url} style={styles.link}>
        {label}
      </Link>
    )
    cursor = end
    LINKISH.lastIndex = end
  }

  if (cursor < safe.length) {
    nodes.push(<Text key={`${keyPrefix}-t${key++}`}>{safe.slice(cursor)}</Text>)
  }
  return nodes
}

const runStyle = (run: DocRun) => [
  ...(run.bold ? [styles.bold] : []),
  ...(run.italic ? [styles.italic] : []),
  ...(run.mono ? [styles.mono] : []),
]

const runNodes = (runs: DocRun[], keyPrefix: string): React.ReactNode[] =>
  runs.map((run, index) => (
    <Text key={`${keyPrefix}-r${index}`} style={runStyle(run)}>
      {inlineNodes(pdfText(run?.text), `${keyPrefix}-r${index}`)}
    </Text>
  ))

type ParagraphBlock = Extract<DocBlock, { kind: 'paragraph' }>
type TableBlock = Extract<DocBlock, { kind: 'table' }>

const isCodeListing = (block: ParagraphBlock): boolean =>
  block.runs.length === 1 && block.runs[0].mono === true && pdfText(block.runs[0].text).includes('\n')

const REFERENCE_MARKER = /^\[(\d{1,3})\]\s*$/

const referenceNumber = (block: ParagraphBlock): string | null => {
  const first = block.runs[0]
  if (!first?.bold) return null
  return REFERENCE_MARKER.exec(pdfText(first.text))?.[1] ?? null
}

const isDefinitionList = (block: TableBlock): boolean =>
  !block.head && block.rows.length > 0 && block.rows.every((row) => row.length === 2)

const headingNode = (
  block: Extract<DocBlock, { kind: 'heading' }>,
  key: string
): React.ReactNode => {
  if (block.level === 1) {
    return (
      <View key={key} style={styles.h1Group} wrap={false} minPresenceAhead={72}>
        <Text style={styles.h1}>{pdfText(block.text)}</Text>
        <View style={styles.h1Rule} />
      </View>
    )
  }
  if (block.level === 2) {
    return (
      <View key={key} style={styles.h2Group} wrap={false} minPresenceAhead={64}>
        <View style={styles.h2Mark} />
        <Text style={styles.h2}>{pdfText(block.text)}</Text>
      </View>
    )
  }
  return (
    <Text key={key} style={block.level === 5 ? styles.h5 : block.level === 4 ? styles.h4 : styles.h3} minPresenceAhead={56}>
      {pdfText(block.text)}
    </Text>
  )
}

const paragraphNode = (block: ParagraphBlock, key: string): React.ReactNode => {
  if (isCodeListing(block)) {
    return (
      <View key={key} style={styles.code}>
        <Text style={styles.codeText}>{pdfText(block.runs[0].text)}</Text>
      </View>
    )
  }

  const number = referenceNumber(block)
  if (number) {
    return (
      <View key={key} style={styles.reference} wrap={false}>
        <View style={styles.referenceChip}>
          <Text style={styles.referenceChipText}>{number}</Text>
        </View>
        <Text style={styles.referenceBody}>{runNodes(block.runs.slice(1), key)}</Text>
      </View>
    )
  }

  if (block.style === 'quote') {
    return (
      <View key={key} style={styles.quote}>
        <Text style={styles.quoteText}>{runNodes(block.runs, key)}</Text>
      </View>
    )
  }

  return (
    <Text key={key} style={block.style === 'meta' ? styles.meta : styles.body}>
      {runNodes(block.runs, key)}
    </Text>
  )
}

const bulletsNode = (
  block: Extract<DocBlock, { kind: 'bullets' }>,
  key: string
): React.ReactNode => (
  <View key={key} style={{ marginBottom: 8 }}>
    {block.items.map((item, index) => (
      <View key={`${key}-i${index}`} style={styles.bulletRow}>
        <Text style={styles.bulletMark}>•</Text>
        <Text style={styles.bulletBody}>{runNodes(item, `${key}-i${index}`)}</Text>
      </View>
    ))}
  </View>
)

const columnWidths = (columns: number, headed: boolean): string[] => {
  const weights = Array.from({ length: columns }, (_, index) =>
    headed && columns >= 3 && index === 0 ? 1.5 : 1
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => `${(weight / total) * 100}%`)
}

const definitionNode = (block: TableBlock, key: string): React.ReactNode => (
  <View key={key} style={styles.definitionTable}>
    {block.rows.map((row, index) => (
      <View key={`${key}-r${index}`} style={styles.row} wrap={false}>
        <Text style={[styles.definitionLabel, { width: '34%' }]}>
          {runNodes(row[0] ?? [], `${key}-r${index}-c0`)}
        </Text>
        <Text style={[styles.definitionValue, { width: '66%' }]}>
          {runNodes(row[1] ?? [], `${key}-r${index}-c1`)}
        </Text>
      </View>
    ))}
  </View>
)

const tableNode = (block: TableBlock, key: string): React.ReactNode => {
  if (isDefinitionList(block)) return definitionNode(block, key)

  const columns = Math.max(
    block.head?.length ?? 0,
    ...block.rows.map((row) => row.length),
    1
  )
  const widths = columnWidths(columns, Boolean(block.head))
  const padded = (row: DocRun[][]): DocRun[][] =>
    Array.from({ length: columns }, (_, index) => row[index] ?? [])

  return (
    <View key={key} style={styles.table}>
      {block.head ? (
        <View style={styles.headRow} wrap={false}>
          {Array.from({ length: columns }, (_, index) => (
            <Text key={`${key}-h${index}`} style={[styles.headCell, { width: widths[index] }]}>
              {pdfText(block.head?.[index] ?? '')}
            </Text>
          ))}
        </View>
      ) : null}
      {block.rows.map((row, rowIndex) => (
        <View
          key={`${key}-r${rowIndex}`}
          style={rowIndex % 2 === 1 ? styles.rowAlt : styles.row}
          wrap={false}
        >
          {padded(row).map((cell, cellIndex) => (
            <Text
              key={`${key}-r${rowIndex}-c${cellIndex}`}
              style={[styles.cell, { width: widths[cellIndex] }]}
            >
              {runNodes(cell, `${key}-r${rowIndex}-c${cellIndex}`)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

const blockNode = (block: DocBlock, index: number): React.ReactNode => {
  const key = `b${index}`
  switch (block.kind) {
    case 'heading':
      return headingNode(block, key)
    case 'paragraph':
      return paragraphNode(block, key)
    case 'bullets':
      return bulletsNode(block, key)
    case 'table':
      return tableNode(block, key)
    case 'rule':
      return <View key={key} style={styles.rule} />
  }
}

export const blockNodes = (blocks: DocBlock[]): React.ReactNode[] => blocks.map(blockNode)

export interface BlocksDocumentProps {
  cover: CoverInfo
  blocks: DocBlock[]
  keywords?: string
  subject?: string
}

export const BlocksDocument: React.FC<BlocksDocumentProps> = ({
  cover,
  blocks,
  keywords,
  subject,
}) => (
  <Document
    title={cover.title}
    author={PRODUCT_NAME}
    creator={PRODUCT_NAME}
    producer={PRODUCT_NAME}
    keywords={keywords}
    subject={subject}
  >
    <Page size="A4" style={COVER_PAGE_STYLE}>
      <CoverContent cover={cover} />
    </Page>
    <Page size="A4" style={styles.page}>
      <RunningHeader title={cover.title} />
      {/* The branding's footer line rides on the page footer that already
          exists rather than on a second fixed element: two fixed views at the
          same edge is how a footer stops being drawn at all (see the
          `lineHeight` note on `styles.page`). */}
      <PageFooter line={cover.chrome?.footerLine} />
      {blockNodes(blocks)}
    </Page>
  </Document>
)
