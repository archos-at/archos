import type { Link, Parent, PhrasingContent, Root, Text } from 'mdast'
import { fileReferenceHref } from '@/features/chat/lib/file-references'
import { OPAQUE_TO_MARKERS } from './citation-markers'

export interface FileReferenceOptions {
  fileNames: readonly string[]
}

export const remarkFileReferences =
  ({ fileNames }: FileReferenceOptions) =>
  (tree: Root): void => {
    const names = fileNames.filter((name) => name.trim().length > 0)
    if (names.length === 0) return
    linkFileNames(tree, names)
  }

const BOUNDARY_BEFORE = /[\p{L}\p{N}_./\\-]/u
const BOUNDARY_AFTER = /[\p{L}\p{N}_-]/u

const standsAlone = (value: string, start: number, end: number): boolean => {
  const before = start > 0 ? value[start - 1] : ''
  const after = end < value.length ? value[end] : ''
  if (before && BOUNDARY_BEFORE.test(before)) return false
  if (after && BOUNDARY_AFTER.test(after)) return false
  return true
}

const linkFileNames = (parent: Parent, fileNames: readonly string[]): void => {
  const rewritten: PhrasingContent[] = []
  let changed = false

  for (const child of parent.children) {
    if (child.type === 'text') {
      const parts = splitFileNames(child, fileNames)
      if (parts) {
        rewritten.push(...parts)
        changed = true
        continue
      }
    } else if ('children' in child && !OPAQUE_TO_MARKERS.has(child.type)) {
      linkFileNames(child, fileNames)
    }
    rewritten.push(child as PhrasingContent)
  }

  if (changed) parent.children = rewritten as Parent['children']
}

interface Span {
  start: number
  end: number
}

const occurrences = (value: string, needle: string): number[] => {
  const found: number[] = []
  const lowerNeedle = needle.toLowerCase()
  const lowerValue = value.toLowerCase()

  if (lowerValue.length === value.length && lowerNeedle.length === needle.length) {
    let from = 0
    for (;;) {
      const at = lowerValue.indexOf(lowerNeedle, from)
      if (at === -1) return found
      found.push(at)
      from = at + 1
    }
  }

  for (let at = 0; at + needle.length <= value.length; at += 1) {
    if (value.slice(at, at + needle.length).toLowerCase() === lowerNeedle) found.push(at)
  }
  return found
}

const claimedSpans = (value: string, fileNames: readonly string[]): Span[] => {
  const claimed: Span[] = []

  for (const name of fileNames) {
    for (const start of occurrences(value, name)) {
      const end = start + name.length
      if (!standsAlone(value, start, end)) continue
      if (claimed.some((span) => start < span.end && end > span.start)) continue
      claimed.push({ start, end })
    }
  }

  return claimed.sort((a, b) => a.start - b.start)
}

const splitFileNames = (node: Text, fileNames: readonly string[]): PhrasingContent[] | null => {
  const spans = claimedSpans(node.value, fileNames)
  if (spans.length === 0) return null

  const parts: PhrasingContent[] = []
  let cursor = 0
  for (const { start, end } of spans) {
    if (start > cursor) parts.push({ type: 'text', value: node.value.slice(cursor, start) })
    parts.push(fileReferenceLink(node.value.slice(start, end)))
    cursor = end
  }
  if (cursor < node.value.length) parts.push({ type: 'text', value: node.value.slice(cursor) })
  return parts
}

const fileReferenceLink = (label: string): Link => ({
  type: 'link',
  url: fileReferenceHref(label),
  children: [{ type: 'text', value: label }],
})
