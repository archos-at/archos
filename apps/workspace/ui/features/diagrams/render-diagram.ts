import {
  DIAGRAM_SOURCE_KINDS,
  type DiagramSourceKind,
} from '@/lib/diagrams/diagram-sources'
import { parseDiagramSvg, serializeDiagramSvg } from '@/lib/diagrams/svg'
import { diagramThemeVariables } from './diagram-palette'

export type DiagramTheme = 'light' | 'dark'

export interface DiagramRenderRequest {
  source: string
  id: string
  theme: DiagramTheme
}

export type DiagramRenderer = (request: DiagramRenderRequest) => Promise<string>

const FLATTENED_PROPERTIES = [
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
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
] as const

const NONE_IS_MEANINGFUL: ReadonlySet<string> = new Set(['fill', 'stroke'])

const UNFILEABLE_ELEMENTS = ['style', 'filter', 'use', 'symbol'] as const

function normalizeColor(value: string): { color: string; alpha: number | null } | null {
  const match = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/i)
  if (!match) return null
  const channel = (raw: string) => Math.max(0, Math.min(255, Math.round(Number.parseFloat(raw))))
  const hex = `#${[match[1], match[2], match[3]]
    .map((raw) => channel(raw).toString(16).padStart(2, '0'))
    .join('')}`
  if (match[4] === undefined) return { color: hex, alpha: null }
  const raw = match[4].endsWith('%')
    ? Number.parseFloat(match[4]) / 100
    : Number.parseFloat(match[4])
  return { color: hex, alpha: Number.isFinite(raw) && raw < 1 ? raw : null }
}

export function flattenComputedStyles(root: SVGElement): void {
  for (const name of UNFILEABLE_ELEMENTS) {
    if (name === 'style') continue
    for (const element of Array.from(root.querySelectorAll(name))) element.remove()
  }

  const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))]

  const resolved = new Map<Element, Map<string, string>>()
  for (const element of elements) {
    const computed = window.getComputedStyle(element)
    const values = new Map<string, string>()
    for (const property of FLATTENED_PROPERTIES) {
      const raw = computed.getPropertyValue(property).trim()
      if (!raw) continue
      if (raw === 'none' && !NONE_IS_MEANINGFUL.has(property)) continue
      values.set(property, raw)
    }
    resolved.set(element, values)
  }

  for (const element of elements) {
    for (const [property, raw] of resolved.get(element) ?? []) {
      if (property === 'fill' || property === 'stroke') {
        const normalized = normalizeColor(raw)
        if (normalized) {
          element.setAttribute(property, normalized.color)
          if (normalized.alpha !== null) {
            element.setAttribute(`${property}-opacity`, String(normalized.alpha))
          }
          continue
        }
      }
      element.setAttribute(property, raw)
    }
    element.removeAttribute('style')
    element.removeAttribute('class')
  }

  for (const style of Array.from(root.querySelectorAll('style'))) style.remove()
}

const CHART_WIDTH = 360

const renderMermaidNow: DiagramRenderer = async ({ source, id, theme }) => {
  const mermaid = (await import('mermaid')).default
  const variables = diagramThemeVariables(theme)

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    ...(variables
      ? { theme: 'base' as const, themeVariables: variables }
      : { theme: theme === 'dark' ? ('dark' as const) : ('default' as const) }),
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
    fontFamily: 'Helvetica, Arial, sans-serif',
    quadrantChart: { chartWidth: CHART_WIDTH, chartHeight: CHART_WIDTH },
    xyChart: { width: CHART_WIDTH, height: Math.round(CHART_WIDTH * 0.8) },
    suppressErrorRendering: true,
  })

  const { svg } = await mermaid.render(id, source)

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:2000px;pointer-events:none'
  host.innerHTML = svg
  document.body.appendChild(host)
  try {
    const element = host.querySelector('svg')
    if (!element) throw new Error('mermaid returned no <svg> element')
    flattenComputedStyles(element)
    const serialized = new XMLSerializer().serializeToString(element)
    return serializeDiagramSvg(parseDiagramSvg(serialized).root)
  } finally {
    host.remove()
  }
}

export function serialized<A, R>(task: (argument: A) => Promise<R>): (argument: A) => Promise<R> {
  let queue: Promise<unknown> = Promise.resolve()
  return (argument) => {
    const run = queue.then(() => task(argument))
    queue = run.catch(() => undefined)
    return run
  }
}

export const MERMAID_TASK_TIMEOUT_MS = 15_000

function withinTimeout<T>(task: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('mermaid did not finish in time')), MERMAID_TASK_TIMEOUT_MS)
  })
  return Promise.race([task(), timeout]).finally(() => clearTimeout(timer))
}

export const withMermaid: <T>(task: () => Promise<T>) => Promise<T> = serialized(
  (task: () => Promise<unknown>) => withinTimeout(task)
) as <T>(task: () => Promise<T>) => Promise<T>

const renderMermaid: DiagramRenderer = (request) => withMermaid(() => renderMermaidNow(request))

export const DIAGRAM_RENDERERS: Readonly<Record<DiagramSourceKind, DiagramRenderer | null>> = {
  mermaid: renderMermaid,
  excalidraw: null,
}

export function diagramRendererFor(kind: DiagramSourceKind): DiagramRenderer | null {
  return DIAGRAM_RENDERERS[kind]
}

export const RENDERABLE_DIAGRAM_KINDS: readonly DiagramSourceKind[] = DIAGRAM_SOURCE_KINDS.filter(
  (kind) => DIAGRAM_RENDERERS[kind] !== null,
)
