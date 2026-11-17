import type { Properties } from 'hast'
import type { Data, Parent, Root, RootContent, Text } from 'mdast'
import type { ContainerDirective, LeafDirective, TextDirective } from 'mdast-util-directive'
import {
  ENERGY_CLASS_DIRECTIVE,
  PROJECT_DIRECTIVE,
  energyClass,
  isDirectiveBlock,
  isDirectiveMarker,
  isProjectKey,
} from '@/lib/text/answer-directives'

type Directive = ContainerDirective | LeafDirective | TextDirective

interface FileLike {
  value?: unknown
}

export const ANSWER_BLOCK_TAG = 'answer-block'
export const ANSWER_BLOCK_LABEL_TAG = 'answer-block-label'
export const ANSWER_MARKER_TAG = 'answer-marker'
export const ANSWER_ENERGY_TAG = 'answer-energy'
export const ANSWER_PROJECT_TAG = 'answer-project'

const isDirective = (node: RootContent): node is Directive =>
  node.type === 'containerDirective' || node.type === 'leafDirective' || node.type === 'textDirective'

function sourceOf(node: Directive, source: string): string {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (source && start !== undefined && end !== undefined) return source.slice(start, end)
  const label = node.children.map((child) => ('value' in child ? String(child.value) : '')).join('')
  return `:${node.name}${label ? `[${label}]` : ''}`
}

const setElement = (node: { data?: Data }, tagName: string, properties: Properties) => {
  node.data = { ...node.data, hName: tagName, hProperties: properties }
}

function transform(node: Directive, source: string): RootContent[] {
  if (node.type === 'textDirective') {
    if (isDirectiveMarker(node.name) && node.children.length === 0) {
      setElement(node, ANSWER_MARKER_TAG, { dataMarker: node.name })
      return [node]
    }
    const label = node.children.map((child) => ('value' in child ? String(child.value) : '')).join('')
    if (node.name === PROJECT_DIRECTIVE && label.trim()) {
      const key = label.trim()
      if (!isProjectKey(key)) return [{ type: 'text', value: key } satisfies Text]
      setElement(node, ANSWER_PROJECT_TAG, { dataKey: key })
      node.children = [{ type: 'text', value: key }]
      return [node]
    }
    const rating = node.name === ENERGY_CLASS_DIRECTIVE ? energyClass(label) : null
    if (rating) {
      setElement(node, ANSWER_ENERGY_TAG, { dataClass: rating })
      node.children = [{ type: 'text', value: rating }]
      return [node]
    }
    return [{ type: 'text', value: sourceOf(node, source) } satisfies Text]
  }
  if (node.type === 'leafDirective') {
    return [{ type: 'paragraph', children: [{ type: 'text', value: sourceOf(node, source) }] }]
  }
  if (!isDirectiveBlock(node.name)) {
    return node.children as RootContent[]
  }
  const by = node.attributes?.by
  setElement(node, ANSWER_BLOCK_TAG, { dataBlock: node.name, dataBy: by && isProjectKey(by) ? by : undefined })
  const first = node.children[0]
  if (first && first.type === 'paragraph' && (first.data as { directiveLabel?: boolean } | undefined)?.directiveLabel) {
    setElement(first, ANSWER_BLOCK_LABEL_TAG, {})
  }
  return [node]
}

function visit(parent: Parent, source: string): void {
  const next: RootContent[] = []
  let changed = false
  for (const child of parent.children as RootContent[]) {
    if (isDirective(child)) {
      const replaced = transform(child, source)
      changed = true
      for (const node of replaced) {
        if ('children' in node) visit(node as Parent, source)
        next.push(node)
      }
      continue
    }
    if ('children' in child) visit(child as Parent, source)
    next.push(child)
  }
  if (changed) parent.children = mergeText(next) as Parent['children']
}

function mergeText(nodes: RootContent[]): RootContent[] {
  const out: RootContent[] = []
  for (const node of nodes) {
    const last = out[out.length - 1]
    if (node.type === 'text' && last?.type === 'text') {
      out[out.length - 1] = { type: 'text', value: last.value + node.value }
      continue
    }
    out.push(node)
  }
  return out
}

export function remarkAnswerDirectives() {
  return (tree: Root, file: FileLike) => {
    visit(tree, typeof file.value === 'string' ? file.value : '')
  }
}
