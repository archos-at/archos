import { type CitedDocument } from '../../lib/citations'

export const LEDE_CLASS =
  '[&>.markdown-content>p:first-child]:leading-[1.65] ' +
  '[&>.markdown-content>p:first-child]:mb-4'

export const proseClass = (lede: string): string | undefined => lede || undefined

export const SUMMARY_GAP = '\n\n'

export const NO_DOCUMENTS: CitedDocument[] = []

const NON_PROSE_OPENER = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|\[\[card:)/

const OPENER_DECIDABLE_CHARS = 8

export function opensWithProse(text: string, final: boolean): boolean | null {
  const trimmed = text.trimStart()
  if (!final && trimmed.length < OPENER_DECIDABLE_CHARS && !trimmed.includes('\n')) return null
  const firstLine = trimmed.split('\n', 1)[0]
  return Boolean(firstLine) && !NON_PROSE_OPENER.test(firstLine)
}
