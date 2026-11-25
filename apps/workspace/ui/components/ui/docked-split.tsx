'use client'

import type { JSX, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { usePanelRef } from 'react-resizable-panels'
import { PanelLeft, PanelRight } from 'lucide-react'

import { asWebAnimation, motionDeliberateEntrance, motionSheetExit, usePrefersReducedMotion } from '@/components/motion'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { cn } from '@/lib/utils'

export interface DockedSplitProps {
  id: string
  side: 'start' | 'end'
  open: boolean
  width: number
  minWidth: number
  maxWidth: number
  defaultWidth: () => number
  onWidthChange: (width: number) => void
  onDismiss: () => void
  restoreWidth?: () => number | null
  resizeLabel: string
  restore?: { label: string; onRestore: () => void; testId?: string } | null
  panel: ReactNode
  panelClassName?: string
  pageClassName?: string
  slide?: boolean
  children: ReactNode
}

export function DockedSplit({
  id,
  side,
  open,
  width,
  minWidth,
  maxWidth,
  defaultWidth,
  onWidthChange,
  onDismiss,
  restoreWidth,
  resizeLabel,
  restore = null,
  panel,
  panelClassName,
  pageClassName,
  slide = true,
  children,
}: DockedSplitProps): JSX.Element {
  const panelRef = usePanelRef()
  const pageElementRef = useRef<HTMLDivElement | null>(null)
  const panelElementRef = useRef<HTMLDivElement | null>(null)
  const seamElementRef = useRef<HTMLDivElement | null>(null)
  const glideRef = useRef<Animation[]>([])
  const reducedMotion = usePrefersReducedMotion()
  const settledRef = useRef(false)
  const lastPanelRef = useRef<ReactNode>(null)
  const [wasOpen, setWasOpen] = useState(open)
  const [leaving, setLeaving] = useState(false)
  if (wasOpen !== open) {
    setWasOpen(open)
    setLeaving(!open)
  }
  const shownPanel = leaving ? (lastPanelRef.current ?? panel) : panel
  useLayoutEffect(() => {
    if (open && panel) lastPanelRef.current = panel
  })
  const widthRef = useRef(width)
  widthRef.current = width
  const mountWidthRef = useRef(open ? width : 0)

  const restoredRef = useRef(false)
  useLayoutEffect(() => {
    if (restoredRef.current || !restoreWidth) return
    restoredRef.current = true
    const stored = restoreWidth()
    if (stored === null) return
    widthRef.current = stored
    panelRef.current?.resize(stored)
  }, [restoreWidth, panelRef])

  useLayoutEffect(() => {
    const docked = panelRef.current
    if (!docked) return
    const parts = {
      page: pageElementRef.current,
      panel: panelElementRef.current,
      seam: seamElementRef.current,
    }
    const glides = slide && settledRef.current && !reducedMotion && canAnimate(parts.page) && canAnimate(parts.panel)
    settledRef.current = true
    const midGlide = glideRef.current.length > 0
    const from = glides ? rowOf(parts, open && !midGlide) : null
    const shown = docked.getSize().inPixels
    stopGlide(glideRef.current, parts.panel)
    glideRef.current = []
    if (!open) {
      docked.collapse()
      if (!from || shown <= 0) {
        setLeaving(false)
        return
      }
      const closing = glide(parts, from, side, shown, false, asWebAnimation(motionSheetExit))
      glideRef.current = closing
      if (parts.panel) parts.panel.inert = true
      void Promise.all(closing.map((motion) => motion.finished)).then(
        () => {
          flushSync(() => setLeaving(false))
          stopGlide(closing, parts.panel)
          if (glideRef.current === closing) glideRef.current = []
        },
        () => {},
      )
      return
    }
    docked.expand()
    docked.resize(widthRef.current)
    if (!from) return
    const target = docked.getSize().inPixels || widthRef.current
    const opening = glide(parts, from, side, target, true, asWebAnimation(motionDeliberateEntrance))
    glideRef.current = opening
    void Promise.all(opening.map((motion) => motion.finished)).then(
      () => {
        stopGlide(opening, null)
        if (glideRef.current === opening) glideRef.current = []
      },
      () => {},
    )
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, panelRef])

  useEffect(() => () => stopGlide(glideRef.current, null), [])

  const pagePanel = (
    <ResizablePanel
      key={`${id}-page`}
      id={`${id}-page`}
      elementRef={pageElementRef}
      minSize="40"
      className={cn('relative min-h-0 min-w-0 overflow-hidden', pageClassName)}
    >
      {children}
      {restore && (
        <button
          type="button"
          data-testid={restore.testId}
          onClick={restore.onRestore}
          aria-label={restore.label}
          title={restore.label}
          className={cn(
            'group/restore bg-card text-muted-foreground hover:text-foreground hover:bg-sheet-hover absolute top-1/2 z-20 flex h-16 w-6 -translate-y-1/2 items-center justify-center shadow-sm',
            side === 'end' ? 'right-0 rounded-l-lg border-r-0' : 'left-0 rounded-r-lg border-l-0',
            'transition-colors duration-quick ease-out motion-reduce:transition-none',
            side === 'end'
              ? 'animate-in fade-in-0 slide-in-from-right-2 duration-base ease-entrance motion-reduce:animate-none'
              : 'animate-in fade-in-0 slide-in-from-left-2 duration-base ease-entrance motion-reduce:animate-none',
            FOCUS_RING,
          )}
        >
          {/* The panel's own glyph, leaning out on approach: a tab you pull. */}
          {side === 'end' ? (
            <PanelRight
              className="size-3.5 transition-transform duration-quick ease-out group-hover/restore:-translate-x-px motion-reduce:transition-none"
              aria-hidden
            />
          ) : (
            <PanelLeft
              className="size-3.5 transition-transform duration-quick ease-out group-hover/restore:translate-x-px motion-reduce:transition-none"
              aria-hidden
            />
          )}
        </button>
      )}
    </ResizablePanel>
  )

  const seam = open || leaving ? (
    <ResizableHandle
      key={`${id}-handle`}
      elementRef={seamElementRef}
      withHandle
      aria-label={resizeLabel}
      disableDoubleClick
      onDoubleClick={() => {
        panelRef.current?.expand()
        const next = defaultWidth()
        panelRef.current?.resize(next)
        onWidthChange(next)
      }}
    />
  ) : null

  const dockedPanel = (
    <ResizablePanel
      key={`${id}-panel`}
      id={`${id}-panel`}
      panelRef={panelRef}
      elementRef={panelElementRef}
      defaultSize={mountWidthRef.current}
      minSize={minWidth}
      maxSize={maxWidth}
      collapsible
      collapsedSize={0}
      className={cn('min-h-0 min-w-0', panelClassName)}
      groupResizeBehavior="preserve-pixel-size"
    >
      {shownPanel}
    </ResizablePanel>
  )

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full min-h-0 min-w-0 flex-1 overflow-hidden"
      id={id}
      onLayoutChanged={(_layout, meta) => {
        if (!meta.isUserInteraction) return
        const size = panelRef.current?.getSize()
        if (!size) return
        if (size.inPixels > 0) {
          onWidthChange(size.inPixels)
          return
        }
        onDismiss()
      }}
    >
      {side === 'end' ? [pagePanel, seam, dockedPanel] : [dockedPanel, seam, pagePanel]}
    </ResizablePanelGroup>
  )
}

const canAnimate = (element: HTMLElement | null): element is HTMLElement => typeof element?.animate === 'function'

interface RowParts {
  page: HTMLElement | null
  panel: HTMLElement | null
  seam: HTMLElement | null
}

interface RowShares {
  page: string
  panel: string
  seam: string
}

function rowOf(parts: RowParts, seamArrives: boolean): RowShares {
  const grow = (element: HTMLElement | null): string => (element ? getComputedStyle(element).flexGrow : '0')
  return {
    page: grow(parts.page),
    panel: grow(parts.panel),
    seam: seamArrives || !parts.seam ? '0px' : getComputedStyle(parts.seam).width,
  }
}

function glide(
  parts: RowParts,
  from: RowShares,
  side: 'start' | 'end',
  travel: number,
  opening: boolean,
  timing: KeyframeAnimationOptions,
): Animation[] {
  const options: KeyframeAnimationOptions = { ...timing, fill: 'forwards' }
  const motions: Animation[] = []
  const { page, panel, seam } = parts
  if (page) motions.push(page.animate([{ flexGrow: from.page }, {}], options))
  if (panel) {
    const anchor = { justifyContent: side === 'end' ? 'flex-start' : 'flex-end' }
    motions.push(panel.animate([{ flexGrow: from.panel, ...anchor }, anchor], options))
    const content = panel.firstElementChild
    if (content instanceof HTMLElement && canAnimate(content)) {
      const pinned = { minWidth: `${travel}px`, maxWidth: 'none', flexShrink: '0' }
      motions.push(content.animate([pinned, pinned], options))
    }
  }
  if (seam && canAnimate(seam)) motions.push(seam.animate([{ width: from.seam }, opening ? {} : { width: '0px' }], options))
  for (const motion of motions) motion.pause()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const motion of motions) if (motion.playState === 'paused') motion.startTime = document.timeline.currentTime
    }),
  )
  return motions
}

function stopGlide(motions: Animation[], panel: HTMLElement | null): void {
  for (const motion of motions) motion.cancel()
  if (panel) panel.inert = false
}
