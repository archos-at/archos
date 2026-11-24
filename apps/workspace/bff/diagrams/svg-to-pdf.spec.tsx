// @disk-inputs: bff/diagrams/__fixtures__/excalidraw-sketch.svg, bff/diagrams/__fixtures__/mermaid-flowchart.svg, bff/diagrams/__fixtures__/mermaid-gantt.svg, bff/diagrams/__fixtures__/mermaid-mindmap.svg, bff/diagrams/__fixtures__/mermaid-pie.svg, bff/diagrams/__fixtures__/mermaid-sequence.svg, bff/diagrams/__fixtures__/mermaid-state.svg
/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { MAX_DIAGRAM_SVG_DEPTH } from './diagram-sources'
import { IPTC_TRAINED_ALGORITHMIC_MEDIA, aiProvenanceMarking } from '@/lib/ai-provenance'
import { readPdf } from '@/test-utils/read-pdf'
import { PRODUCT_NAME } from '@/lib/brand'
import { acceptDiagram, type SvgElement } from './svg'
import { renderDiagramPdf, textOrigin, tspanPositions } from './svg-to-pdf'

const PROVENANCE = aiProvenanceMarking({})
const MARKING = {
  notice: `Von ${PRODUCT_NAME} erstellt — KI-generiert, nicht geprüft.`,
  provenance: PROVENANCE,
}

function contentStreams(pdf: Uint8Array): string[] {
  const raw = Buffer.from(pdf).toString('latin1')
  const streams: string[] = []
  const marker = /stream\r?\n/g
  let match: RegExpExecArray | null
  while ((match = marker.exec(raw))) {
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end === -1) continue
    try {
      streams.push(inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'))
    } catch {
      // Not every stream is Flate (embedded font subsets are not), and a stream
    }
  }
  return streams
}

function drawing(svgBody: string, viewBox = '0 0 200 100') {
  return acceptDiagram(
    {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${svgBody}</svg>`,
      sourceKind: 'mermaid',
      source: 'graph TD\n  A --> B',
    },
    MARKING
  )
}

async function pdfFor(svgBody: string, viewBox?: string) {
  const accepted = drawing(svgBody, viewBox)
  return renderDiagramPdf({
    root: accepted.root,
    viewport: accepted.viewport,
    title: 'Ablauf Einreichung',
    projectName: 'Straßenhäuser',
    marking: `Von ${PRODUCT_NAME} erstellt — KI-generiert, nicht geprüft.`,
    provenance: PROVENANCE,
    createdAt: new Date('2026-08-20T00:00:00Z'),
  })
}

describe('a diagram becomes a PDF, without a browser', () => {
  it('produces a real PDF', async () => {
    const pdf = await pdfFor(
      '<rect x="10" y="10" width="80" height="40" fill="#eef" stroke="#333"/>'
    )
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
  })

  it('is marked trainedAlgorithmicMedia in XMP, beside the Info dictionary', async () => {
    const pdf = await readPdf(await pdfFor('<rect x="10" y="10" width="80" height="40"/>'))
    expect(pdf.xmp['iptc4xmpext:digitalsourcetype']).toBe(IPTC_TRAINED_ALGORITHMIC_MEDIA)
    expect(pdf.info.Keywords).toBe(PROVENANCE)
  })

  it('draws the geometry as vector operators, not as a raster', async () => {
    const pdf = await pdfFor(
      '<rect x="10" y="10" width="80" height="40" fill="#eef" stroke="#333"/>'
    )
    const streams = contentStreams(pdf).join('\n')
    expect(streams).toContain('10 10 m')
    expect(streams).toContain('90 50 l')
    expect(streams).toMatch(/\bB\b/)
    expect(streams).not.toContain('/Image')
  })

  it('draws a path as curves and lines', async () => {
    const pdf = await pdfFor(
      '<path d="M 10 10 L 90 10 C 95 10 95 40 90 40" stroke="#080" fill="none"/>'
    )
    const streams = contentStreams(pdf).join('\n')
    expect(streams).toMatch(/\bm\b[\s\S]*\bl\b/)
    expect(streams).toMatch(/\bc\b/)
  })

  it('prints text at the size the diagram asked for', async () => {
    const pdf = await pdfFor('<text x="10" y="30" font-size="19" fill="#000">Bescheid</text>')
    expect(contentStreams(pdf).join('\n')).toMatch(/\/F\d+ 19 Tf/)
  })

  it('never asks for a font it cannot have', async () => {
    const pdf = await pdfFor(
      '<text x="10" y="30" font-family="trebuchet ms, verdana" font-weight="bold">Fett</text>'
    )
    expect(Buffer.from(pdf).toString('latin1')).toContain('Helvetica-Bold')
  })

  it('turns the page to follow the drawing', async () => {
    const wide = Buffer.from(
      await pdfFor('<rect width="10" height="10"/>', '0 0 400 100')
    ).toString('latin1')
    const tall = Buffer.from(
      await pdfFor('<rect width="10" height="10"/>', '0 0 100 400')
    ).toString('latin1')
    expect(wide).toMatch(/MediaBox \[0 0 841\.89\d* 595\.28\d*\]/)
    expect(tall).toMatch(/MediaBox \[0 0 595\.28\d* 841\.89\d*\]/)
  })

  it('carries the provenance line as text on the page', async () => {
    const pdf = await pdfFor('<rect width="10" height="10"/>')
    const streams = contentStreams(pdf).join('\n')
    expect(streams.match(/\bTf\b/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('does not print the diagram source across the page', async () => {
    const accepted = drawing('<rect width="10" height="10"/>')
    const pdf = await renderDiagramPdf({
      root: accepted.root,
      viewport: accepted.viewport,
      title: 'Ablauf',
      projectName: 'P',
      marking: 'm',
      provenance: PROVENANCE,
      createdAt: new Date('2026-08-20T00:00:00Z'),
    })
    expect(Buffer.from(pdf).toString('latin1')).not.toContain('graph TD')
  })
})

describe('the depth the validator admits is a depth this renderer survives', () => {
  it('renders a diagram nested exactly as deep as the parser allows', async () => {
    const groups = MAX_DIAGRAM_SVG_DEPTH - 2
    const pdf = await pdfFor(
      `${'<g>'.repeat(groups)}<rect x="10" y="10" width="80" height="40" fill="#eef"/>${'</g>'.repeat(groups)}`
    )
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
    expect(contentStreams(pdf).join('\n')).toContain('10 10 m')
  })
})

const REAL_MERMAID = readFileSync(join(__dirname, '__fixtures__/mermaid-flowchart.svg'), 'utf8')

describe('real mermaid output', () => {
  const accepted = () =>
    acceptDiagram(
      { svg: REAL_MERMAID, sourceKind: 'mermaid', source: 'graph TD\n  A --> B' },
      MARKING
    )

  it('is accepted by the validator that produced it', () => {
    expect(() => accepted()).not.toThrow()
  })

  it('carries paint, not just geometry', () => {
    expect(REAL_MERMAID.toLowerCase()).toContain('fill="#ececff"')
    expect(REAL_MERMAID).not.toContain('<style')
    expect(REAL_MERMAID).not.toContain('foreignObject')
  })

  it('draws an arrowhead on a directed edge, and none on an undirected one', async () => {
    const fills = (pdf: Uint8Array) => contentStreams(pdf).join('\n').match(/\bf\b/g)?.length ?? 0
    const directed = await pdfFor(
      '<path d="M 10 10 L 10 90" stroke="#000" fill="none" marker-end="url(#a)"/>'
    )
    const plain = await pdfFor('<path d="M 10 10 L 10 90" stroke="#000" fill="none"/>')
    expect(fills(plain)).toBe(0)
    expect(fills(directed)).toBe(1)
  })

  it('refuses to guess a direction it cannot compute', async () => {
    const arc = await pdfFor(
      '<path d="M 10 10 A 20 20 0 0 1 60 60" stroke="#000" fill="none" marker-end="url(#a)"/>'
    )
    expect(contentStreams(arc).join('\n').match(/\bf\b/g)?.length ?? 0).toBe(0)
  })

  it('becomes a PDF with the node labels in it', async () => {
    const diagram = accepted()
    const pdf = await renderDiagramPdf({
      root: diagram.root,
      viewport: diagram.viewport,
      title: 'Ablauf Einreichung',
      projectName: 'Straßenhäuser',
      marking: `Von ${PRODUCT_NAME} erstellt — KI-generiert, nicht geprüft.`,
      provenance: PROVENANCE,
      createdAt: new Date('2026-08-20T00:00:00Z'),
    })
    const streams = contentStreams(pdf).join('\n')
    expect(streams.match(/\bm\b/g)?.length ?? 0).toBeGreaterThanOrEqual(20)
    expect(streams.match(/\bTJ\b/g)?.length ?? 0).toBeGreaterThanOrEqual(10)
    expect(pdf.byteLength).toBeGreaterThan(3000)
  })
})

const TAUGHT_GRAMMARS: { grammar: string; minLabels: number }[] = [
  { grammar: 'sequence', minLabels: 10 },
  { grammar: 'state', minLabels: 5 },
  { grammar: 'gantt', minLabels: 8 },
  { grammar: 'mindmap', minLabels: 6 },
  { grammar: 'pie', minLabels: 6 },
]

describe.each(TAUGHT_GRAMMARS)('real mermaid $grammar', ({ grammar, minLabels }) => {
  const svg = readFileSync(join(__dirname, `__fixtures__/mermaid-${grammar}.svg`), 'utf8')

  it('is accepted by the validator and becomes a PDF whose labels print', async () => {
    const diagram = acceptDiagram({ svg, sourceKind: 'mermaid', source: grammar }, MARKING)
    const pdf = await renderDiagramPdf({
      root: diagram.root,
      viewport: diagram.viewport,
      title: grammar,
      projectName: 'Straßenhäuser',
      marking: MARKING.notice,
      provenance: PROVENANCE,
      createdAt: new Date('2026-09-24T00:00:00Z'),
    })
    const streams = contentStreams(pdf).join('\n')
    expect(streams.match(/\bTJ\b/g)?.length ?? 0).toBeGreaterThanOrEqual(minLabels)
    expect(streams.match(/\bm\b/g)?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('real Excalidraw sketch', () => {
  const svg = readFileSync(join(__dirname, '__fixtures__/excalidraw-sketch.svg'), 'utf8')

  it('is accepted by the validator and becomes a PDF whose labels print', async () => {
    const diagram = acceptDiagram({ svg, sourceKind: 'excalidraw', source: '{"type":"excalidraw"}' }, MARKING)
    const pdf = await renderDiagramPdf({
      root: diagram.root,
      viewport: diagram.viewport,
      title: 'Skizze',
      projectName: 'Straßenhäuser',
      marking: MARKING.notice,
      provenance: PROVENANCE,
      createdAt: new Date('2026-10-27T00:00:00Z'),
    })
    const streams = contentStreams(pdf).join('\n')
    expect(streams.match(/\bTJ\b/g)?.length ?? 0).toBeGreaterThanOrEqual(8)
    expect(streams.match(/\bc\b/g)?.length ?? 0).toBeGreaterThan(50)
  })
})

describe('where a label prints', () => {
  const element = (name: string, attributes: Record<string, string>): SvgElement => ({
    kind: 'element',
    name,
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    children: [],
  })

  it('shifts a text by dy, in em of its own font size', () => {
    expect(textOrigin(element('text', { y: '3', dy: '1em' }), 10)).toEqual({ x: 0, y: 13 })
  })

  it('keeps a tspan without y on its text line', () => {
    expect(tspanPositions([element('tspan', { x: '10' })], { x: 10, y: 86 }, 11)).toEqual([
      { x: 10, y: 86 },
    ])
  })

  it('resolves a tspan y in em, then its dy, and stacks the next line from there', () => {
    const lines = [
      element('tspan', { x: '0', y: '-0.1em', dy: '1.1em' }),
      element('tspan', { x: '0', dy: '1.1em' }),
    ]
    const [first, second] = tspanPositions(lines, { x: 0, y: -10.1 }, 10)
    expect(first.y).toBeCloseTo(10)
    expect(second.y).toBeCloseTo(21)
  })
})
