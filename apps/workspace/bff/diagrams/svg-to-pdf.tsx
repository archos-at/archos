import React from 'react'
import {
  Circle,
  ClipPath,
  Defs,
  Document,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Page,
  Path,
  Polygon,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
  Svg,
  Text,
  Tspan,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import { AI_GENERATOR_NAME, type AiProvenanceMarking } from '@/lib/ai-provenance'
import { withAiProvenanceXmp } from '@/lib/pdf/xmp-metadata'
import { attributeOf, type DiagramSvgViewport, type SvgElement, type SvgNode } from './svg'

type Presentation = Pick<
  React.ComponentProps<typeof Path>,
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'strokeDasharray'
  | 'strokeLinecap'
  | 'strokeLinejoin'
  | 'strokeOpacity'
  | 'fillOpacity'
  | 'fillRule'
  | 'opacity'
  | 'color'
  | 'visibility'
  | 'transform'
  | 'clipPath'
  | 'textAnchor'
  | 'dominantBaseline'
>

function oneOf<T extends string>(allowed: readonly T[], value: string | undefined): T | undefined {
  return allowed.find((member) => member === value)
}

const FILL_RULES = ['nonzero', 'evenodd'] as const
const LINECAPS = ['butt', 'round', 'square'] as const
const LINEJOINS = ['butt', 'round', 'square', 'miter', 'bevel'] as const
const TEXT_ANCHORS = ['start', 'middle', 'end'] as const
const BASELINES = [
  'auto',
  'middle',
  'central',
  'hanging',
  'mathematical',
  'text-after-edge',
  'text-before-edge',
] as const
const VISIBILITIES = ['visible', 'hidden', 'collapse'] as const

function dashArrayOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const lengths = raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => Number.parseFloat(part.replace(/px$/i, '')))
  if (lengths.length === 0) return undefined
  if (!lengths.every((length) => Number.isFinite(length) && length > 0)) return undefined
  return lengths.join(' ')
}

function presentationOf(element: SvgElement): Presentation {
  const at = (name: string) => attributeOf(element, name)
  return {
    fill: at('fill'),
    stroke: at('stroke'),
    strokeWidth: at('stroke-width'),
    strokeDasharray: dashArrayOf(at('stroke-dasharray')),
    strokeLinecap: oneOf(LINECAPS, at('stroke-linecap')),
    strokeLinejoin: oneOf(LINEJOINS, at('stroke-linejoin')),
    strokeOpacity: at('stroke-opacity'),
    fillOpacity: at('fill-opacity'),
    fillRule: oneOf(FILL_RULES, at('fill-rule')),
    opacity: at('opacity'),
    color: at('color'),
    visibility: oneOf(VISIBILITIES, at('visibility')),
    transform: at('transform'),
    clipPath: at('clip-path'),
    textAnchor: oneOf(TEXT_ANCHORS, at('text-anchor')),
    dominantBaseline: oneOf(BASELINES, at('dominant-baseline')),
  }
}

type FontStyle = React.ComponentProps<typeof G>['style']

function fontStyleOf(element: SvgElement): FontStyle {
  const weight = (attributeOf(element, 'font-weight') ?? '').toLowerCase()
  const slant = (attributeOf(element, 'font-style') ?? '').toLowerCase()
  const bold = weight === 'bold' || weight === 'bolder' || Number.parseInt(weight, 10) >= 600
  const italic = slant === 'italic' || slant === 'oblique'
  const family = bold
    ? italic
      ? 'Helvetica-BoldOblique'
      : 'Helvetica-Bold'
    : italic
      ? 'Helvetica-Oblique'
      : 'Helvetica'
  return { fontFamily: family, fontSize: fontSizeOf(element) }
}

function textOf(node: SvgNode): string {
  if (node.kind === 'text') return node.text
  return node.children.map(textOf).join('')
}

function numeric(element: SvgElement, name: string): number | undefined {
  const raw = attributeOf(element, name)
  if (raw === undefined) return undefined
  const value = Number.parseFloat(raw.replace(/px$/i, ''))
  return Number.isFinite(value) ? value : undefined
}

const SUPPORTED_PATH_COMMANDS = /^[MLCmlc0-9.,\s+-]*$/
const ARROW_LENGTH = 9
const ARROW_HALF_WIDTH = 4

interface Point {
  x: number
  y: number
}

function coordinatePairs(numbers: number[]): Point[] {
  const points: Point[] = []
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] })
  }
  return points
}

function edgePoints(element: SvgElement): Point[] | null {
  const numbersIn = (raw: string) => (raw.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number)
  if (element.name === 'path') {
    const d = attributeOf(element, 'd')
    if (!d || !SUPPORTED_PATH_COMMANDS.test(d)) return null
    return coordinatePairs(numbersIn(d))
  }
  if (element.name === 'line') {
    const values = ['x1', 'y1', 'x2', 'y2'].map((name) => numeric(element, name))
    if (values.some((value) => value === undefined)) return null
    return coordinatePairs(values as number[])
  }
  if (element.name === 'polyline') {
    const points = attributeOf(element, 'points')
    return points ? coordinatePairs(numbersIn(points)) : null
  }
  return null
}

function arrowheadFor(element: SvgElement, at: 'start' | 'end', key: number): React.ReactNode {
  if (!attributeOf(element, at === 'end' ? 'marker-end' : 'marker-start')) return null
  const points = edgePoints(element)
  if (!points || points.length < 2) return null

  const tip = at === 'end' ? points[points.length - 1] : points[0]
  const from = at === 'end' ? points[points.length - 2] : points[1]
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const length = Math.hypot(dx, dy)
  if (!Number.isFinite(length) || length < 0.01) return null

  const ux = dx / length
  const uy = dy / length
  const baseX = tip.x - ux * ARROW_LENGTH
  const baseY = tip.y - uy * ARROW_LENGTH
  const points2 = [
    `${tip.x},${tip.y}`,
    `${baseX - uy * ARROW_HALF_WIDTH},${baseY + ux * ARROW_HALF_WIDTH}`,
    `${baseX + uy * ARROW_HALF_WIDTH},${baseY - ux * ARROW_HALF_WIDTH}`,
  ].join(' ')

  return (
    <Polygon
      key={`${key}-${at}`}
      points={points2}
      fill={attributeOf(element, 'stroke') ?? '#000'}
    />
  )
}

const DEFAULT_FONT_SIZE = 16

function fontSizeOf(element: SvgElement): number | undefined {
  const size = numeric(element, 'font-size')
  return size !== undefined && size > 0 ? size : undefined
}

function lengthOf(raw: string | undefined, fontSize: number): number | undefined {
  const first = raw?.trim().split(/[\s,]+/)[0]
  if (!first) return undefined
  const value = Number.parseFloat(first)
  if (!Number.isFinite(value)) return undefined
  return /em$/i.test(first) ? value * fontSize : value
}

export function textOrigin(element: SvgElement, fontSize: number): { x: number; y: number } {
  const at = (name: string) => lengthOf(attributeOf(element, name), fontSize) ?? 0
  return { x: at('x') + at('dx'), y: at('y') + at('dy') }
}

export function tspanPositions(
  tspans: SvgElement[],
  start: { x: number; y: number },
  inheritedSize: number
): { x: number; y: number }[] {
  let x = start.x
  let y = start.y
  return tspans.map((tspan) => {
    const size = fontSizeOf(tspan) ?? inheritedSize
    x =
      (lengthOf(attributeOf(tspan, 'x'), size) ?? x) +
      (lengthOf(attributeOf(tspan, 'dx'), size) ?? 0)
    y =
      (lengthOf(attributeOf(tspan, 'y'), size) ?? y) +
      (lengthOf(attributeOf(tspan, 'dy'), size) ?? 0)
    return { x, y }
  })
}

function placedTspans(
  tspans: SvgElement[],
  start: { x: number; y: number },
  inheritedSize: number
): React.ReactNode[] {
  const positions = tspanPositions(tspans, start, inheritedSize)
  return tspans.flatMap((tspan, index) => {
    const text = textOf(tspan)
    if (text === '') return []
    return [
      <Tspan key={index} x={positions[index].x} y={positions[index].y} {...presentationOf(tspan)}>
        {text}
      </Tspan>,
    ]
  })
}

function toPdfNode(node: SvgNode, key: number): React.ReactNode {
  if (node.kind === 'text') return null
  const element = node
  const style = presentationOf(element)
  const children = element.children.map((child, index) => toPdfNode(child, index))

  switch (element.name) {
    case 'g':
      return (
        <G key={key} {...style}>
          {children}
        </G>
      )
    case 'defs':
      return <Defs key={key}>{children}</Defs>
    case 'clipPath':
      return (
        <ClipPath key={key} id={attributeOf(element, 'id')}>
          {children}
        </ClipPath>
      )
    case 'marker':
      return null
    case 'linearGradient': {
      const id = attributeOf(element, 'id')
      if (!id) return null
      return (
        <LinearGradient
          key={key}
          id={id}
          x1={attributeOf(element, 'x1')}
          y1={attributeOf(element, 'y1')}
          x2={attributeOf(element, 'x2')}
          y2={attributeOf(element, 'y2')}
          gradientTransform={attributeOf(element, 'gradientTransform')}
          gradientUnits={oneOf(
            ['userSpaceOnUse', 'objectBoundingBox'] as const,
            attributeOf(element, 'gradientUnits')
          )}
        >
          {children}
        </LinearGradient>
      )
    }
    case 'radialGradient': {
      const id = attributeOf(element, 'id')
      if (!id) return null
      return (
        <RadialGradient
          key={key}
          id={id}
          cx={attributeOf(element, 'cx')}
          cy={attributeOf(element, 'cy')}
          r={attributeOf(element, 'r')}
          fx={attributeOf(element, 'fx')}
          fy={attributeOf(element, 'fy')}
          gradientTransform={attributeOf(element, 'gradientTransform')}
          gradientUnits={oneOf(
            ['userSpaceOnUse', 'objectBoundingBox'] as const,
            attributeOf(element, 'gradientUnits')
          )}
        >
          {children}
        </RadialGradient>
      )
    }
    case 'stop': {
      const offset = attributeOf(element, 'offset')
      const stopColor = attributeOf(element, 'stop-color')
      if (offset === undefined || stopColor === undefined) return null
      return (
        <Stop
          key={key}
          offset={offset}
          stopColor={stopColor}
          stopOpacity={attributeOf(element, 'stop-opacity')}
        />
      )
    }
    case 'path': {
      const d = attributeOf(element, 'd')
      return d ? withArrowheads(element, key, <Path key={key} {...style} d={d} />) : null
    }
    case 'rect': {
      const width = attributeOf(element, 'width')
      const height = attributeOf(element, 'height')
      if (width === undefined || height === undefined) return null
      return (
        <Rect
          key={key}
          {...style}
          x={attributeOf(element, 'x')}
          y={attributeOf(element, 'y')}
          width={width}
          height={height}
          rx={attributeOf(element, 'rx')}
          ry={attributeOf(element, 'ry')}
        />
      )
    }
    case 'circle': {
      const r = attributeOf(element, 'r')
      if (r === undefined) return null
      return (
        <Circle
          key={key}
          {...style}
          cx={attributeOf(element, 'cx')}
          cy={attributeOf(element, 'cy')}
          r={r}
        />
      )
    }
    case 'ellipse': {
      const rx = attributeOf(element, 'rx')
      const ry = attributeOf(element, 'ry')
      if (rx === undefined || ry === undefined) return null
      return (
        <Ellipse
          key={key}
          {...style}
          cx={attributeOf(element, 'cx')}
          cy={attributeOf(element, 'cy')}
          rx={rx}
          ry={ry}
        />
      )
    }
    case 'line': {
      const x1 = attributeOf(element, 'x1')
      const y1 = attributeOf(element, 'y1')
      const x2 = attributeOf(element, 'x2')
      const y2 = attributeOf(element, 'y2')
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null
      return withArrowheads(
        element,
        key,
        <Line key={key} {...style} x1={x1} y1={y1} x2={x2} y2={y2} />
      )
    }
    case 'polyline': {
      const points = attributeOf(element, 'points')
      return points
        ? withArrowheads(element, key, <Polyline key={key} {...style} points={points} />)
        : null
    }
    case 'polygon': {
      const points = attributeOf(element, 'points')
      return points ? <Polygon key={key} {...style} points={points} /> : null
    }
    case 'text': {
      const fontSize = fontSizeOf(element) ?? DEFAULT_FONT_SIZE
      const { x, y } = textOrigin(element, fontSize)
      const nested = element.children.filter(
        (child): child is SvgElement => child.kind === 'element' && child.name === 'tspan'
      )
      return (
        <G key={key} style={fontStyleOf(element)}>
          <Text {...style} x={x} y={y}>
            {nested.length > 0 ? placedTspans(nested, { x, y }, fontSize) : textOf(element)}
          </Text>
        </G>
      )
    }
    case 'tspan':
      return null
    default:
      return null
  }
}

function withArrowheads(element: SvgElement, key: number, edge: React.ReactNode): React.ReactNode {
  const start = arrowheadFor(element, 'start', key)
  const end = arrowheadFor(element, 'end', key)
  if (!start && !end) return edge
  return (
    <React.Fragment key={key}>
      {edge}
      {start}
      {end}
    </React.Fragment>
  )
}

const A4_SHORT = 595.28
const A4_LONG = 841.89
const MARGIN = 36
const HEADER_HEIGHT = 54
const FOOTER_HEIGHT = 28

export interface DiagramPdfInput {
  readonly root: SvgElement
  readonly viewport: DiagramSvgViewport
  readonly title: string
  readonly projectName: string
  readonly marking: string
  readonly provenance: AiProvenanceMarking
  readonly createdAt: Date
}

export async function renderDiagramPdf(input: DiagramPdfInput): Promise<Uint8Array> {
  const landscape = input.viewport.width > input.viewport.height
  const pageWidth = landscape ? A4_LONG : A4_SHORT
  const pageHeight = landscape ? A4_SHORT : A4_LONG
  const boxWidth = pageWidth - MARGIN * 2
  const boxHeight = pageHeight - MARGIN * 2 - HEADER_HEIGHT - FOOTER_HEIGHT

  const scale = Math.min(boxWidth / input.viewport.width, boxHeight / input.viewport.height)
  const drawnWidth = input.viewport.width * scale
  const drawnHeight = input.viewport.height * scale

  const created = input.createdAt.toISOString().slice(0, 10)

  const document = (
    <Document
      title={input.title}
      author={input.projectName}
      keywords={input.provenance}
      subject={input.marking}
      creator={AI_GENERATOR_NAME}
      producer={AI_GENERATOR_NAME}
    >
      <Page
        size={landscape ? { width: pageWidth, height: pageHeight } : 'A4'}
        style={{ padding: MARGIN }}
      >
        <View style={{ height: HEADER_HEIGHT }}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 14 }}>{input.title}</Text>
          <Text style={{ fontFamily: 'Helvetica', fontSize: 9, color: '#4b5563', marginTop: 4 }}>
            {input.projectName} · {created}
          </Text>
        </View>
        <View style={{ height: boxHeight, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={drawnWidth} height={drawnHeight} viewBox={input.viewport.viewBox}>
            {input.root.children.map((child, index) => toPdfNode(child, index))}
          </Svg>
        </View>
        {/*
          The marking is the artifact, not the chrome. The grey byline in the
          Files pane stays in the app; this line is what reaches the Behörde,
          which is where liability starts — the same argument the `.docx`
          export makes for its first-page block.
        */}
        <View style={{ height: FOOTER_HEIGHT, justifyContent: 'flex-end' }}>
          <Text style={{ fontFamily: 'Helvetica', fontSize: 8, color: '#6b7280' }}>
            {input.marking}
          </Text>
        </View>
      </Page>
    </Document>
  )

  return withAiProvenanceXmp(new Uint8Array(await renderToBuffer(document)), input.provenance)
}
