import { beforeAll, describe, expect, it } from 'vitest'
import { userMessageSchema } from '@/adapters/api/wire-v2.generated'
import {
  clipExcerpt,
  excerptFor,
  EXCERPT_SOURCE_ATTRIBUTE,
  MAX_ANSWER_EXCERPT_CHARS,
  readStoredExcerpt,
  selectedExcerpt,
} from './answer-excerpt'

const answer = (messageId: string, text: string): HTMLElement => {
  const element = document.createElement('div')
  element.setAttribute(EXCERPT_SOURCE_ATTRIBUTE, messageId)
  element.innerHTML = `<p>${text}</p>`
  document.body.append(element)
  return element
}

const select = (from: Node, to: Node = from): Selection => {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(from, 0)
  range.setEnd(to, to.textContent?.length ?? 0)
  selection.addRange(range)
  return selection
}

beforeAll(() => {
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(10, 20, 30, 40)
})

describe('the part of an answer a person selected', () => {
  it('is the selected text and the answer it came from', () => {
    const first = answer('a1', 'Die Fluchtweglänge darf 40 m nicht überschreiten.')
    const text = first.querySelector('p')!.firstChild!

    expect(selectedExcerpt(select(text))).toMatchObject({
      messageId: 'a1',
      text: 'Die Fluchtweglänge darf 40 m nicht überschreiten.',
    })
  })

  it('is nothing for a selection outside an answer, across two answers, or of nothing', () => {
    const first = answer('a1', 'Erste Antwort')
    const second = answer('a2', 'Zweite Antwort')
    const outside = document.createElement('p')
    outside.textContent = 'Eine Frage'
    document.body.append(outside)

    expect(selectedExcerpt(select(outside.firstChild!))).toBeNull()
    expect(selectedExcerpt(select(first.querySelector('p')!.firstChild!, second.querySelector('p')!.firstChild!))).toBeNull()
    document.getSelection()!.removeAllRanges()
    expect(selectedExcerpt(document.getSelection())).toBeNull()
    expect(selectedExcerpt(null)).toBeNull()
  })
})

describe('the length of an excerpt', () => {
  it('is cut to what the server takes, and the server takes exactly that', () => {
    const clipped = clipExcerpt(`  ${'x'.repeat(MAX_ANSWER_EXCERPT_CHARS + 50)}  `)
    const question = { type: 'user_message', conversation_id: 'c1', message_id: 'm1', text: 'Woher?' }

    expect(clipped).toHaveLength(MAX_ANSWER_EXCERPT_CHARS)
    expect(userMessageSchema.safeParse({ ...question, answer_excerpt: clipped }).success).toBe(true)
    expect(userMessageSchema.safeParse({ ...question, answer_excerpt: `${clipped}x` }).success).toBe(false)
  })

  it('never ends in half a character', () => {
    const clipped = clipExcerpt(`${'x'.repeat(MAX_ANSWER_EXCERPT_CHARS - 1)}🏛️🏛️`)

    expect(clipped.isWellFormed()).toBe(true)
  })
})

describe('the excerpt in the composer', () => {
  const excerpt = { conversationId: 'c1', messageId: 'a1', text: 'höchstens 40 m' }

  it('belongs to the conversation it was selected in', () => {
    expect(excerptFor(excerpt, 'c1')).toBe(excerpt)
    expect(excerptFor(excerpt, 'c2')).toBeNull()
    expect(excerptFor(excerpt, undefined)).toBeNull()
    expect(excerptFor(null, 'c1')).toBeNull()
  })
})

describe('the excerpt stored on a message', () => {
  it('is read back only in its own shape', () => {
    expect(readStoredExcerpt({ messageId: 'a1', text: ' höchstens 40 m ' })).toEqual({ messageId: 'a1', text: 'höchstens 40 m' })
    for (const other of [null, 'text', { text: 'x' }, { messageId: 'a1', text: 7 }, { messageId: 'a1', text: '  ' }]) {
      expect(readStoredExcerpt(other)).toBeNull()
    }
  })
})
