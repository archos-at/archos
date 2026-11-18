'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Element, ElementContent, Root, RootContent } from 'hast'

import { ANSWER_BLOCK_TAG, ANSWER_ENERGY_TAG, ANSWER_MARKER_TAG, ANSWER_PROJECT_TAG } from './directives'
import { BLOCK_BODY_TAG } from './directive-shape'

export const STREAMING_CARET_TAG = 'streaming-caret'

const TEXT_HOSTS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th'])
const CONTAINERS = new Set(['ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', ANSWER_BLOCK_TAG, BLOCK_BODY_TAG])

const INLINE = new Set([
  'a', 'abbr', 'b', 'br', 'code', 'del', 'em', 'i', 'img', 'input', 'kbd', 'mark', 's', 'span', 'strong', 'sub', 'sup', 'u',
  ANSWER_MARKER_TAG, ANSWER_ENERGY_TAG, ANSWER_PROJECT_TAG,
])

const PLAIN_INLINE = new Set(['b', 'del', 'em', 'i', 's', 'strong', 'u'])

const isElement = (node: RootContent | ElementContent): node is Element => node.type === 'element'
const isBlank = (node: RootContent | ElementContent): boolean =>
  (node.type === 'text' && node.value.trim() === '') || node.type === 'comment'

function lastMeaningful(children: (RootContent | ElementContent)[]): RootContent | ElementContent | undefined {
  for (let index = children.length - 1; index >= 0; index--) {
    if (!isBlank(children[index])) return children[index]
  }
  return undefined
}

const hasText = (node: ElementContent): boolean =>
  node.type === 'text' ? node.value.trim() !== '' : isElement(node) && node.children.some(hasText)

function lastWrittenCell(row: Element): Element | undefined {
  const cells = row.children.filter((child): child is Element => isElement(child) && (child.tagName === 'td' || child.tagName === 'th'))
  for (let index = cells.length - 1; index >= 0; index--) {
    if (cells[index].children.some(hasText)) return cells[index]
  }
  return cells.at(-1)
}

export function caretHost(tree: Root): Element | null {
  let current = lastMeaningful(tree.children)
  while (current && isElement(current)) {
    const next: RootContent | ElementContent | undefined =
      current.tagName === 'tr' ? lastWrittenCell(current) : lastMeaningful(current.children)
    if (CONTAINERS.has(current.tagName) && next && isElement(next) && (CONTAINERS.has(next.tagName) || TEXT_HOSTS.has(next.tagName))) {
      current = next
      continue
    }
    if (!TEXT_HOSTS.has(current.tagName)) return null
    return !next || !isElement(next) || INLINE.has(next.tagName) ? current : null
  }
  return null
}

export function rehypeStreamingCaret() {
  return (tree: Root) => {
    const host = caretHost(tree)
    if (!host) return
    const before = lastMeaningful(host.children)
    const afterText = !before || before.type === 'text' || (isElement(before) && PLAIN_INLINE.has(before.tagName))
    host.children = [
      ...host.children,
      { type: 'element', tagName: STREAMING_CARET_TAG, properties: { dataAfter: afterText ? 'text' : 'markup' }, children: [] },
    ]
  }
}

const CaretContext = createContext<ReactNode>(null)

export const StreamingCaretProvider = CaretContext.Provider

export function MarkdownCaret({ node }: { node?: Element }) {
  const caret = useContext(CaretContext)
  if (caret === null) return null
  return (
    <span className="contents" data-caret-after={node?.properties?.dataAfter === 'markup' ? 'markup' : 'text'}>
      {caret}
    </span>
  )
}
