'use client'

import dynamic from 'next/dynamic'
import { DrawingSkeleton } from '@/features/diagrams/components/drawing-skeleton'
import { sketchFenceKind } from '@/lib/diagrams/sketch-fence'
import { isMermaidFence } from './utils'

const MermaidDiagram = dynamic(
  () =>
    import('@/features/diagrams/components/mermaid-diagram').then(
      (module) => module.MermaidDiagram
    ),
  { ssr: false, loading: () => <DiagramPlace /> }
)

const SketchFigure = dynamic(
  () => import('@/features/diagrams/components/sketch-figure').then((module) => module.SketchFigure),
  { ssr: false, loading: () => <DiagramPlace /> }
)

function DiagramPlace() {
  return (
    <figure data-testid="mermaid-place" className="my-4" aria-busy="true">
      <div className="bg-muted/40 rounded-surface p-3">
        <DrawingSkeleton />
      </div>
    </figure>
  )
}

export type DiagramFenceKind = 'mermaid' | 'sketch' | 'refused-sketch'

export function diagramFenceKind(className: string | undefined, source: string): DiagramFenceKind | null {
  const sketch = sketchFenceKind(className)
  if (sketch) return sketch === 'refused' ? 'refused-sketch' : 'sketch'
  return isMermaidFence(className, source) ? 'mermaid' : null
}

export function DiagramFence({
  kind,
  source,
  isStreaming,
}: {
  kind: DiagramFenceKind
  source: string
  isStreaming: boolean
}) {
  if (kind === 'mermaid') return <MermaidDiagram source={source} isStreaming={isStreaming} />
  return <SketchFigure source={source} isStreaming={isStreaming} refused={kind === 'refused-sketch'} />
}
