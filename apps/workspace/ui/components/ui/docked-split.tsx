'use client'

import type { JSX, ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
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
    const panelElement = panelElementRef.current
    const glides = slide && settledRef.current && !reducedMotion
    settledRef.current = true
    if (!open) {
      const travel = canAnimate(panelElement) ? panelElement.getBoundingClientRect().width : 0
      const snapshot = glides && panelElement && travel > 0 ? snapshotOf(panelElement) : null
      docked.collapse()
      setLeaving(false)
      if (snapshot) slideClosed(snapshot, pageElementRef.current, side, travel)
      return
    }
    docked.expand()
    docked.resize(widthRef.current)
    if (glides && canAnimate(panelElement)) slideOpen(panelElement, pageElementRef.current, side, widthRef.current)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, panelRef])

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

  const seam = open ? (
    <ResizableHandle
      key={`${id}-handle`}
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

const outward = (side: 'start' | 'end'): number => (side === 'start' ? -1 : 1)

function slideOpen(panel: HTMLElement | null, page: HTMLElement | null, side: 'start' | 'end', travel: number): void {
  const options = asWebAnimation(motionDeliberateEntrance)
  const from = outward(side) * travel
  if (panel) {
    panel.style.zIndex = '1'
    panel.style.position = 'relative'
    const move = panel.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(0)' }], options)
    move.onfinish = move.oncancel = () => {
      panel.style.zIndex = ''
      panel.style.position = ''
    }
  }
  if (page && side === 'start') page.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(0)' }], options)
}

function slideClosed(snapshot: HTMLElement, page: HTMLElement | null, side: 'start' | 'end', travel: number): void {
  const options = asWebAnimation(motionSheetExit)
  const to = outward(side) * travel
  const move = snapshot.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${to}px)` }], options)
  move.onfinish = move.oncancel = () => snapshot.remove()
  if (page && side === 'start') page.animate([{ transform: `translateX(${travel}px)` }, { transform: 'translateX(0)' }], options)
}

function snapshotOf(panel: HTMLElement): HTMLElement {
  const box = panel.getBoundingClientRect()
  const snapshot = panel.cloneNode(true) as HTMLElement
  for (const node of [snapshot, ...snapshot.querySelectorAll<HTMLElement>('[id], [data-testid]')]) {
    node.removeAttribute('id')
    node.removeAttribute('data-testid')
  }
  snapshot.setAttribute('aria-hidden', 'true')
  snapshot.inert = true
  Object.assign(snapshot.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '30',
  })
  document.body.append(snapshot)
  return snapshot
}
