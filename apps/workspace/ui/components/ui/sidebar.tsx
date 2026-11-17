'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { useIsMobile } from '@/hooks/use-is-mobile'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const SIDEBAR_STORAGE_KEY = 'sidebar.collapsed'
const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebar.width'

const SIDEBAR_WIDTH = 272
const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 420
const SIDEBAR_WIDTH_ICON = 64
const SIDEBAR_COLLAPSE_AT = 160
const SIDEBAR_DRAG_SLOP = 4
const SIDEBAR_KEY_STEP = 16
const SIDEBAR_KEY_STEP_COARSE = 64

function clampWidth(value: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)))
}

type SidebarStyle = React.CSSProperties & {
  '--sidebar-width'?: string
  '--sidebar-width-icon'?: string
  '--skeleton-width'?: string
}

type SidebarContextValue = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean | ((value: boolean) => boolean)) => void
  isMobile: boolean
  toggleSidebar: () => void
  width: number
  setWidth: (width: number) => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar(): SidebarContextValue {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.')
  }
  return context
}

function persistCollapsed(open: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!open))
  } catch {
    // Storage unavailable (privacy mode) — fail soft.
  }
}

function persistWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Storage unavailable (privacy mode) — fail soft; the rail keeps the width
  }
}

function readStoredWidth(): number | null {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (stored === null || stored.trim() === '') return null
    const parsed = Number(stored)
    return Number.isFinite(parsed) ? clampWidth(parsed) : null
  } catch {
    return null
  }
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const isMobile = useIsMobile()
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const [width, _setWidth] = React.useState(SIDEBAR_WIDTH)

  React.useEffect(() => {
    if (openProp !== undefined) return
    try {
      const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
      if (stored === null) return
      _setOpen(stored !== 'true')
    } catch {
      // Storage unavailable — keep defaultOpen.
    }
  }, [openProp])

  React.useEffect(() => {
    const stored = readStoredWidth()
    if (stored !== null) _setWidth(stored)
  }, [])

  const setWidth = React.useCallback((value: number) => {
    _setWidth(clampWidth(value))
  }, [])

  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }
      persistCollapsed(openState)
    },
    [setOpenProp, open],
  )

  const toggleSidebar = React.useCallback(() => {
    setOpen((current) => !current)
  }, [setOpen])

  const state = open ? 'expanded' : 'collapsed'

  const contextValue = React.useMemo<SidebarContextValue>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      toggleSidebar,
      width,
      setWidth,
    }),
    [state, open, setOpen, isMobile, toggleSidebar, width, setWidth],
  )

  const wrapperStyle: SidebarStyle = {
    '--sidebar-width': `${width}px`,
    '--sidebar-width-icon': `${SIDEBAR_WIDTH_ICON}px`,
    ...style,
  }

  return (
    <SidebarContext.Provider value={contextValue}>
      {/* No tooltip provider of its own: the rail's labels share the app's
          one timing chain, so moving from a rail icon to a toolbar button
          keeps the instant follow-up (`components/ui/tooltip.tsx`). */}
      <div
        data-slot="sidebar-wrapper"
        style={wrapperStyle}
        className={cn('group/sidebar-wrapper flex min-h-0 w-full', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = 'left',
  collapsible = 'offcanvas',
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right'
  collapsible?: 'offcanvas' | 'icon'
}): React.JSX.Element | null {
  const { isMobile, state } = useSidebar()


  if (isMobile) return null

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === 'collapsed' ? collapsible : ''}
      data-side={side}
      data-slot="sidebar"
    >
      {/* Desktop gap: reserves layout width for the `fixed` rail beside it.
          NO TRANSITION, on purpose. This is the design language's binding
          constraint made concrete — "a panel that changes size sets its size in
          one pass and TRANSLATES its content" — and here it was also the app's
          single most expensive animation: an in-flow element animating `width`
          for 200ms re-runs layout for the whole page beside it, every frame, on
          a change the reader made once.

          It was never even coherent. The rail's CONTENTS swap on the same tick
          (`iconRail` is React state: labels unmount, the brand mark swaps, tiles
          restyle), so the old transition animated an empty box shrinking around
          content that had already changed. Setting both the gap and the
          container in one pass makes the collapse a single honest layout step
          that agrees with itself. */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          'relative w-(--sidebar-width) bg-transparent',
          'group-data-[collapsible=offcanvas]:w-0',
          'group-data-[side=right]:rotate-180',
          'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          'fixed inset-y-0 z-10 hidden h-[var(--visual-viewport-height,100dvh)] w-(--sidebar-width) transition-transform duration-deliberate ease-entrance group-data-[collapsible=offcanvas]:ease-exit motion-reduce:transition-none md:flex',
          side === 'left'
            ? 'left-0 group-data-[collapsible=offcanvas]:-translate-x-full'
            : 'right-0 group-data-[collapsible=offcanvas]:translate-x-full',
          'group-data-[side=left]:border-r group-data-[side=right]:border-l border-sidebar-border', 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex h-full w-full flex-col bg-sidebar"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

type RailDrag = {
  startX: number
  startWidth: number
  side: 'left' | 'right'
  width: number
  moved: boolean
  collapsed: boolean
}

function railSide(element: HTMLElement): 'left' | 'right' {
  return element.closest('[data-side]')?.getAttribute('data-side') === 'right' ? 'right' : 'left'
}

function SidebarRail({
  className,
  onClick,
  onPointerDown,
  onKeyDown,
  ...props
}: React.ComponentProps<'button'>): React.JSX.Element {
  const { toggleSidebar, setOpen, state, width, setWidth } = useSidebar()
  const [resizing, setResizing] = React.useState(false)
  const dragRef = React.useRef<RailDrag | null>(null)
  const suppressClickRef = React.useRef(false)

  React.useEffect(() => {
    if (!resizing) return

    const handleMove = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const delta = drag.side === 'left' ? event.clientX - drag.startX : drag.startX - event.clientX
      if (Math.abs(delta) > SIDEBAR_DRAG_SLOP) drag.moved = true
      if (!drag.moved) return

      const next = drag.startWidth + delta
      const collapsed = next < SIDEBAR_COLLAPSE_AT
      if (collapsed !== drag.collapsed) {
        drag.collapsed = collapsed
        setOpen(!collapsed)
      }
      if (collapsed) return
      drag.width = clampWidth(next)
      setWidth(drag.width)
    }

    const handleUp = (): void => {
      const drag = dragRef.current
      dragRef.current = null
      setResizing(false)
      if (!drag?.moved) return
      suppressClickRef.current = true
      persistWidth(drag.width)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    const { cursor, userSelect } = document.body.style
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
      document.body.style.cursor = cursor
      document.body.style.userSelect = userSelect
    }
  }, [resizing, setOpen, setWidth])

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    onPointerDown?.(event)
    if (event.button !== 0 || event.defaultPrevented) return
    const startWidth = state === 'collapsed' ? SIDEBAR_WIDTH_ICON : width
    dragRef.current = {
      startX: event.clientX,
      startWidth,
      side: railSide(event.currentTarget),
      width: state === 'collapsed' ? width : startWidth,
      moved: false,
      collapsed: state === 'collapsed',
    }
    setResizing(true)
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onClick?.(event)
    toggleSidebar()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return

    const side = railSide(event.currentTarget)
    const grows = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
    const shrinks = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
    if (event.key !== grows && event.key !== shrinks && event.key !== 'Home' && event.key !== 'End') {
      return
    }
    event.preventDefault()

    if (state === 'collapsed') {
      if (event.key === grows || event.key === 'End') setOpen(true)
      return
    }
    if (event.key === shrinks && width <= SIDEBAR_WIDTH_MIN) {
      setOpen(false)
      return
    }

    const step = event.shiftKey ? SIDEBAR_KEY_STEP_COARSE : SIDEBAR_KEY_STEP
    const next =
      event.key === 'Home'
        ? SIDEBAR_WIDTH_MIN
        : event.key === 'End'
          ? SIDEBAR_WIDTH_MAX
          : clampWidth(width + (event.key === grows ? step : -step))
    setWidth(next)
    persistWidth(next)
  }

  return (
    <button
      type="button"
      data-sidebar="rail"
      data-slot="sidebar-rail"
      data-resizing={resizing || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={state === 'collapsed' ? SIDEBAR_WIDTH_ICON : width}
      aria-valuemin={SIDEBAR_WIDTH_ICON}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={state === 'collapsed' ? 'Drag or click to expand the sidebar' : 'Drag to resize, click to collapse'}
      className={cn(
        'absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-transform duration-quick ease-out motion-reduce:transition-none group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex',
        'cursor-col-resize touch-none',
        '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
        'data-[resizing]:after:bg-sidebar-border',
        FOCUS_RING,
        'group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar',
        '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
        '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
        className,
      )}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div data-slot="sidebar-header" data-sidebar="header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div data-slot="sidebar-footer" data-sidebar="footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }): React.JSX.Element {
  const Comp = asChild ? Slot : 'div'

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        'flex h-8 shrink-0 items-center rounded-control px-2 text-xs font-medium text-muted-foreground outline-none ring-sidebar-ring transition-opacity duration-quick ease-out motion-reduce:transition-none focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn('w-full text-sm', className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>): React.JSX.Element {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn('flex w-full min-w-0 flex-col gap-1', className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>): React.JSX.Element {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-control p-2 text-left text-sm transition-colors duration-quick ease-out group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sheet data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm group-data-[collapsible=icon]:p-0!',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = 'default',
  size = 'default',
  tooltip,
  tooltipWhenExpanded = false,
  className,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
  tooltipWhenExpanded?: boolean
} & VariantProps<typeof sidebarMenuButtonVariants>): React.JSX.Element {
  const Comp = asChild ? Slot : 'button'
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-focus-inset=""
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  const tooltipProps = typeof tooltip === 'string' ? { children: tooltip } : tooltip

  const expanded = state !== 'collapsed'
  return (
    <Tooltip delayDuration={expanded && tooltipWhenExpanded ? 700 : undefined}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={(expanded && !tooltipWhenExpanded) || isMobile}
        {...tooltipProps}
      />
    </Tooltip>
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
}
