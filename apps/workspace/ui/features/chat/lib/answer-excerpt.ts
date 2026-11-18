import type { AnswerExcerpt, ComposerExcerpt } from '../composer-types'

export const MAX_ANSWER_EXCERPT_CHARS = 2000

export const EXCERPT_SOURCE_ATTRIBUTE = 'data-answer-excerpt-source'

export interface SelectedExcerpt extends AnswerExcerpt {
  rect: DOMRect
}

export const clipExcerpt = (text: string): string => {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_ANSWER_EXCERPT_CHARS) return trimmed
  return Array.from(trimmed).slice(0, MAX_ANSWER_EXCERPT_CHARS).join('').trimEnd()
}

const sourceOf = (node: Node | null): Element | null => {
  const element = node instanceof Element ? node : (node?.parentElement ?? null)
  return element?.closest(`[${EXCERPT_SOURCE_ATTRIBUTE}]`) ?? null
}

export const selectedExcerpt = (selection: Selection | null): SelectedExcerpt | null => {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const source = sourceOf(selection.anchorNode)
  if (!source || source !== sourceOf(selection.focusNode)) return null
  const messageId = source.getAttribute(EXCERPT_SOURCE_ATTRIBUTE)
  const text = clipExcerpt(selection.toString())
  if (!messageId || !text) return null
  return { messageId, text, rect: selection.getRangeAt(0).getBoundingClientRect() }
}

export const excerptFor = (
  excerpt: ComposerExcerpt | null,
  conversationId: string | null | undefined
): ComposerExcerpt | null => (excerpt && conversationId && excerpt.conversationId === conversationId ? excerpt : null)

export const readStoredExcerpt = (value: unknown): AnswerExcerpt | null => {
  if (!value || typeof value !== 'object') return null
  const { messageId, text } = value as { messageId?: unknown; text?: unknown }
  if (typeof messageId !== 'string' || typeof text !== 'string') return null
  const clipped = clipExcerpt(text)
  return clipped ? { messageId, text: clipped } : null
}
