export const DIAGRAM_SOURCE_KINDS = ['mermaid', 'excalidraw'] as const
export type DiagramSourceKind = (typeof DIAGRAM_SOURCE_KINDS)[number]

export interface DiagramSourceFacts {
  readonly contentType: string
  readonly extension: string
  readonly maxSourceBytes: number
}

export const DIAGRAM_SOURCE_FACTS = {
  mermaid: {
    contentType: 'text/vnd.mermaid',
    extension: 'mmd',
    maxSourceBytes: 32 * 1024,
  },
  excalidraw: {
    contentType: 'application/json',
    extension: 'excalidraw',
    maxSourceBytes: 512 * 1024,
  },
} as const satisfies Record<DiagramSourceKind, DiagramSourceFacts>

export function isDiagramSourceKind(value: unknown): value is DiagramSourceKind {
  return typeof value === 'string' && (DIAGRAM_SOURCE_KINDS as readonly string[]).includes(value)
}

export const MAX_DIAGRAM_SVG_BYTES = 1024 * 1024

export const MAX_DIAGRAM_SOURCE_BYTES = Math.max(
  ...DIAGRAM_SOURCE_KINDS.map((kind) => DIAGRAM_SOURCE_FACTS[kind].maxSourceBytes),
)

export const MAX_DIAGRAM_SVG_DEPTH = 64
