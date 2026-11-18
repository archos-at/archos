'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useTranslations } from '@/i18n'
import { diagramsCopy } from '@/i18n/namespaces/diagrams'
import {
  readSketchFence,
  streamedSketchElements,
  type SceneSkeleton,
} from '@/lib/diagrams/sketch-fence'
import { viewBoxWidth } from '../diagram-size'
import { useDiagramFiling } from '../use-diagram-filing'
import type { RenderedSketch } from '../sketch/sketch-render'
import { SketchDialog } from '../sketch/sketch-dialog'
import { CAPTION_CONTROL, DiagramFilingControls } from './diagram-filing-controls'
import { DrawingCaption, DrawingReveal, DrawingSkeleton } from './drawing-skeleton'

export interface SketchFigureProps {
  source: string
  isStreaming?: boolean
  refused?: boolean
}

function useRenderedSketch(elements: readonly SceneSkeleton[] | null) {
  const [rendered, setRendered] = useState<RenderedSketch | null>(null)
  const [failed, setFailed] = useState(false)
  const key = useMemo(() => (elements && elements.length ? JSON.stringify(elements) : null), [elements])
  const running = useRef(false)
  const waiting = useRef<readonly SceneSkeleton[] | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!key || !elements) return
    waiting.current = elements
    if (running.current) return
    running.current = true
    void (async () => {
      try {
        const { renderSketch } = await import('../sketch/sketch-render')
        while (waiting.current && alive.current) {
          const next = waiting.current
          waiting.current = null
          const result = await renderSketch(next)
          if (alive.current) setRendered(result)
        }
      } catch (error) {
        console.debug('[diagrams] sketch render failed', error)
        if (alive.current) setFailed(true)
      } finally {
        running.current = false
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { rendered, failed }
}

export function SketchFigure({ source, isStreaming = false, refused = false }: SketchFigureProps) {
  const t = useTranslations(diagramsCopy)
  const fence = useMemo(() => (isStreaming || refused ? null : readSketchFence(source)), [source, isStreaming, refused])
  const streamed = useMemo(() => (isStreaming ? streamedSketchElements(source) : null), [source, isStreaming])
  const elements = fence?.ok ? fence.elements : streamed
  const { rendered, failed } = useRenderedSketch(elements)
  const title = fence?.ok ? fence.title : null

  const renderedRef = useRef(rendered)
  renderedRef.current = rendered
  const filing = useDiagramFiling({
    source,
    fileSvg: null,
    title,
    edited: false,
    prepareSketch: async () => {
      const current = renderedRef.current
      if (!current) throw new Error('the sketch is not drawn yet')
      return { source: current.scene, svg: current.svg }
    },
  })
  const [editing, setEditing] = useState(false)

  if (refused || (fence && !fence.ok) || failed) {
    return (
      <div
        data-testid="sketch-figure"
        data-state="refused"
        className="bg-muted/40 text-muted-foreground my-4 rounded-xl px-4 py-3 text-sm"
        role="note"
      >
        {t('sketch.fallback')}
      </div>
    )
  }

  const drawn = Boolean(rendered) && !isStreaming
  const label = title ?? t('sketch.defaultTitle')
  return (
    <figure
      className="@container my-4"
      data-testid="sketch-figure"
      data-state={isStreaming ? 'streaming' : drawn ? 'drawn' : 'drawing'}
      aria-busy={drawn ? undefined : true}
      aria-label={label}
    >
      <div className="border-border rounded-xl border bg-white p-2 dark:[filter:invert(93%)_hue-rotate(180deg)] [&_svg]:h-auto [&_svg]:w-full">
        <DrawingReveal drawn={Boolean(rendered)}>
          {rendered ? (
            <div
              style={{ width: `${viewBoxWidth(rendered.svg) ?? 720}px`, maxWidth: '100%' }}
              dangerouslySetInnerHTML={{ __html: rendered.svg }}
            />
          ) : (
            <DrawingSkeleton />
          )}
        </DrawingReveal>
      </div>
      <AnimatePresence initial={false}>
        {drawn ? (
          <DrawingCaption
            key="caption"
            className="text-muted-foreground flex flex-wrap items-center gap-x-3 pt-1 text-xs"
          >
            {/* The doctrine, where the reader is: a sketch claims no dimension. */}
            <span>{t('sketch.notToScale')}</span>
            <DiagramFilingControls filing={filing} />
            {filing.target ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={CAPTION_CONTROL}
                data-testid="sketch-edit"
              >
                {t('sketch.action')}
              </button>
            ) : null}
          </DrawingCaption>
        ) : null}
      </AnimatePresence>
      {editing && fence?.ok ? (
        <SketchDialog
          open={editing}
          onOpenChange={setEditing}
          source={source}
          elements={fence.elements}
          title={fence.title}
        />
      ) : null}
    </figure>
  )
}
