/**
 * Reading an SVG that arrived from a browser, and writing back one we made.
 *
 * ## Why bytes from a client are parsed rather than trusted
 *
 * Diagrams are laid out in the BROWSER and filed by the BFF. That split is
 * forced: mermaid and excalidraw both need a DOM to lay out a graph, and there
 * is no browser in this deployment — `playwright-core` is a devDependency and
 * putting Chromium into the production image is a deployment decision nobody
 * has made. So the client produces the SVG and the server admits it.
 *
 * The trust posture is the same one every upload already has: an authenticated
 * user's browser sent bytes, and the server stores them under that user's
 * authority. Saying so explicitly matters because it is easy to read "the
 * client rendered it" as "the server rendered it", and they are not the same
 * claim — nothing here can assert the SVG is a faithful drawing of the source
 * text beside it. What it CAN assert is that the file is inert.
 *
 * That assertion is worth making twice, because a stored SVG is served back to
 * browsers: an unvalidated one is stored XSS with a `documents` row and a
 * preview pane. So this module does both halves:
 *
 *   1. **Reject**, by name, anything a diagram has no business containing —
 *      `<script>`, `<foreignObject>`, `<style>`, `on*` handlers, and any
 *      reference that points outside the file. Named, because a caller and a
 *      test both need to know WHICH rule refused, and because a client that
 *      gets `unsupported-element` back can fix its renderer config.
 *   2. **Re-serialise from the parsed tree**, so what is stored is written by
 *      this file out of an allow-list, not copied from the request. Rule 1 is
 *      a deny-list and deny-lists are only ever as complete as the day they
 *      were written; rule 2 is what holds when rule 1 has a gap. Neither is
 *      redundant: without (1) a broken client fails silently and half-drawn,
 *      without (2) a spelling nobody thought of reaches the file.
 *   3. **Write the marking into what it serialises**, because this module is
 *      the only thing that produces the bytes a `.svg` is stored as, and a
 *      machine-drawn file that leaves the product has to say so in its own
 *      bytes — see {@link withDiagramMarking}.
 *
 * ## Why there is no XML library here
 *
 * There is no DOMParser in the Node runtime this route executes in, and adding
 * a parser dependency to read a file format we are about to narrow to twenty
 * elements is the wrong trade — a general parser's job is to accept, and this
 * one's job is to refuse. The scanner below therefore refuses everything it
 * does not explicitly understand, including DOCTYPE and entity declarations,
 * which is also what makes XXE and billion-laughs unrepresentable rather than
 * mitigated: there is no construct to declare an entity with.
 *
 * ## Why `<style>` is refused rather than sanitised
 *
 * A CSS parser would be a second place external references can hide (`@import`,
 * `url()`, `image-set()`), and the server would have to become a CSS engine to
 * know whether a rule is safe. It also would not help the PDF, which cannot
 * apply CSS at all. So the producer flattens computed styles onto presentation
 * attributes before it posts — `ui/features/diagrams/render-mermaid.ts` — and
 * a `<style>` block arriving here means the producer skipped that step. Failing
 * loudly at that point is the whole value: the alternative is a filed diagram
 * that renders correctly in the preview pane and blank in the PDF.
 */

import {
  DIAGRAM_SOURCE_FACTS,
  MAX_DIAGRAM_SVG_BYTES,
  MAX_DIAGRAM_SVG_DEPTH,
  type DiagramSourceKind,
} from './diagram-sources'

export const DIAGRAM_SVG_REJECTIONS = [
  'empty',
  'too-large',
  'malformed-xml',
  'doctype-or-entity',
  'not-svg',
  'missing-viewport',
  'script-element',
  'foreign-object',
  'style-element',
  'unsupported-element',
  'event-handler-attribute',
  'external-reference',
  'source-too-large',
  'too-deep',
] as const
export type DiagramSvgRejection = (typeof DIAGRAM_SVG_REJECTIONS)[number]

export interface SvgAttribute {
  readonly name: string
  readonly value: string
}

export interface SvgElement {
  readonly kind: 'element'
  readonly name: string
  readonly attributes: readonly SvgAttribute[]
  readonly children: readonly SvgNode[]
}

export interface SvgTextNode {
  readonly kind: 'text'
  readonly text: string
}

export type SvgNode = SvgElement | SvgTextNode

export interface SvgCensus {
  nodes: number
  elements: number
  textChars: number
  depth: number
  tags: Record<string, number>
}

export function censusSvg(root: SvgElement): SvgCensus {
  const tags: Record<string, number> = {}
  let nodes = 0
  let elements = 0
  let textChars = 0
  let depth = 0
  const walk = (node: SvgNode, level: number): void => {
    nodes += 1
    if (level > depth) depth = level
    if (node.kind === 'text') {
      textChars += node.text.length
      return
    }
    elements += 1
    tags[node.name] = (tags[node.name] ?? 0) + 1
    for (const child of node.children) walk(child, level + 1)
  }
  walk(root, 1)
  return { nodes, elements, textChars, depth, tags }
}

export class DiagramSvgError extends Error {
  constructor(
    readonly rejection: DiagramSvgRejection,
    readonly detail: string,
  ) {
    super(`${rejection}: ${detail}`)
    this.name = 'DiagramSvgError'
  }
}

const REFUSED_ELEMENTS: ReadonlyMap<string, DiagramSvgRejection> = new Map([
  ['script', 'script-element'],
  ['foreignobject', 'foreign-object'],
  ['style', 'style-element'],
])

const COMMON_ATTRIBUTES: ReadonlySet<string> = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'color',
  'visibility',
  'transform',
  'clip-path',
  'marker-start',
  'marker-mid',
  'marker-end',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'word-spacing',
  'id',
])

const ELEMENT_GEOMETRY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['svg', new Set(['xmlns', 'viewBox', 'width', 'height', 'preserveAspectRatio'])],
  ['g', new Set<string>()],
  ['defs', new Set<string>()],
  ['title', new Set<string>()],
  ['desc', new Set<string>()],
  ['path', new Set(['d'])],
  ['rect', new Set(['x', 'y', 'width', 'height', 'rx', 'ry'])],
  ['circle', new Set(['cx', 'cy', 'r'])],
  ['ellipse', new Set(['cx', 'cy', 'rx', 'ry'])],
  ['line', new Set(['x1', 'y1', 'x2', 'y2'])],
  ['polyline', new Set(['points'])],
  ['polygon', new Set(['points'])],
  ['text', new Set(['x', 'y', 'dx', 'dy'])],
  ['tspan', new Set(['x', 'y', 'dx', 'dy'])],
  ['clipPath', new Set(['clipPathUnits'])],
  [
    'marker',
    new Set([
      'markerWidth',
      'markerHeight',
      'refX',
      'refY',
      'orient',
      'markerUnits',
      'viewBox',
      'preserveAspectRatio',
    ]),
  ],
  ['linearGradient', new Set(['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform'])],
  ['radialGradient', new Set(['cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform'])],
  ['stop', new Set(['offset', 'stop-color', 'stop-opacity'])],
  ['metadata', new Set<string>()],
])

const METADATA_ELEMENT = 'metadata'
const METADATA_KIND_ATTRIBUTE = 'data-diagram-source'
export const STORED_METADATA_KIND_ATTRIBUTE = 'data-grid-diagram-source'

const MARKING_TITLE_ELEMENT = 'title'
const MARKING_DESC_ELEMENT = 'desc'

const NAME_START = /[A-Za-z_]/
const NAME_CHAR = /[A-Za-z0-9_.:-]/

class Scanner {
  private index = 0

  constructor(private readonly input: string) {}

  get done(): boolean {
    return this.index >= this.input.length
  }

  peek(offset = 0): string {
    return this.input[this.index + offset] ?? ''
  }

  startsWith(text: string): boolean {
    return this.input.startsWith(text, this.index)
  }

  take(count: number): string {
    const slice = this.input.slice(this.index, this.index + count)
    this.index += count
    return slice
  }

  expect(text: string, detail: string): void {
    if (!this.startsWith(text)) throw new DiagramSvgError('malformed-xml', detail)
    this.index += text.length
  }

  skipWhitespace(): void {
    while (!this.done && /\s/.test(this.peek())) this.index += 1
  }

  readUntil(terminator: string, detail: string): string {
    const at = this.input.indexOf(terminator, this.index)
    if (at === -1) throw new DiagramSvgError('malformed-xml', detail)
    const slice = this.input.slice(this.index, at)
    this.index = at
    return slice
  }

  readName(detail: string): string {
    if (!NAME_START.test(this.peek())) throw new DiagramSvgError('malformed-xml', detail)
    let name = ''
    while (!this.done && NAME_CHAR.test(this.peek())) name += this.take(1)
    return name
  }
}

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
])

function decodeEntities(raw: string, detail: string): string {
  return raw.replace(/&([^;\s]*);?/g, (match, body: string) => {
    if (!match.endsWith(';')) throw new DiagramSvgError('malformed-xml', `${detail}: bare ampersand`)
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const digits = isHex ? body.slice(2) : body.slice(1)
      if (!digits || !/^[0-9a-fA-F]+$/.test(digits)) {
        throw new DiagramSvgError('malformed-xml', `${detail}: bad numeric reference`)
      }
      const code = Number.parseInt(digits, isHex ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        throw new DiagramSvgError('malformed-xml', `${detail}: numeric reference out of range`)
      }
      return String.fromCodePoint(code)
    }
    const named = NAMED_ENTITIES.get(body)
    if (named === undefined) throw new DiagramSvgError('malformed-xml', `${detail}: unknown entity &${body};`)
    return named
  })
}

function skipTrivia(scanner: Scanner): void {
  for (;;) {
    scanner.skipWhitespace()
    if (scanner.startsWith('<!--')) {
      scanner.take(4)
      scanner.readUntil('-->', 'unterminated comment')
      scanner.take(3)
      continue
    }
    if (scanner.startsWith('<!')) {
      throw new DiagramSvgError('doctype-or-entity', scanner.take(10))
    }
    if (scanner.startsWith('<?')) {
      throw new DiagramSvgError('malformed-xml', 'processing instruction')
    }
    return
  }
}

function parseAttributeValue(scanner: Scanner, elementName: string, attributeName: string): string {
  const quote = scanner.peek()
  if (quote !== '"' && quote !== "'") {
    throw new DiagramSvgError('malformed-xml', `${elementName}/@${attributeName}: unquoted value`)
  }
  scanner.take(1)
  const raw = scanner.readUntil(quote, `${elementName}/@${attributeName}: unterminated value`)
  scanner.take(1)
  if (raw.includes('<')) {
    throw new DiagramSvgError('malformed-xml', `${elementName}/@${attributeName}: '<' in value`)
  }
  return decodeEntities(raw, `${elementName}/@${attributeName}`)
}

function parseElement(scanner: Scanner, depth: number): SvgElement {
  if (depth > MAX_DIAGRAM_SVG_DEPTH) {
    throw new DiagramSvgError('too-deep', `nested deeper than ${MAX_DIAGRAM_SVG_DEPTH}`)
  }
  scanner.expect('<', 'expected an element')
  const name = scanner.readName('expected an element name')

  const refused = REFUSED_ELEMENTS.get(name.toLowerCase())
  if (refused) throw new DiagramSvgError(refused, name)

  const attributes: SvgAttribute[] = []
  const seen = new Set<string>()
  for (;;) {
    scanner.skipWhitespace()
    if (scanner.startsWith('/>')) {
      scanner.take(2)
      return { kind: 'element', name, attributes, children: [] }
    }
    if (scanner.startsWith('>')) {
      scanner.take(1)
      break
    }
    const attributeName = scanner.readName(`${name}: expected an attribute name`)
    if (seen.has(attributeName)) {
      throw new DiagramSvgError('malformed-xml', `${name}/@${attributeName}: duplicate attribute`)
    }
    seen.add(attributeName)
    scanner.skipWhitespace()
    scanner.expect('=', `${name}/@${attributeName}: expected '='`)
    scanner.skipWhitespace()
    const value = parseAttributeValue(scanner, name, attributeName)
    refuseDangerousAttribute(name, attributeName, value)
    if (attributeName === 'style') attributes.push(...flattenStyleAttribute(name, value))
    else attributes.push({ name: attributeName, value })
  }

  const children: SvgNode[] = []
  for (;;) {
    if (scanner.done) throw new DiagramSvgError('malformed-xml', `${name}: unclosed element`)
    if (scanner.startsWith('</')) {
      scanner.take(2)
      const closing = scanner.readName(`${name}: expected a closing tag name`)
      if (closing !== name) {
        throw new DiagramSvgError('malformed-xml', `${name}: closed by </${closing}>`)
      }
      scanner.skipWhitespace()
      scanner.expect('>', `${name}: unterminated closing tag`)
      return { kind: 'element', name, attributes, children }
    }
    if (scanner.startsWith('<!--')) {
      skipTrivia(scanner)
      continue
    }
    if (scanner.startsWith('<!') || scanner.startsWith('<?')) {
      skipTrivia(scanner)
      continue
    }
    if (scanner.startsWith('<')) {
      children.push(parseElement(scanner, depth + 1))
      continue
    }
    const raw = scanner.readUntil('<', `${name}: unclosed element`)
    const text = decodeEntities(raw, `${name}: text`)
    if (text.length > 0) children.push({ kind: 'text', text })
  }
}

/**
 * Turn a `style="fill:#eee;stroke-width:2"` attribute into real attributes.
 *
 * The `<style>` ELEMENT is refused (see the module header: selectors, the
 * cascade and `@import` would make this a CSS engine). A style ATTRIBUTE is a
 * different object — a flat list of declarations on one element, with no
 * selector to resolve and no document to reach out of — so it is read rather
 * than dropped, and the reason is fidelity: mermaid puts real paint in there,
 * and dropping it files a diagram that previews grey and prints blank.
 *
 * Only declarations this module already allows as attributes survive, and each
 * value goes through the same refusal the attribute form does, so `fill:
 * url(https://…)` is refused in both spellings rather than in one.
 *
 * A declaration that collides with a real attribute on the same element wins,
 * because the serialiser keeps the LAST value for a name and these are appended
 * where the `style` attribute stood. That is CSS's own precedence — a style
 * declaration beats a presentation attribute — and it is the only piece of the
 * cascade implemented here, deliberately.
 */
function flattenStyleAttribute(elementName: string, style: string): SvgAttribute[] {
  const attributes: SvgAttribute[] = []
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const name = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (!value || !COMMON_ATTRIBUTES.has(name) || name === 'id') continue
    refuseDangerousAttribute(elementName, `style/${name}`, value)
    attributes.push({ name, value })
  }
  return attributes
}

function refuseDangerousAttribute(elementName: string, attributeName: string, value: string): void {
  const lower = attributeName.toLowerCase()

  if (lower.startsWith('on')) {
    throw new DiagramSvgError('event-handler-attribute', `${elementName}/@${attributeName}`)
  }

  if (lower === 'href' || lower.endsWith(':href')) {
    if (!value.startsWith('#')) {
      throw new DiagramSvgError('external-reference', `${elementName}/@${attributeName}`)
    }
    return
  }

  for (const match of value.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    const target = match[2].trim()
    if (!target.startsWith('#')) {
      throw new DiagramSvgError('external-reference', `${elementName}/@${attributeName}: url(${target})`)
    }
  }

  if (/^\s*(javascript|data|vbscript)\s*:/i.test(value)) {
    throw new DiagramSvgError('external-reference', `${elementName}/@${attributeName}: scheme`)
  }
}

function refuseUnsupportedElements(node: SvgNode, depth: number): void {
  if (node.kind === 'text') return
  if (!ELEMENT_GEOMETRY.has(node.name)) {
    throw new DiagramSvgError('unsupported-element', node.name)
  }
  if (node.name === METADATA_ELEMENT && depth !== 1) {
    throw new DiagramSvgError('unsupported-element', `${METADATA_ELEMENT} below the root`)
  }
  for (const child of node.children) refuseUnsupportedElements(child, depth + 1)
}

export interface DiagramSvgViewport {
  readonly width: number
  readonly height: number
  readonly viewBox: string
}

export interface ParsedDiagramSvg {
  readonly root: SvgElement
  readonly viewport: DiagramSvgViewport
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

function toLength(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const trimmed = raw.trim().replace(/px$/i, '')
  if (!NUMBER.test(trimmed)) return null
  const value = Number.parseFloat(trimmed)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function attributeOf(element: SvgElement, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value
}

function readViewport(root: SvgElement): DiagramSvgViewport {
  const viewBox = attributeOf(root, 'viewBox')?.trim()
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).filter(Boolean)
    if (parts.length === 4 && parts.every((part) => NUMBER.test(part))) {
      const width = Number.parseFloat(parts[2])
      const height = Number.parseFloat(parts[3])
      if (width > 0 && height > 0) return { width, height, viewBox }
    }
    throw new DiagramSvgError('missing-viewport', `viewBox="${viewBox}"`)
  }
  const width = toLength(attributeOf(root, 'width'))
  const height = toLength(attributeOf(root, 'height'))
  if (width === null || height === null) throw new DiagramSvgError('missing-viewport', 'no viewBox and no size')
  return { width, height, viewBox: `0 0 ${width} ${height}` }
}

export function parseDiagramSvg(input: string): ParsedDiagramSvg {
  const bytes = new TextEncoder().encode(input).byteLength
  if (bytes === 0) throw new DiagramSvgError('empty', 'no bytes')
  if (bytes > MAX_DIAGRAM_SVG_BYTES) {
    throw new DiagramSvgError('too-large', `${bytes} > ${MAX_DIAGRAM_SVG_BYTES}`)
  }

  const scanner = new Scanner(input)
  scanner.skipWhitespace()
  if (scanner.startsWith('<?xml')) {
    scanner.take(5)
    scanner.readUntil('?>', 'unterminated XML declaration')
    scanner.take(2)
  }
  skipTrivia(scanner)

  const root = parseElement(scanner, 1)
  if (root.name !== 'svg') throw new DiagramSvgError('not-svg', root.name)

  skipTrivia(scanner)
  if (!scanner.done) throw new DiagramSvgError('malformed-xml', 'trailing content after </svg>')

  refuseUnsupportedElements(root, 0)
  return { root, viewport: readViewport(root) }
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

function keptAttributes(element: SvgElement): readonly SvgAttribute[] {
  if (element.name === METADATA_ELEMENT) {
    const kind = diagramKindOf(element)
    return kind === undefined ? [] : [{ name: METADATA_KIND_ATTRIBUTE, value: kind }]
  }
  const geometry = ELEMENT_GEOMETRY.get(element.name)
  if (!geometry) return []
  const byName = new Map<string, SvgAttribute>()
  for (const attribute of element.attributes) {
    if (geometry.has(attribute.name) || COMMON_ATTRIBUTES.has(attribute.name)) {
      byName.set(attribute.name, attribute)
    }
  }
  return [...byName.values()]
}

function serializeNode(node: SvgNode, out: string[]): void {
  if (node.kind === 'text') {
    out.push(escapeText(node.text))
    return
  }
  const attributes = keptAttributes(node)
    .map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`)
    .join('')
  if (node.children.length === 0) {
    out.push(`<${node.name}${attributes}/>`)
    return
  }
  out.push(`<${node.name}${attributes}>`)
  for (const child of node.children) serializeNode(child, out)
  out.push(`</${node.name}>`)
}

export function serializeDiagramSvg(root: SvgElement): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>']
  serializeNode(withXmlns(root), out)
  return out.join('')
}

function withXmlns(root: SvgElement): SvgElement {
  if (attributeOf(root, 'xmlns')) return root
  return {
    ...root,
    attributes: [{ name: 'xmlns', value: 'http://www.w3.org/2000/svg' }, ...root.attributes],
  }
}

export function withDiagramSource(root: SvgElement, kind: DiagramSourceKind, source: string): SvgElement {
  const metadata: SvgElement = {
    kind: 'element',
    name: METADATA_ELEMENT,
    attributes: [{ name: METADATA_KIND_ATTRIBUTE, value: kind }],
    children: [{ kind: 'text', text: source }],
  }
  const rest = root.children.filter((child) => !(child.kind === 'element' && child.name === METADATA_ELEMENT))
  return { ...root, children: [metadata, ...rest] }
}

export interface DiagramMarking {
  readonly notice: string
  readonly provenance: string
}

export function withDiagramMarking(root: SvgElement, marking: DiagramMarking): SvgElement {
  const element = (name: string, text: string): SvgElement => ({
    kind: 'element',
    name,
    attributes: [],
    children: [{ kind: 'text', text }],
  })
  const rest = root.children.filter(
    (child) =>
      !(
        child.kind === 'element' &&
        (child.name === MARKING_TITLE_ELEMENT || child.name === MARKING_DESC_ELEMENT)
      ),
  )
  return {
    ...root,
    children: [
      element(MARKING_TITLE_ELEMENT, marking.notice),
      element(MARKING_DESC_ELEMENT, marking.provenance),
      ...rest,
    ],
  }
}

function diagramKindOf(metadata: SvgElement): string | undefined {
  return (
    attributeOf(metadata, METADATA_KIND_ATTRIBUTE) ??
    attributeOf(metadata, STORED_METADATA_KIND_ATTRIBUTE)
  )
}

export function diagramSourceOf(root: SvgElement): { kind: string; source: string } | null {
  for (const child of root.children) {
    if (child.kind !== 'element' || child.name !== METADATA_ELEMENT) continue
    const kind = diagramKindOf(child)
    if (!kind) continue
    const source = child.children.map((node) => (node.kind === 'text' ? node.text : '')).join('')
    return { kind, source }
  }
  return null
}

export interface DiagramSubmission {
  readonly svg: string
  readonly source: string
  readonly sourceKind: DiagramSourceKind
}

export interface AcceptedDiagram {
  readonly svg: string
  readonly root: SvgElement
  readonly viewport: DiagramSvgViewport
}

export function acceptDiagram(submission: DiagramSubmission, marking: DiagramMarking): AcceptedDiagram {
  const sourceBytes = new TextEncoder().encode(submission.source).byteLength
  const limit = DIAGRAM_SOURCE_FACTS[submission.sourceKind].maxSourceBytes
  if (sourceBytes > limit) {
    throw new DiagramSvgError('source-too-large', `${sourceBytes} > ${limit}`)
  }

  const { root, viewport } = parseDiagramSvg(submission.svg)
  const withSource = withDiagramSource(root, submission.sourceKind, submission.source)
  return {
    svg: serializeDiagramSvg(withDiagramMarking(withSource, marking)),
    root: withSource,
    viewport,
  }
}
