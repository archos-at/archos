'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { motionBase, motionInstant, useMotionToken } from '@/components/motion'
import { useHeightGlide } from '@/components/motion/height-glide'
import { HorizontalScroll } from '@/components/ui/horizontal-scroll'
import { CodeBlock } from '@/shared/components/CodeBlock'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { diagramsCopy } from '@/i18n/namespaces/diagrams'
import { diagramFrameStyle } from '../diagram-size'
import { renderPaperDiagram, useRenderedDiagram } from '../use-rendered-diagram'
import { useDiagramModel } from '../use-diagram-model'
import { DiagramView } from '../views/diagram-views'
import { titleFromSource, useDiagramFiling } from '../use-diagram-filing'
import { CAPTION_CONTROL, DiagramFilingControls } from './diagram-filing-controls'
import { DrawingCaption, DrawingReveal } from './drawing-skeleton'
import { isSketchable, sketchFromModel } from '../sketch/sketch-from-model'
import { SketchDialog } from '../sketch/sketch-dialog'

export interface MermaidDiagramProps {
  source: string
  isStreaming?: boolean
}

export function MermaidDiagram({ source, isStreaming = false }: MermaidDiagramProps) {
  const t = useTranslations(diagramsCopy)
  const tCommon = useTranslations(commonCopy)
  const model = useDiagramModel(source, !isStreaming)
  const { svg, fileSvg, failed } = useRenderedDiagram(source, !isStreaming && model === null)
  const filing = useDiagramFiling({
    source,
    fileSvg,
    renderFileSvg: model ? () => renderPaperDiagram(source, model) : undefined,
  })

  const settledForm = isStreaming
    ? undefined
    : model === undefined
      ? undefined
      : model
        ? 'view'
        : 'svg'
  const form = settledForm ?? likelyForm(source)
  const state = isStreaming
    ? 'streaming'
    : model === undefined || (!model && !svg)
      ? 'drawing'
      : 'drawn'

  const fellBack = settledForm === 'svg' && failed
  const frameRef = useRef<HTMLDivElement>(null)
  useHeightGlide(frameRef, fellBack)
  const [sketching, setSketching] = useState(false)
  const sketchable = isSketchable(model) && filing.target !== null
  const sketchElements = useMemo(() => (sketching && isSketchable(model) ? sketchFromModel(model) : null), [sketching, model])
  const crossfade = useMotionToken(motionBase)

  let body: ReactNode
  if (fellBack) {
    const lineCount = source.split('\n').length
    body = (
      <div data-testid="mermaid-diagram" data-state="failed" className="[&>div:first-child]:my-0">
        <CodeBlock value={source} language="mermaid" collapsible={lineCount > 15} maxLines={15} />
        <p className="text-muted-foreground mt-1 text-xs">{t('fallback')}</p>
      </div>
    )
  } else if (form === 'view') {
    body = (
      <figure
        data-testid="mermaid-diagram"
        data-state={state}
        data-view={model ? model.kind : undefined}
        aria-busy={model ? undefined : true}
      >
        {/* A soft plane, not a frame: the nodes are cards and read on it
            without a box around a box. */}
        <div className="bg-muted/40 @container rounded-xl p-3">
          <DrawingReveal drawn={Boolean(model)}>
            {model && (
              <DiagramView
                model={model}
                label={titleFromSource(source) ?? t(`kind.${model.kind}`)}
              />
            )}
          </DrawingReveal>
        </div>
        {/* No „Schematisch — ohne Maßangabe." here: that line tells a reader a
            DRAWING claims no measurement, and these views have no geometry
            to claim one with. What is left is the filing action, and only
            inside a project (`DiagramFilingControls` renders nothing without
            a target). A filed copy carries the disclaimer in its own text. */}
        <AnimatePresence initial={false}>
          {model && filing.target ? (
            <DrawingCaption
              key="caption"
              className="text-muted-foreground flex flex-wrap items-center gap-x-3 pt-1 text-xs"
            >
              <DiagramFilingControls filing={filing} />
              {sketchable ? (
                <button
                  type="button"
                  onClick={() => setSketching(true)}
                  className={CAPTION_CONTROL}
                  data-testid="diagram-edit-sketch"
                >
                  {t('sketch.action')}
                </button>
              ) : null}
            </DrawingCaption>
          ) : null}
        </AnimatePresence>
        {sketchElements ? (
          <SketchDialog open={sketching} onOpenChange={setSketching} source={source} elements={sketchElements} />
        ) : null}
      </figure>
    )
  } else {
    body = (
      <figure className="@container" data-testid="mermaid-diagram" data-state={state} aria-busy={svg ? undefined : true}>
        {/* No background. The drawing is line and text; the paper under it is
          whatever surface it is lying on, which is the card — in both themes.
          A hairline frame is all it needs to read as a figure rather than as
          loose marks in the prose. */}
        <HorizontalScroll
          className="border-border rounded-lg border p-3 [&_svg]:h-auto [&_svg]:max-w-full"
          aria-label={tCommon('markdown.scrollDiagram')}
        >
          <DrawingReveal drawn={Boolean(svg)}>
            {svg && (
              <div
                style={diagramFrameStyle(svg)}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            )}
          </DrawingReveal>
        </HorizontalScroll>
        <AnimatePresence initial={false}>
          {settledForm === 'svg' && (
            <DrawingCaption
              key="caption"
              className="text-muted-foreground flex flex-wrap items-center gap-x-3 pt-1 text-xs"
            >
              {/* The doctrine, where the reader is. Fifteen schematic cards in this
                product compute their geometry so they cannot disagree with their
                own numbers; a model-authored diagram has no such guarantee, so it
                says out loud that it is not claiming a measurement. */}
              <span>{t('schematicOnly')}</span>
              <DiagramFilingControls filing={filing} />
            </DrawingCaption>
          )}
        </AnimatePresence>
      </figure>
    )
  }

  return (
    <div ref={frameRef} className="relative my-4 flow-root">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={fellBack ? 'fallback' : 'figure'}
          initial={crossfade === motionInstant ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={crossfade}
        >
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

const VIEW_KEYWORDS =
  /^(?:flowchart|graph|stateDiagram(?:-v2)?|mindmap|sequenceDiagram|gantt|pie)\b/

export function likelyForm(source: string): 'view' | 'svg' {
  const lines = source.split('\n').map((line) => line.trim())
  let at = 0
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1)
    at = close < 0 ? lines.length : close + 1
  }
  for (; at < lines.length; at++) {
    const line = lines[at]
    if (!line || line.startsWith('%%')) continue
    return VIEW_KEYWORDS.test(line) ? 'view' : 'svg'
  }
  return 'svg'
}
