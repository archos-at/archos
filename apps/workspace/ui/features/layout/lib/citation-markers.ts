import type { Link, Parent, PhrasingContent, Root, Text } from 'mdast'
import { REPORT_SOURCE_ANCHOR_PREFIX } from './report-citations'

export interface CitationMarkerOptions {
  numbers: ReadonlySet<number>
  anchorPrefix?: string
  pending?: boolean
}

export const PENDING_CITATION_ANCHOR_PREFIX = 'cite-pending-'

export const remarkCitationMarkers =
  ({
    numbers,
    anchorPrefix = REPORT_SOURCE_ANCHOR_PREFIX,
    pending = false,
  }: CitationMarkerOptions) =>
  (tree: Root): void => {
    if (numbers.size === 0 && !pending) return
    linkMarkers(tree, { numbers, anchorPrefix, pending })
  }

interface LinkOptions {
  numbers: ReadonlySet<number>
  anchorPrefix: string
  pending: boolean
}

export const OPAQUE_TO_MARKERS: ReadonlySet<string> = new Set([
  'link',
  'linkReference',
  'image',
  'imageReference',
  'definition',
  'footnoteReference',
  'footnoteDefinition',
])

const linkMarkers = (parent: Parent, options: LinkOptions): void => {
  const rewritten: PhrasingContent[] = []
  let changed = false

  for (const child of parent.children) {
    if (child.type === 'text') {
      const parts = splitMarkers(child, options)
      if (parts) {
        rewritten.push(...parts)
        changed = true
        continue
      }
    } else if ('children' in child && !OPAQUE_TO_MARKERS.has(child.type)) {
      linkMarkers(child, options)
    }
    rewritten.push(child as PhrasingContent)
  }

  if (changed) parent.children = rewritten as Parent['children']
}

const splitMarkers = (
  node: Text,
  { numbers, anchorPrefix, pending }: LinkOptions
): PhrasingContent[] | null => {
  const markers = findMarkers(node.value).filter((marker) => pending || numbers.has(marker.number))
  if (markers.length === 0) return null

  const parts: PhrasingContent[] = []
  let cursor = 0
  for (const marker of markers) {
    if (marker.start > cursor) {
      parts.push({ type: 'text', value: node.value.slice(cursor, marker.start) })
    }
    parts.push(
      citationLink(
        marker.number,
        numbers.has(marker.number) ? anchorPrefix : PENDING_CITATION_ANCHOR_PREFIX
      )
    )
    cursor = marker.end
  }
  if (cursor < node.value.length) {
    parts.push({ type: 'text', value: node.value.slice(cursor) })
  }
  return parts
}

const citationLink = (number: number, anchorPrefix: string): Link => ({
  type: 'link',
  url: `#${anchorPrefix}${number}`,
  children: [{ type: 'text', value: `[${number}]` }],
})

interface Marker {
  start: number
  end: number
  number: number
}

const MAX_MARKER_DIGITS = 3

const isDigit = (char: string): boolean => char >= '0' && char <= '9'

const findMarkers = (value: string): Marker[] => {
  const markers: Marker[] = []
  let index = 0

  while (index < value.length) {
    if (value[index] !== '[') {
      index += 1
      continue
    }
    let cursor = index + 1
    while (cursor < value.length && isDigit(value[cursor])) cursor += 1
    const digits = cursor - index - 1
    if (digits > 0 && digits <= MAX_MARKER_DIGITS && value[cursor] === ']') {
      markers.push({
        start: index,
        end: cursor + 1,
        number: Number(value.slice(index + 1, cursor)),
      })
      index = cursor + 1
      continue
    }
    index += 1
  }

  return markers
}
