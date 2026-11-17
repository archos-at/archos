import { marked, type Tokens } from 'marked'
import type { Translator } from '@/i18n/translate'
import { stripDirectives } from '@/lib/text/answer-directives'
import type { DocBlock } from './blocks'
import type { ReferenceEntry } from './citations'
import { stampForQuote, type QuoteStamp } from '@/lib/conversations/message-quote-stamps'

export interface QuotedPassage {
  text: string
  number: number
}

const TRAILING_CITATION = /\s*\[(\d+)\]\s*$/

export function quotedPassages(markdown: string): QuotedPassage[] {
  const passages: QuotedPassage[] = []
  for (const token of marked.lexer(stripDirectives(markdown))) {
    if (token.type !== 'blockquote') continue
    const text = (token as Tokens.Blockquote).text.replace(/\s+/g, ' ').trim()
    const match = TRAILING_CITATION.exec(text)
    if (!match) continue
    passages.push({ text: text.slice(0, match.index).trim(), number: Number(match[1]) })
  }
  return passages
}

export function legalBasisBlocks(
  markdown: string,
  references: ReferenceEntry[],
  t: Translator,
  stamps?: readonly QuoteStamp[]
): DocBlock[] {
  const byNumber = new Map(references.map((reference) => [reference.number, reference]))
  const blocks: DocBlock[] = []
  for (const passage of quotedPassages(markdown)) {
    const reference = byNumber.get(passage.number)
    if (!reference || !passage.text) continue
    if (stamps && stampForQuote(stamps, passage.text, passage.number)?.status !== 'verbatim') continue
    const locator = [reference.label, reference.page].filter(Boolean).join(', ')
    blocks.push(
      { kind: 'paragraph', runs: [{ text: `[${passage.number}] `, bold: true }, { text: locator, bold: true }] },
      { kind: 'paragraph', runs: [{ text: passage.text }], style: 'quote' }
    )
  }
  return blocks.length > 0 ? [{ kind: 'heading', level: 2, text: t('legalBasis') }, ...blocks] : []
}
