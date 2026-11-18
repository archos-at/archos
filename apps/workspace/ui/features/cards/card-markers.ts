import type { Paragraph, PhrasingContent, Root, RootContent, Text } from 'mdast'
import type { Parent } from 'unist'
import { MARKDOWN_SLOT_TAG } from '@/shared/components/MarkdownRenderer/slot-context'
import { documentContinues } from '@/shared/components/MarkdownRenderer/markdown-blocks'

export interface CardMarkerOptions {
  count: number
  callout?: boolean
  pending?: boolean
}

export const CALLOUT_SLOT_INDEX = -1

export const remarkCardMarkers =
  ({ count, callout = false, pending = false }: CardMarkerOptions) =>
  (tree: Root, file?: Parameters<typeof documentContinues>[0]): void => {
    const children: RootContent[] = []
    let changed = false

    for (const child of tree.children) {
      const placed =
        child.type === 'paragraph' ? placeMarkers(child, pending ? Infinity : count, callout) : null
      if (placed) {
        children.push(...placed)
        changed = true
        continue
      }
      children.push(child)
    }
    if (changed) tree.children = children

    stripMarkers(tree)
    if (!documentContinues(file)) stripPartialTail(tree)
  }

const cardSlot = (index: number): Paragraph => ({
  type: 'paragraph',
  children: [],
  data: { hName: MARKDOWN_SLOT_TAG, hProperties: { index: String(index) } },
})

interface Marker {
  start: number
  end: number
  number: number | 'callout'
}

const MARKER = /\[\[card:(\d+)\]\]|\[\[callout\]\]/g

const findMarkers = (value: string): Marker[] => {
  const markers: Marker[] = []
  for (const match of value.matchAll(MARKER)) {
    markers.push({
      start: match.index,
      end: match.index + match[0].length,
      number: match[1] === undefined ? 'callout' : Number(match[1]),
    })
  }
  return markers
}

const placeMarkers = (paragraph: Paragraph, count: number, callout: boolean): RootContent[] | null => {
  const out: RootContent[] = []
  let run: PhrasingContent[] = []
  let found = false

  const flush = (): void => {
    const trimmed = trimRun(run)
    if (trimmed.length > 0) out.push({ type: 'paragraph', children: trimmed })
    run = []
  }

  paragraph.children.forEach((child, position) => {
    if (child.type !== 'text') {
      run.push(child)
      return
    }

    const markers = findMarkers(child.value).filter((marker) =>
      isOwnLine(marker, child, paragraph, position)
    )
    if (markers.length === 0) {
      run.push(child)
      return
    }
    found = true

    let cursor = 0
    for (const marker of markers) {
      const before = child.value.slice(cursor, marker.start)
      if (before.length > 0) run.push({ type: 'text', value: before })
      flush()
      if (marker.number === 'callout') {
        if (callout) out.push(cardSlot(CALLOUT_SLOT_INDEX))
      } else if (marker.number >= 1 && marker.number <= count) {
        out.push(cardSlot(marker.number - 1))
      }
      cursor = marker.end
      if (child.value[cursor] === '\n') cursor += 1
    }
    const after = child.value.slice(cursor)
    if (after.length > 0) run.push({ type: 'text', value: after })
  })

  if (!found) return null
  flush()
  return out
}

const isOwnLine = (marker: Marker, node: Text, paragraph: Paragraph, position: number): boolean => {
  const startsLine =
    marker.start === 0
      ? position === 0 || paragraph.children[position - 1]?.type === 'break'
      : node.value[marker.start - 1] === '\n'
  const endsLine =
    marker.end === node.value.length
      ? position === paragraph.children.length - 1 ||
        paragraph.children[position + 1]?.type === 'break'
      : node.value[marker.end] === '\n'
  return startsLine && endsLine
}

const trimRun = (run: PhrasingContent[]): PhrasingContent[] => {
  const isBlank = (node: PhrasingContent): boolean =>
    node.type === 'break' || (node.type === 'text' && node.value.trim().length === 0)

  let start = 0
  let end = run.length
  while (start < end && isBlank(run[start])) start += 1
  while (end > start && isBlank(run[end - 1])) end -= 1
  if (start >= end) return []

  const trimmed = run.slice(start, end)
  const first = trimmed[0]
  if (first.type === 'text') trimmed[0] = { type: 'text', value: first.value.replace(/^\n+/, '') }
  const last = trimmed[trimmed.length - 1]
  if (last.type === 'text') {
    trimmed[trimmed.length - 1] = { type: 'text', value: last.value.replace(/\n+$/, '') }
  }
  return trimmed
}

const stripMarkers = (parent: Parent): void => {
  const kept: RootContent[] = []
  let changed = false

  for (const child of parent.children as RootContent[]) {
    if (child.type === 'text') {
      const stripped = child.value.replace(MARKER, '')
      if (stripped !== child.value) {
        changed = true
        if (stripped.length === 0) continue
        kept.push({ ...child, value: stripped })
        continue
      }
    } else if ('children' in child) {
      stripMarkers(child)
      if (child.type === 'paragraph' && child.children.length === 0 && !child.data?.hName) {
        changed = true
        continue
      }
    }
    kept.push(child)
  }

  if (changed) parent.children = kept
}

const PARTIAL_TAIL = /\[\[(?:c(?:a(?:r(?:d(?::\d*\]?)?)?|l(?:l(?:o(?:u(?:t\]?)?)?)?)?)?)?)?$/

const stripPartialTail = (tree: Root): void => {
  const last = lastText(tree)
  if (!last) return
  last.value = last.value.replace(PARTIAL_TAIL, '')
}

const lastText = (node: Parent): Text | null => {
  const child = node.children[node.children.length - 1]
  if (!child) return null
  if (child.type === 'text') return child as Text
  if ('children' in child) return lastText(child as Parent)
  return null
}

const FENCE = /^ {0,3}(?:```|~~~)/
const LINE_MARKER = /^ {0,3}\[\[card:(\d+)\]\][ \t]*$/

export const placedCardIndices = (markdown: string, count: number): ReadonlySet<number> => {
  const placed = new Set<number>()
  if (count <= 0) return placed

  let fenced = false
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = LINE_MARKER.exec(line)
    if (!match) continue
    const number = Number(match[1])
    if (number >= 1 && number <= count) placed.add(number - 1)
  }
  return placed
}

const CALLOUT_LINE_MARKER = /^ {0,3}\[\[callout\]\][ \t]*$/

export const hasPlacedCalloutMarker = (markdown: string): boolean => {
  let fenced = false
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (CALLOUT_LINE_MARKER.test(line)) return true
  }
  return false
}

export const unplacedCardIndices = (markdown: string, count: number): number[] => {
  const placed = placedCardIndices(markdown, count)
  const rest: number[] = []
  for (let index = 0; index < count; index += 1) {
    if (!placed.has(index)) rest.push(index)
  }
  return rest
}
