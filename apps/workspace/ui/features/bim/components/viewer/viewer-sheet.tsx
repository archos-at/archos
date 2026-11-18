'use client'

import type { JSX } from 'react'
import {
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ViewerPanel, ViewerSectionBody } from './viewer-panel'
import { ViewerSurface } from './viewer-surface'

export type ViewerSheetSnap = 'peek' | 'full'

export const SHEET_SWIPE_PX = 32

export function sheetGesture(
  travelY: number,
  snap: ViewerSheetSnap | undefined
): 'toggle' | 'expand' | 'collapse' | 'dismiss' | 'none' {
  if (Math.abs(travelY) < SHEET_SWIPE_PX) return snap === undefined ? 'none' : 'toggle'
  if (travelY < 0) return snap === 'peek' ? 'expand' : 'none'
  return snap === 'full' ? 'collapse' : 'dismiss'
}

export interface ViewerSheetCollapse {
  snap: ViewerSheetSnap
  onSnapChange: (snap: ViewerSheetSnap) => void
  expandLabel: string
  collapseLabel: string
}

export interface ViewerSheetProps {
  title: string
  subtitle?: ReactNode
  closeLabel: string
  onClose: () => void
  collapse?: ViewerSheetCollapse
  placement?: 'bottom' | 'side'
  children: ReactNode
  footer?: ReactNode
  bodyClassName?: string
  className?: string
}

export function ViewerSheet({
  title,
  subtitle,
  closeLabel,
  onClose,
  collapse,
  placement = 'bottom',
  children,
  footer,
  bodyClassName,
  className,
}: ViewerSheetProps): JSX.Element {
  if (placement === 'side') {
    return (
      <ViewerPanel
        title={title}
        subtitle={subtitle}
        closeLabel={closeLabel}
        onClose={onClose}
        footer={footer}
        bodyClassName={bodyClassName}
        className={cn('w-[min(20rem,42vw)]', className)}
      >
        {children}
      </ViewerPanel>
    )
  }
  return (
    <BottomSheet
      title={title}
      subtitle={subtitle}
      closeLabel={closeLabel}
      onClose={onClose}
      collapse={collapse}
      footer={footer}
      bodyClassName={bodyClassName}
      className={className}
    >
      {children}
    </BottomSheet>
  )
}

function BottomSheet({
  title,
  subtitle,
  closeLabel,
  onClose,
  collapse,
  children,
  footer,
  bodyClassName,
  className,
}: Omit<ViewerSheetProps, 'placement'>): JSX.Element {
  const snap = collapse?.snap
  const expanded = snap !== 'peek'
  const bodyId = `${useId()}-body`

  const [travel, setTravel] = useState(0)
  const origin = useRef<{ y: number; pointerId: number } | null>(null)
  const swallowClick = useRef(false)

  const down = (event: ReactPointerEvent<HTMLElement>): void => {
    origin.current = { y: event.clientY, pointerId: event.pointerId }
    swallowClick.current = false
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const move = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!origin.current || origin.current.pointerId !== event.pointerId) return
    const dy = event.clientY - origin.current.y
    if (Math.abs(dy) >= SHEET_SWIPE_PX) swallowClick.current = true
    setTravel(Math.max(0, dy))
  }
  const finish = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean): void => {
    const start = origin.current
    origin.current = null
    setTravel(0)
    if (!start || start.pointerId !== event.pointerId || cancelled) return
    const gesture = sheetGesture(event.clientY - start.y, snap)
    if (gesture !== 'toggle' && gesture !== 'none') swallowClick.current = true
    if (gesture === 'expand') collapse?.onSnapChange('full')
    else if (gesture === 'collapse') collapse?.onSnapChange('peek')
    else if (gesture === 'dismiss') onClose()
  }

  const handleProps = {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finish(event, false),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finish(event, true),
  }

  const bar = (
    <span aria-hidden="true" className="bg-foreground/20 mx-auto mb-2 block h-1 w-9 rounded-full" />
  )
  const titleClass = 'block text-sm font-medium text-foreground line-clamp-2 break-words'
  const subtitleNode = subtitle && (
    <span className="text-muted-foreground mt-0.5 line-clamp-2 block break-words text-xs">
      {subtitle}
    </span>
  )

  return (
    <ViewerSurface
      aria-label={title}
      role="complementary"
      data-snap={snap ?? 'static'}
      style={travel > 0 ? { transform: `translateY(${travel}px)`, transition: 'none' } : undefined}
      className={cn(
        'pointer-events-auto flex w-full max-w-lg flex-col overflow-hidden',
        expanded ? 'max-h-[min(60dvh,34rem)]' : 'max-h-[40dvh]',
        'animate-in fade-in-0 slide-in-from-bottom-3 duration-base ease-entrance motion-reduce:animate-none',
        className
      )}
    >
      <div className="flex shrink-0 items-start">
        {collapse ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            aria-label={expanded ? collapse.collapseLabel : collapse.expandLabel}
            onClick={() => {
              if (swallowClick.current) {
                swallowClick.current = false
                return
              }
              collapse.onSnapChange(expanded ? 'peek' : 'full')
            }}
            className="focus-visible:ring-ring/60 min-h-11 min-w-0 flex-1 touch-none px-3 pb-2 pt-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
            {...handleProps}
          >
            {bar}
            <span className={titleClass}>{title}</span>
            {subtitleNode}
          </button>
        ) : (
          <div
            className="min-h-11 min-w-0 flex-1 touch-none px-3 pb-2 pt-2 text-left"
            {...handleProps}
          >
            {bar}
            <h2 className={titleClass}>{title}</h2>
            {subtitleNode}
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mr-1 mt-1 shrink-0 rounded-md"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <ViewerSectionBody
        id={bodyId}
        hidden={!expanded}
        className={cn(
          'border-border min-h-0 flex-1 overflow-y-auto overscroll-contain border-t',
          bodyClassName
        )}
      >
        {children}
      </ViewerSectionBody>
      {footer && <div className="border-border border-t p-3">{footer}</div>}
    </ViewerSurface>
  )
}
