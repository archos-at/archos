import 'server-only'
import React from 'react'
import { createHash } from 'node:crypto'
import { renderToStream } from '@react-pdf/renderer'
import type { AiProvenanceMarking } from '@/lib/ai-provenance'
import type { DocumentChrome } from './branding'
import { ReportPDF } from './ReactPdfDocument'
import { withAiProvenanceXmp } from './xmp-metadata'
import type { DocumentFact } from '@/lib/answer-export/answer-document'

export const PDF_MEDIA_TYPE = 'application/pdf'

export const MAX_MARKDOWN_PDF_CHARS = 440 * 1024

export const TABLE_CELL_COST_CHARS = 64

export function markdownRenderCost(markdown: string): number {
  let cells = 0
  for (const line of markdown.split('\n')) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('|')) continue
    let pipes = 0
    for (let i = 0; i < trimmed.length; i += 1) if (trimmed[i] === '|') pipes += 1
    cells += Math.max(0, pipes - 1)
  }
  return markdown.length + cells * TABLE_CELL_COST_CHARS
}

export class MarkdownTooLongError extends Error {
  constructor(
    readonly length: number,
    readonly limit: number = MAX_MARKDOWN_PDF_CHARS,
  ) {
    super(`markdown costs ${length} to lay out; the renderer accepts at most ${limit}`)
    this.name = 'MarkdownTooLongError'
  }
}

export interface MarkdownPdfOptions {
  diagramPlaceholder: string
  title?: string
  projectName?: string
  facts?: DocumentFact[]
  createdAt?: string
  cards?: unknown
  locale?: string
  marking: AiProvenanceMarking
  branding?: DocumentChrome
}



export interface MarkdownPdfInputFingerprint {
  chars: number
  cost: number
  sha256: string
  mermaidFences: number
  tableRows: number
  headings: number
  cardTypes: string[]
}

export function fingerprintMarkdownPdfInput(
  markdown: string,
  cards: unknown,
  cost: number = markdownRenderCost(markdown)
): MarkdownPdfInputFingerprint {
  let mermaidFences = 0
  let tableRows = 0
  let headings = 0
  for (const line of markdown.split('\n')) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('```mermaid')) mermaidFences += 1
    else if (trimmed.startsWith('|')) tableRows += 1
    else if (trimmed.startsWith('#')) headings += 1
  }
  const cardTypes: string[] = []
  if (Array.isArray(cards)) {
    for (const card of cards) {
      if (
        typeof card === 'object' &&
        card !== null &&
        'type' in card &&
        typeof card.type === 'string' &&
        !cardTypes.includes(card.type) &&
        cardTypes.length < 20
      ) {
        cardTypes.push(card.type)
      }
    }
  }
  return {
    chars: markdown.length,
    cost,
    sha256: createHash('sha256').update(markdown, 'utf8').digest('hex'),
    mermaidFences,
    tableRows,
    headings,
    cardTypes,
  }
}

type PdfDocumentElement = Parameters<typeof renderToStream>[0]

export async function renderMarkdownPdf(
  markdown: string,
  options: MarkdownPdfOptions
): Promise<Uint8Array> {
  const cost = markdownRenderCost(markdown)
  if (cost > MAX_MARKDOWN_PDF_CHARS) {
    throw new MarkdownTooLongError(cost)
  }

  const element = React.createElement(ReportPDF, {
    request: {
      markdown,
      title: options.title,
      projectName: options.projectName,
      facts: options.facts,
      createdAt: options.createdAt,
      cards: options.cards,
      locale: options.locale,
      diagramPlaceholder: options.diagramPlaceholder,
      aiProvenance: options.marking,
    },
    branding: options.branding,
  })

  const stream = await renderToStream(element as unknown as PdfDocumentElement).catch((error) => {
    const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error('[pdf] markdown render failed', {
      ...fingerprintMarkdownPdfInput(markdown, options.cards, cost),
      cause: cause.slice(0, 500),
    })
    throw error instanceof Error
      ? Object.assign(error, {
          cause: { fingerprint: fingerprintMarkdownPdfInput(markdown, options.cards, cost) },
        })
      : new Error(`[pdf] markdown render failed: ${cause}`, {
          cause: { fingerprint: fingerprintMarkdownPdfInput(markdown, options.cards, cost) },
        })
  })
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array))
  return withAiProvenanceXmp(new Uint8Array(Buffer.concat(chunks)), options.marking)
}
