import { MAX_ANNOTATION_BODY } from '@/lib/annotations/types'
import { stripDirectives } from '@/lib/text/answer-directives'

const CARD_MARKER = /[ \t]*\[\[card:[0-9]+\]\][ \t]*\n?/g

export const answerMarkdown = (text: string): string => text.replace(CARD_MARKER, '').trim()

const unmarked = (markdown: string): string =>
  markdown
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')

export function answerAsBody(text: string): string {
  const plain = unmarked(stripDirectives(answerMarkdown(text))).trim()
  return plain.length <= MAX_ANNOTATION_BODY ? plain : `${plain.slice(0, MAX_ANNOTATION_BODY - 1).trimEnd()}…`
}
