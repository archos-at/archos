import { parseDiagramSvg, serializeDiagramSvg } from '@/lib/diagrams/svg'

const SKETCH_EFFECTS = ['style', 'mask'] as const

export function fileableSketchSvg(svg: SVGSVGElement): string {
  const root = svg.cloneNode(true) as SVGSVGElement
  for (const name of SKETCH_EFFECTS) {
    for (const element of Array.from(root.querySelectorAll(name))) element.remove()
  }
  for (const element of Array.from(root.querySelectorAll('[mask]'))) element.removeAttribute('mask')
  const serialized = new XMLSerializer().serializeToString(root)
  return serializeDiagramSvg(parseDiagramSvg(serialized).root)
}
